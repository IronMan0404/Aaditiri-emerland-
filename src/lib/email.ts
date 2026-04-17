/**
 * Transactional email via Brevo (formerly Sendinblue).
 *
 * SERVER-ONLY. Never import from a `'use client'` module — `BREVO_API_KEY`
 * must never reach the browser bundle. The `server-only` import below turns
 * that into a build error if someone tries.
 *
 * Why Brevo? The free tier allows 300 emails/day forever, works without a
 * custom domain (just a single-sender verified via a click-through email),
 * and has decent deliverability to Indian ISPs.
 *
 * Required env vars (server-side):
 *   BREVO_API_KEY         — from Brevo dashboard → Settings → SMTP & API → API Keys
 *   EMAIL_FROM_ADDRESS    — the Gmail (or other) address you verified as a
 *                           "sender" in Brevo. Example: youruser@gmail.com
 *
 * Optional:
 *   EMAIL_FROM_NAME       — display name on the "From" line.
 *                           Default: "Aaditri Emerland Community"
 *
 * If BREVO_API_KEY or EMAIL_FROM_ADDRESS is missing, {@link isEmailConfigured}
 * returns false and {@link sendEmail} reports `{ ok: false, skipped: true }` so
 * downstream APIs keep working (feature degrades to in-app only).
 */

import 'server-only';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_FROM_NAME = 'Aaditri Emerland Community';

export interface EmailAttachment {
  filename: string;
  /** Either a base64 string or a raw string. Brevo always wants base64; we convert raw automatically. */
  content: string;
  contentType?: string;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  bcc?: string | string[];
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: 'skipped_disabled' | 'skipped_no_recipient' }
  | { ok: false; skipped: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

function toBase64(raw: string): string {
  // If the input already looks like base64, return as-is. Otherwise encode.
  // Brevo requires base64-encoded attachment content.
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length % 4 === 0) {
    return raw;
  }
  return Buffer.from(raw, 'utf-8').toString('base64');
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).filter(Boolean);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    return { ok: false, skipped: true, reason: 'skipped_disabled' };
  }
  const to = asArray(input.to);
  if (to.length === 0) {
    return { ok: false, skipped: true, reason: 'skipped_no_recipient' };
  }

  const fromAddress = process.env.EMAIL_FROM_ADDRESS!.trim();
  const fromName = (process.env.EMAIL_FROM_NAME?.trim()) || DEFAULT_FROM_NAME;

  const payload: Record<string, unknown> = {
    sender: { email: fromAddress, name: fromName },
    to: to.map((email) => ({ email })),
    subject: input.subject,
  };
  if (input.html) payload.htmlContent = input.html;
  if (input.text) payload.textContent = input.text;
  if (input.replyTo) payload.replyTo = { email: input.replyTo };
  if (input.bcc && input.bcc.length > 0) {
    payload.bcc = asArray(input.bcc).map((email) => ({ email }));
  }
  if (input.attachments && input.attachments.length > 0) {
    payload.attachment = input.attachments.map((a) => ({
      name: a.filename,
      content: toBase64(a.content),
    }));
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
        'api-key': process.env.BREVO_API_KEY!,
      },
      body: JSON.stringify(payload),
      // Short timeout — admins are waiting on the UI. Rows stay pending in
      // our DB audit trail if this fails, so retries are still possible.
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON body, keep raw text */ }

    if (!res.ok) {
      const msg = extractError(parsed) ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
      return { ok: false, skipped: false, error: msg };
    }

    return { ok: true, id: extractMessageId(parsed) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, skipped: false, error: msg };
  }
}

function extractError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  // Brevo errors look like: { code: 'invalid_parameter', message: '...' }
  if (typeof p.message === 'string') return p.message;
  return null;
}

function extractMessageId(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  // Brevo returns: { messageId: '<abc@smtp-relay.brevo.com>' }
  if (typeof p.messageId === 'string') return p.messageId;
  return null;
}
