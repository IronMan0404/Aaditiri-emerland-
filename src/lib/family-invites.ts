import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

// Family invitation tokens.
//
// We use a 32-byte (256-bit) random token, base64url-encoded, and store
// only the SHA-256 hash in the DB. The raw token is shown ONCE in the
// invitation email link and never again. This way:
//   - a database leak does not expose live invite links,
//   - the inviter (and admins) can see WHICH invites are pending but
//     cannot retrieve the link itself.
//
// Why 32 bytes? 256 bits of entropy makes brute-forcing impossible
// even at internet scale.
//
// Why SHA-256 (not bcrypt)? The token is single-use and high-entropy,
// so we don't need slow hashing — fast SHA-256 lookups are fine and
// keep accept latency low.

export interface FamilyInviteToken {
  raw: string;       // include in the URL — only handed out once
  hash: string;      // store in DB
}

const RELATIONS = ['spouse', 'son', 'daughter', 'parent', 'sibling', 'in_law', 'other'] as const;
export type FamilyRelation = typeof RELATIONS[number];
export const FAMILY_RELATIONS: ReadonlyArray<FamilyRelation> = RELATIONS;
export function isFamilyRelation(s: unknown): s is FamilyRelation {
  return typeof s === 'string' && (RELATIONS as readonly string[]).includes(s);
}

export function generateInviteToken(): FamilyInviteToken {
  // base64url is URL-safe (no `+`, `/`, `=`) so the token can sit in a
  // path or query string without further encoding.
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Best-effort origin lookup. Used to build absolute URLs for emails.
//   1. Honour APP_URL env (set in Vercel) if present — this is the most
//      stable across deployments.
//   2. Fall back to the request's x-forwarded-host (Vercel's proxy).
//   3. Last resort: use the request URL's origin (works for local dev).
export function originFor(req: Request): string {
  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/$/, '');

  const fHost = req.headers.get('x-forwarded-host');
  const fProto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (fHost) return `${fProto}://${fHost}`;

  try {
    const u = new URL(req.url);
    return u.origin;
  } catch {
    return '';
  }
}

interface InviteEmailArgs {
  inviterName: string;
  inviterFlat: string;
  inviteeName: string;
  acceptUrl: string;
  message?: string | null;
  expiresAtIso: string;
}

export function buildInviteEmail(args: InviteEmailArgs): { html: string; text: string; subject: string } {
  const safe = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const expiresOn = new Date(args.expiresAtIso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const subject = `${args.inviterName} invited you to Aaditri Emerland`;

  const html = `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <div style="text-align:center;margin-bottom:16px;">
        <div style="display:inline-block;width:56px;height:56px;border-radius:14px;background:#1B5E20;color:#fff;font-weight:700;font-size:22px;line-height:56px;">AE</div>
        <h1 style="margin:14px 0 4px;font-size:22px;color:#1B5E20;">You're invited</h1>
        <p style="margin:0;color:#6b7280;font-size:14px;">Aaditri Emerland Community</p>
      </div>
      <p style="font-size:15px;line-height:1.55;">
        Hi ${safe(args.inviteeName)},
      </p>
      <p style="font-size:15px;line-height:1.55;">
        <strong>${safe(args.inviterName)}</strong> (Flat ${safe(args.inviterFlat)}) has invited you to join the Aaditri Emerland community app as a family member.
      </p>
      ${args.message ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:14px;margin:16px 0;color:#92400e;font-size:14px;line-height:1.5;"><strong>Personal note:</strong><br/>${safe(args.message)}</div>` : ''}
      <p style="font-size:14px;line-height:1.55;color:#374151;">
        Click the button below to set a password and sign in. No admin approval is needed — your family account is ready as soon as you set the password.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${args.acceptUrl}"
           style="display:inline-block;background:#1B5E20;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">
          Set password &amp; sign in
        </a>
      </div>
      <p style="font-size:12px;color:#6b7280;line-height:1.55;">
        Or copy this link into your browser:<br/>
        <span style="word-break:break-all;color:#1B5E20;">${safe(args.acceptUrl)}</span>
      </p>
      <p style="font-size:12px;color:#6b7280;line-height:1.55;margin-top:16px;">
        This invite expires on <strong>${expiresOn}</strong>. If you weren't expecting this email, you can safely ignore it.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"/>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
        Aaditri Emerland Community · automated message · please do not reply
      </p>
    </div>
  </div>
</body></html>`.trim();

  const text = [
    `Hi ${args.inviteeName},`,
    '',
    `${args.inviterName} (Flat ${args.inviterFlat}) has invited you to join the Aaditri Emerland community app as a family member.`,
    args.message ? `\nPersonal note from ${args.inviterName}:\n${args.message}\n` : '',
    'Set a password and sign in here:',
    args.acceptUrl,
    '',
    `This invite expires on ${expiresOn}. No admin approval is needed.`,
    '',
    "If you weren't expecting this email, you can safely ignore it.",
    '',
    '— Aaditri Emerland Community',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
