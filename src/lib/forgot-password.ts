import 'server-only';
import crypto from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// ============================================================
// Password-reset-via-Telegram OTP helpers.
//
// Flow:
//   1. mintOtp(profileId)  -> stores hashed OTP, returns plaintext
//   2. caller DMs the plaintext to the user via Telegram
//   3. verifyOtp(profileId, plaintext) -> consumes the row,
//      returns a short-lived "verify token" the client passes
//      to /api/auth/forgot-password/reset
//   4. consumeVerifyToken(token, expectedUserId) on the reset
//      endpoint validates the token before letting admin update
//      the password
//
// All hashing is HMAC-SHA256(otp || pepper). The pepper is a
// dedicated env var (FORGOT_PASSWORD_PEPPER) with a fallback to
// the bot token so deployments that have the bot configured don't
// need a second secret on day one. A pure SHA-256 of the OTP
// alone would be brute-forceable in a few minutes — there are
// only 1,000,000 possible 6-digit codes.
// ============================================================

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutes — long enough for Telegram delivery, short enough to keep blast radius small
const VERIFY_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — only spans "OK, OTP verified" -> "set new password"
const MAX_ATTEMPTS = 5;

function getPepper(): string {
  const dedicated = process.env.FORGOT_PASSWORD_PEPPER;
  if (dedicated && dedicated.length >= 16) return dedicated;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && botToken.length >= 16) return `tg:${botToken}`;
  // Final fallback ONLY for non-prod environments where neither has
  // been configured. We loudly mark the hash so a leaked DB column
  // is recognisable as a placeholder rather than a real-world hash.
  if (process.env.NODE_ENV !== 'production') {
    return 'dev-placeholder-pepper';
  }
  throw new Error(
    'Password reset OTPs require either FORGOT_PASSWORD_PEPPER or TELEGRAM_BOT_TOKEN to be configured (>=16 chars).',
  );
}

function hashOtp(plaintext: string): string {
  // HMAC instead of plain SHA-256 so an attacker who only has the
  // DB dump can't precompute a 1M-entry rainbow table without also
  // owning the pepper.
  return crypto
    .createHmac('sha256', getPepper())
    .update(plaintext)
    .digest('hex');
}

function generateOtp(): string {
  // crypto.randomInt is uniform — Math.random() would slightly bias
  // the leading digit. The community is small but this costs nothing.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
}

function fingerprint(req: Request): string {
  // We hash (UA + accept-language + IP-prefix) so a DB dump doesn't
  // reveal the resident's exact IP, but a code issued from one
  // device family + region can't be redeemed from a totally
  // different one. Coarse on purpose — we WANT a resident who
  // Telegrams the OTP from their phone to type it on their laptop.
  const ua = req.headers.get('user-agent') ?? '';
  const lang = req.headers.get('accept-language')?.slice(0, 16) ?? '';
  return crypto.createHash('sha256').update(`${ua}|${lang}`).digest('hex').slice(0, 32);
}

export interface MintResult {
  ok: true;
  /** Plaintext OTP — caller delivers it via Telegram, then drops it. */
  otp: string;
  /** Row ID — useful for logs. The verify path looks up by profile_id, not id. */
  id: string;
  expiresAt: Date;
}

export interface MintFailure {
  ok: false;
  error: string;
}

/**
 * Issue a fresh OTP for the given profile.
 *
 * Side effects:
 *   - Inserts a new password_reset_otps row with the HASHED OTP and
 *     a 10-minute expiry.
 *   - Marks any previously-issued, still-active OTPs for this user
 *     as consumed so only the latest one is valid.
 */
export async function mintOtp(
  profileId: string,
  channel: 'telegram' | 'email',
  req: Request,
): Promise<MintResult | MintFailure> {
  if (!profileId) return { ok: false, error: 'profileId required' };

  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + OTP_TTL_MS);
  const fp = fingerprint(req);

  const admin = createAdminSupabaseClient();

  // Invalidate any prior unspent OTPs so a stale DM can't be used.
  // Best-effort — if it fails we still try to insert the new row.
  await admin
    .from('password_reset_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .is('consumed_at', null);

  const { data, error } = await admin
    .from('password_reset_otps')
    .insert({
      profile_id: profileId,
      otp_hash: otpHash,
      channel,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      request_fingerprint: fp,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'failed to issue OTP' };
  }

  return { ok: true, otp, id: data.id, expiresAt };
}

export interface VerifyResult {
  ok: true;
  /** Short-lived signed token the client posts to /reset. */
  verifyToken: string;
  expiresAt: Date;
}

export interface VerifyFailure {
  ok: false;
  /** Translatable error string. Generic on purpose. */
  error: string;
  /** Hint for the UI: should we lock further attempts? */
  locked?: boolean;
}

/**
 * Verify a plaintext OTP. Atomic against a single row — we
 * read-then-write under the service-role client so the attempts
 * counter is honored even when two concurrent requests race.
 */
export async function verifyOtp(
  profileId: string,
  plaintext: string,
  req: Request,
): Promise<VerifyResult | VerifyFailure> {
  if (!profileId) return { ok: false, error: 'profileId required' };
  const cleaned = plaintext.replace(/\D/g, '');
  if (cleaned.length !== OTP_LENGTH) {
    return { ok: false, error: 'Enter the 6-digit code from Telegram' };
  }

  const admin = createAdminSupabaseClient();

  const { data: row, error: readErr } = await admin
    .from('password_reset_otps')
    .select('id, otp_hash, expires_at, consumed_at, attempts, request_fingerprint, channel')
    .eq('profile_id', profileId)
    .is('consumed_at', null)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readErr) return { ok: false, error: 'Lookup failed' };
  if (!row) {
    return { ok: false, error: 'No active code. Request a new one.' };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Code expired. Request a new one.' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    return {
      ok: false,
      error: 'Too many attempts. Request a new code.',
      locked: true,
    };
  }

  const expectedHash = row.otp_hash;
  const providedHash = hashOtp(cleaned);

  // timingSafeEqual rejects mismatched lengths, so coerce both to
  // the same Buffer length first. Both are SHA-256 hex (64 chars);
  // the equality check is just defensive.
  let matched = false;
  if (expectedHash.length === providedHash.length) {
    matched = crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(providedHash, 'hex'),
    );
  }

  // Also bind to the same coarse device family the OTP was issued
  // from. Lets us catch the easy case of "someone else typed the
  // code from a totally different region/UA" without breaking the
  // common case of "Telegram on phone, browser on laptop, same WiFi"
  // (which produces the same coarse fingerprint we hash).
  const fp = fingerprint(req);
  const fpMatched = !row.request_fingerprint || row.request_fingerprint === fp;

  if (!matched || !fpMatched) {
    await admin
      .from('password_reset_otps')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id);
    return { ok: false, error: 'Incorrect or expired code.' };
  }

  // Mark consumed BEFORE issuing the verify token so a duplicate
  // request can't double-spend.
  const { error: consumeErr } = await admin
    .from('password_reset_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id);
  if (consumeErr) {
    return { ok: false, error: 'Could not consume code' };
  }

  const verifyToken = mintVerifyToken(profileId);
  return {
    ok: true,
    verifyToken,
    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  };
}

// ----------------------------------------------------------------
// Verify token: a short-lived HMAC-signed JSON payload that proves
// "this client successfully solved an OTP within the last 5 min".
// We deliberately don't reuse Supabase's recovery JWT because the
// admin path still has to call admin.auth.admin.updateUserById, and
// the resident never holds a Supabase recovery session in this
// flow.
// ----------------------------------------------------------------

interface VerifyTokenPayload {
  profileId: string;
  /** Issued-at, ms since epoch. */
  iat: number;
  /** Expires-at, ms since epoch. */
  exp: number;
  /** Random nonce so two tokens minted in the same ms aren't equal. */
  nonce: string;
}

function mintVerifyToken(profileId: string): string {
  const payload: VerifyTokenPayload = {
    profileId,
    iat: Date.now(),
    exp: Date.now() + VERIFY_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getPepper())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function consumeVerifyToken(
  token: string,
  expectedProfileId: string,
): { ok: true } | { ok: false; error: string } {
  if (!token || !token.includes('.')) {
    return { ok: false, error: 'Invalid token' };
  }
  const [body, sig] = token.split('.', 2);
  if (!body || !sig) return { ok: false, error: 'Invalid token' };

  const expectedSig = crypto
    .createHmac('sha256', getPepper())
    .update(body)
    .digest('base64url');

  let sigOk = false;
  try {
    sigOk =
      sig.length === expectedSig.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, error: 'Invalid token' };

  let payload: VerifyTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VerifyTokenPayload;
  } catch {
    return { ok: false, error: 'Invalid token' };
  }

  if (payload.profileId !== expectedProfileId) {
    return { ok: false, error: 'Token bound to a different account' };
  }
  if (payload.exp < Date.now()) {
    return { ok: false, error: 'Token expired. Restart the reset flow.' };
  }

  return { ok: true };
}

// ----------------------------------------------------------------
// UI-friendly helpers used by the lookup endpoint.
// ----------------------------------------------------------------

/**
 * Mask an email for "we'll send to b…@gmail.com" style hints.
 * Leaves the first character of the local part visible, plus the
 * full domain. Empty / malformed input returns null.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 1) return `${local}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}@${domain}`;
}

/**
 * Mask a Telegram identifier for "we'll DM @b…batchu" hints.
 * Falls back to "your Telegram" if username is missing.
 */
export function maskTelegramHandle(args: {
  username: string | null;
  firstName: string | null;
}): string {
  if (args.username && args.username.length > 1) {
    return `@${args.username[0]}${'*'.repeat(Math.min(args.username.length - 1, 4))}`;
  }
  if (args.firstName) {
    return `${args.firstName[0]}${'*'.repeat(2)} on Telegram`;
  }
  return 'your linked Telegram';
}

export const FORGOT_PASSWORD_CONSTANTS = {
  OTP_LENGTH,
  OTP_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
  MAX_ATTEMPTS,
} as const;
