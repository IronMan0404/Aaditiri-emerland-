import 'server-only';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * HMAC-signed pending-action tokens for AI-drafted writes.
 *
 * The flow is:
 *   1. The AI calls `create_booking(...)` (or `create_issue(...)`).
 *   2. The /api/ai/assistant route does NOT execute the write. It mints a
 *      signed token containing { kind, userId, args, exp } and returns it
 *      as a pending_action to the chat UI.
 *   3. The user reviews the rendered "Confirm and submit?" card and taps
 *      Confirm. The chat UI POSTs the token to /api/ai/confirm.
 *   4. /api/ai/confirm verifies the signature, the user, and the expiry,
 *      then performs the write. The route never trusts the request body
 *      for any write field — everything comes from the verified token.
 *
 * Why HMAC instead of a DB row:
 *   - Stateless. No new table, no cleanup cron, survives serverless cold
 *     starts trivially.
 *   - The token is opaque from the client's point of view but the server
 *     can fully verify intent (kind + args) without trusting the client.
 *   - Short TTL (5 minutes) bounds the window in which a leaked token
 *     could be replayed to ~one chat turn.
 *
 * Security properties:
 *   - The HMAC key (`AI_TOOLS_SECRET`, falls back to `CLUBHOUSE_PASS_SECRET`
 *     for installs that have already minted one) never leaves the server.
 *   - The token binds to the user id, so user A cannot confirm an action
 *     drafted for user B even if they obtain the token.
 *   - Expiry is signed in too, so a leaked token is useless after 5 minutes.
 */

const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type PendingAction =
  | { kind: 'create_booking'; args: { facility: string; date: string; time_slot: string; notes: string | null } }
  | { kind: 'create_issue'; args: { title: string; description: string; category: string; priority: string } };

interface SignedPayload {
  v: string;
  uid: string;
  exp: number;
  nonce: string;
  action: PendingAction;
}

function getSecret(): string {
  const secret =
    process.env.AI_TOOLS_SECRET ||
    process.env.CLUBHOUSE_PASS_SECRET ||
    '';
  if (!secret || secret.length < 16) {
    throw new Error(
      'AI_TOOLS_SECRET (or CLUBHOUSE_PASS_SECRET fallback) must be at least 16 characters. ' +
        'Generate with: openssl rand -base64 32',
    );
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function sign(body: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(body).digest());
}

export function mintPendingActionToken(
  userId: string,
  action: PendingAction,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const payload: SignedPayload = {
    v: TOKEN_VERSION,
    uid: userId,
    exp: Date.now() + ttlMs,
    nonce: randomBytes(8).toString('hex'),
    action,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = sign(body, getSecret());
  return `${body}.${sig}`;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'malformed' | 'bad_signature' | 'expired' | 'wrong_user' | 'wrong_version';
  payload?: SignedPayload;
}

export function verifyPendingActionToken(token: string, expectedUserId: string): VerifyResult {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed' };

  const expected = sign(body, getSecret());
  // timingSafeEqual requires equal-length inputs
  let validSig = false;
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length) validSig = timingSafeEqual(a, b);
  } catch {
    validSig = false;
  }
  if (!validSig) return { ok: false, reason: 'bad_signature' };

  let payload: SignedPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as SignedPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.v !== TOKEN_VERSION) return { ok: false, reason: 'wrong_version' };
  if (payload.uid !== expectedUserId) return { ok: false, reason: 'wrong_user' };
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
