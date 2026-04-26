import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { consume, getClientIp } from '@/lib/rate-limit';
import { consumeLookupToken } from '@/lib/forgot-password-token';
import { consumeVerifyToken } from '@/lib/forgot-password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Step 4 of forgot-password: actually update the password.
//
// Required inputs:
//   - lookup_id    (the same signed token used in /lookup, /send, /verify)
//   - verify_token (proves the resident solved the OTP within
//                   the last 5 min)
//   - new_password (>= 6 chars; matches the same constraint we
//                   enforce at registration time)
//
// Both tokens MUST agree on the same profile_id; otherwise the
// reset is rejected. This means a leaked verify_token is useless
// without the matching lookup_id.
//
// We use the service-role client's auth.admin.updateUserById to
// rotate the password without needing the resident to be signed
// in — the entire flow is anonymous from Supabase's perspective.
// After success the resident still has to log in normally.
// =============================================================

interface ResetPayload {
  lookup_id?: string;
  verify_token?: string;
  new_password?: string;
}

const IP_LIMIT = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;
const PROFILE_LIMIT = 5;
const PROFILE_WINDOW_MS = 30 * 60 * 1000;

function tooManyRequests(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: 'Too many attempts. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipCheck = consume(`fp:reset:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  let body: ResetPayload;
  try {
    body = (await req.json()) as ResetPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lookupId = (body.lookup_id ?? '').trim();
  const verifyToken = (body.verify_token ?? '').trim();
  const newPassword = body.new_password ?? '';

  if (!lookupId || !verifyToken || !newPassword) {
    return NextResponse.json(
      { error: 'lookup_id, verify_token and new_password required' },
      { status: 400 },
    );
  }
  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400 },
    );
  }
  if (newPassword.length > 200) {
    return NextResponse.json(
      { error: 'Password is too long' },
      { status: 400 },
    );
  }

  const lookup = consumeLookupToken(lookupId);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: 400 });
  }
  const profileId = lookup.profileId;

  const profileCheck = consume(`fp:reset:pid:${profileId}`, PROFILE_LIMIT, PROFILE_WINDOW_MS);
  if (!profileCheck.allowed) return tooManyRequests(profileCheck.retryAfterMs);

  const verify = consumeVerifyToken(verifyToken, profileId);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.error }, { status: 400 });
  }

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      { error: 'Service unavailable. Please try again later.' },
      { status: 503 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Sanity-check the profile still exists and is the right id.
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', profileId)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: 'Account no longer exists' }, { status: 404 });
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(profileId, {
    password: newPassword,
  });
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Defense-in-depth: also clear any other still-active OTPs for
  // this user so a second window of the reset flow can't be
  // re-used to flip the password again.
  await admin
    .from('password_reset_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .is('consumed_at', null);

  return NextResponse.json({ ok: true });
}
