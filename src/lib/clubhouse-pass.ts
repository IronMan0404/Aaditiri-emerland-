import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';

// HMAC-signed payloads for clubhouse passes.
//
// We never store the raw payload twice: the QR code embeds `payload.qr`, the
// DB stores the same string in clubhouse_passes.qr_payload. On scan we
// verify the signature, then look the row up by the embedded UUID to get the
// authoritative status. This means a forged QR fails signature verification
// AND a tampered status (e.g. expired) can't be hidden by reusing an old
// payload \u2014 the source of truth is always the DB row.

const SECRET = process.env.CLUBHOUSE_PASS_SECRET || '';

function ensureSecret(): string {
  if (!SECRET) {
    throw new Error(
      'CLUBHOUSE_PASS_SECRET is not configured. Generate one with `openssl rand -base64 32` ' +
      'and add it to .env.local + your hosting environment.'
    );
  }
  return SECRET;
}

function sign(message: string): string {
  return createHmac('sha256', ensureSecret()).update(message).digest('base64url');
}

// Short, human-friendly code. 6 alphanumeric chars (no I, O, 0, 1 to avoid
// confusion at the gate). 36^6 \u2248 2.1B combos with the unique-index in the
// DB catching the rare collision.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePassCode(): string {
  const buf = randomBytes(6);
  let out = 'AE-';
  for (const b of buf) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export interface PassPayload {
  v: 1;             // version, lets us rotate format later
  id: string;       // pass row id (uuid)
  flat: string;     // flat number (sanity check at the gate)
  exp: number;      // ms epoch when valid_until expires
}

// Build an opaque token of the form `${base64url(json)}.${signature}`.
// The full string goes into the QR code AND the DB row's qr_payload column.
export function buildPassToken(payload: PassPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export interface VerifyResult {
  ok: boolean;
  payload?: PassPayload;
  reason?: 'malformed' | 'bad_signature' | 'expired';
}

export function verifyPassToken(token: string): VerifyResult {
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time-ish: createHmac results are deterministic length so plain
  // string compare is fine here \u2014 the secret never changes between calls.
  if (sig !== expected) return { ok: false, reason: 'bad_signature' };
  try {
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PassPayload;
    if (typeof json !== 'object' || json === null || json.v !== 1 || !json.id) {
      return { ok: false, reason: 'malformed' };
    }
    if (typeof json.exp === 'number' && Date.now() > json.exp) {
      return { ok: false, payload: json, reason: 'expired' };
    }
    return { ok: true, payload: json };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
