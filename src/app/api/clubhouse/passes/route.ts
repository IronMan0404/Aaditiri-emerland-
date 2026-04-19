import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { buildPassToken, generatePassCode } from '@/lib/clubhouse-pass';

// Resident-initiated pass generation. Why this lives in an API route rather
// than a direct Supabase insert from the client:
//   - We need to mint a server-side HMAC (qr_payload) using
//     CLUBHOUSE_PASS_SECRET, which the browser must never see.
//   - We need to retry on the rare unique-code collision.
//   - The DB trigger enforces tier / quota / window rules but the friendly
//     error messages are nicer to surface from this layer.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  facility_id?: string;
  valid_from?: string; // ISO timestamp
  valid_until?: string;
}

const MAX_CODE_RETRIES = 5;

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as PostBody;
  if (!body.facility_id || !body.valid_from || !body.valid_until) {
    return NextResponse.json({ error: 'facility_id, valid_from and valid_until are required' }, { status: 400 });
  }

  const validFrom = new Date(body.valid_from);
  const validUntil = new Date(body.valid_until);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  if (validUntil <= validFrom) {
    return NextResponse.json({ error: 'valid_until must be after valid_from' }, { status: 400 });
  }
  if (validUntil.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Pass cannot end in the past' }, { status: 400 });
  }

  // Resolve the resident's flat + active subscription. RLS would enforce
  // this on insert too, but doing it here gives us a clean error message.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, flat_number')
    .eq('id', user.id)
    .single();
  if (!profile?.flat_number) {
    return NextResponse.json({ error: 'Set your flat number in your profile first' }, { status: 400 });
  }

  const { data: subscription } = await supabase
    .from('clubhouse_subscriptions')
    .select('id')
    .eq('flat_number', profile.flat_number)
    .eq('status', 'active')
    .maybeSingle();
  if (!subscription) {
    return NextResponse.json({ error: 'Your flat does not have an active clubhouse subscription' }, { status: 403 });
  }

  // We mint and try to insert until we hit a unique code (retry handles
  // the astronomically unlikely collision on `code`). The DB trigger does
  // the heavy lifting: tier / facility / quota / duration checks.
  // We use the user's session client so RLS policies still apply \u2014 the
  // admin client would bypass them.
  for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
    const code = generatePassCode();
    // Insert without qr_payload first so we can use the row's id when
    // building the signed token. We patch qr_payload immediately after.
    const placeholder = 'pending';
    const { data: row, error } = await supabase
      .from('clubhouse_passes')
      .insert({
        code,
        qr_payload: placeholder,
        subscription_id: subscription.id,
        flat_number: profile.flat_number,
        issued_to: user.id,
        facility_id: body.facility_id,
        valid_from: validFrom.toISOString(),
        valid_until: validUntil.toISOString(),
      })
      .select('id, code, valid_from, valid_until, facility_id, status')
      .single();

    if (error) {
      // Postgres unique violation on `code` \u2014 retry. Anything else (incl.
      // trigger-raised messages) bubbles up to the resident.
      if (error.code === '23505') continue;
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const token = buildPassToken({
      v: 1,
      id: row.id,
      flat: profile.flat_number,
      exp: validUntil.getTime(),
    });

    // Bypass RLS for the qr_payload patch \u2014 the row already exists and we
    // just need to attach the signature. RLS only allows admins to UPDATE
    // pass rows, but the freshly-inserted row's qr_payload is server-only
    // sensitive material so using the admin client here is correct.
    const adminClient = createAdminSupabaseClient();
    await adminClient.from('clubhouse_passes').update({ qr_payload: token }).eq('id', row.id);

    return NextResponse.json({
      ok: true,
      pass: { ...row, qr_payload: token },
    });
  }

  return NextResponse.json({ error: 'Could not allocate a pass code, please retry' }, { status: 500 });
}
