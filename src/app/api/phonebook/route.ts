import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { consume, getClientIp } from '@/lib/rate-limit';
import { validateDirectoryPayload, type DirectoryPayload } from '@/lib/phonebook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resident-side phone book submission. Admin curated entries
// (`is_society_contact = true`) are inserted directly via the
// /admin/phonebook UI using the regular session client — the BEFORE
// INSERT trigger blocks any non-admin attempt to flip that flag.
//
// Why a route at all instead of a direct supabase-js insert from the
// browser? Three reasons:
//   1. Rate-limit. Anyone with a session can otherwise spam the
//      directory with 1000 fake plumbers in a loop.
//   2. Server-side normalisation of the phone number (shared with
//      PATCH /api/phonebook/[id] via @/lib/phonebook) so we don't
//      end up with "+91 98xxx", "98xxx", "(040) 2xxx" all sitting
//      in the database for the same vendor.
//   3. Defence in depth — even if the trigger were ever dropped by
//      mistake, this route never sets is_society_contact / is_verified.
const IP_LIMIT = 10;
const IP_WINDOW_MS = 60 * 60 * 1000; // 10 contacts/hour/IP

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipResult = consume(`phonebook:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipResult.allowed) {
    return NextResponse.json(
      { error: 'Too many submissions from your network. Try again in a bit.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) } }
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

  // The trigger forces submitted_by to the caller's auth.uid() even
  // if we omit it — but we set it explicitly so anyone reading the
  // code can see the intent.
  const { data: created, error } = await supabase
    .from('directory_contacts')
    .insert({
      ...result.value,
      submitted_by: user.id,
      is_society_contact: false,
      is_verified: false,
      is_archived: false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ contact: created });
}
