import 'server-only';
import crypto from 'node:crypto';

// ============================================================
// Lookup token used between the three forgot-password endpoints.
//
// The /lookup endpoint mints this; /send and /verify consume it.
// It binds a profile_id to a 15-min-TTL signed envelope so the
// client never has to know (and the server never has to send
// back) the actual user id. That's the key anti-enumeration
// property: a hostile caller who hits /lookup with a guessed
// email gets either no token (account doesn't exist) or an
// opaque token that is useless for anything other than the
// reset flow they just started.
//
// Hash key: same pepper used by src/lib/forgot-password.ts so
// the two systems share a single secret. If you want to rotate
// the secret, change FORGOT_PASSWORD_PEPPER in the env and bump
// it everywhere; older lookup tokens become invalid (which is
// fine — TTL is 15 minutes).
// ============================================================

interface LookupTokenPayload {
  pid: string;
  iat: number;
  exp: number;
}

const LOOKUP_TTL_MS = 15 * 60 * 1000;

function lookupTokenSecret(): string {
  const dedicated = process.env.FORGOT_PASSWORD_PEPPER;
  if (dedicated && dedicated.length >= 16) return dedicated;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && botToken.length >= 16) return `tg:${botToken}`;
  if (process.env.NODE_ENV !== 'production') return 'dev-placeholder-pepper';
  throw new Error(
    'Forgot-password lookup token requires FORGOT_PASSWORD_PEPPER or TELEGRAM_BOT_TOKEN.',
  );
}

export function mintLookupToken(profileId: string): string {
  const payload: LookupTokenPayload = {
    pid: profileId,
    iat: Date.now(),
    exp: Date.now() + LOOKUP_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', lookupTokenSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function consumeLookupToken(
  token: string,
): { ok: true; profileId: string } | { ok: false; error: string } {
  if (!token || !token.includes('.')) return { ok: false, error: 'Invalid lookup_id' };
  const [bodyB64, sig] = token.split('.', 2);
  if (!bodyB64 || !sig) return { ok: false, error: 'Invalid lookup_id' };

  const expectedSig = crypto
    .createHmac('sha256', lookupTokenSecret())
    .update(bodyB64)
    .digest('base64url');

  let sigOk = false;
  try {
    sigOk =
      sig.length === expectedSig.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, error: 'Invalid lookup_id' };

  let payload: LookupTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as LookupTokenPayload;
  } catch {
    return { ok: false, error: 'Invalid lookup_id' };
  }
  if (payload.exp < Date.now()) {
    return { ok: false, error: 'Lookup expired. Start the reset flow again.' };
  }
  return { ok: true, profileId: payload.pid };
}
