import { NextResponse } from 'next/server';
import { consume, getClientIp } from '@/lib/rate-limit';
import { consumeLookupToken } from '@/lib/forgot-password-token';
import { verifyOtp } from '@/lib/forgot-password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Step 3 of forgot-password: verify the 6-digit OTP the resident
// typed.
//
// Returns a short-lived "verify token" that /reset will require
// alongside the new password. We deliberately do NOT issue any
// Supabase auth session here — the resident is still anonymous
// from Supabase's perspective until /reset succeeds.
//
// Brute-force defenses live in src/lib/forgot-password.ts:
//   - per-OTP attempts counter capped at 5
//   - request fingerprint matching
//   - consumed_at flag set on first match
// This route adds an IP-level rate limit on top so an attacker
// can't try 5 codes from one IP, then start over with another
// lookup_id.
// =============================================================

interface VerifyPayload {
  lookup_id?: string;
  otp?: string;
}

const IP_LIMIT = 30;
const IP_WINDOW_MS = 15 * 60 * 1000;
const PROFILE_LIMIT = 8;
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
  const ipCheck = consume(`fp:verify:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  let body: VerifyPayload;
  try {
    body = (await req.json()) as VerifyPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lookupId = (body.lookup_id ?? '').trim();
  const otp = (body.otp ?? '').trim();
  if (!lookupId || !otp) {
    return NextResponse.json({ error: 'lookup_id and otp required' }, { status: 400 });
  }

  const verified = consumeLookupToken(lookupId);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }
  const profileId = verified.profileId;

  const profileCheck = consume(`fp:verify:pid:${profileId}`, PROFILE_LIMIT, PROFILE_WINDOW_MS);
  if (!profileCheck.allowed) return tooManyRequests(profileCheck.retryAfterMs);

  const result = await verifyOtp(profileId, otp, req);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, locked: 'locked' in result ? Boolean(result.locked) : false },
      { status: result.locked ? 423 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    verify_token: result.verifyToken,
    expires_at: result.expiresAt.toISOString(),
  });
}
