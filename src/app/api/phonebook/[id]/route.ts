import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { consume, getClientIp } from '@/lib/rate-limit';
import { validateDirectoryPayload, type DirectoryPayload } from '@/lib/phonebook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/phonebook/[id]
//
// Edit a directory contact. Goes through the API for the same three
// reasons the POST does (see ../route.ts):
//
//   1. Rate-limit edits, so a hostile script can't churn an entry
//      and pollute the audit log.
//   2. Reuse the shared `validateDirectoryPayload` so phone numbers
//      get normalised on edit too. The previous behaviour
//      (direct supabase-js .update from the browser) skipped
//      normalisation entirely and let inconsistent formats creep
//      back in over time.
//   3. Hard-block any client attempt to flip `is_society_contact`,
//      `is_verified`, `is_archived`, or `submitted_by` from this
//      route. RLS + triggers also block it — this is defence in
//      depth so reviewers don't have to trust four layers at once.
//
// RLS still gates *which* row a caller can update (submitter or
// admin only). We don't re-implement that check here.

const IP_LIMIT = 30;
const IP_WINDOW_MS = 60 * 60 * 1000; // 30 edits/hour/IP

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing contact id' }, { status: 400 });
  }

  const ip = getClientIp(req);
  const ipResult = consume(`phonebook:edit:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipResult.allowed) {
    return NextResponse.json(
      { error: 'Too many edits from your network. Try again in a bit.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) } },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_approved')
    .eq('id', user.id)
    .single();
  if (!profile?.is_approved) {
    return NextResponse.json({ error: 'Account not yet approved' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as DirectoryPayload;
  const result = validateDirectoryPayload(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Note: we explicitly spread only the validated/cleaned columns.
  // Anything else in the request body (is_society_contact,
  // submitted_by, is_verified, etc.) is dropped. The RLS UPDATE
  // policy + DB trigger on directory_contacts already block
  // privileged-column changes from non-admins, but stripping them
  // here means a non-admin's PATCH never even touches them.
  const { data: updated, error } = await supabase
    .from('directory_contacts')
    .update(result.value)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    // PostgREST returns a 4xx-shaped error code when RLS blocks an
    // update; surface 403 rather than 500 so the UI can show a
    // sensible message ("you can only edit entries you submitted").
    const code = (error as { code?: string }).code;
    if (code === 'PGRST116' || code === '42501') {
      return NextResponse.json(
        { error: 'You can only edit entries you submitted.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: updated });
}
