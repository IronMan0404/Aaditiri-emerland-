/**
 * MSG91 WhatsApp sender.
 *
 * SERVER-ONLY. Never import this from a `'use client'` file — doing so would
 * bundle MSG91_AUTH_KEY into the browser. The `server-only` import below turns
 * that into a build error if someone ever tries.
 *
 * Required env vars (set server-side, e.g. Vercel env):
 *   MSG91_AUTH_KEY                      — secret auth key from MSG91 dashboard
 *   MSG91_WHATSAPP_INTEGRATED_NUMBER    — your verified WA Business number in
 *                                         E.164 digits-only form, e.g. 919999999999
 *   MSG91_WHATSAPP_TEMPLATE_NAME        — approved template name, e.g. society_broadcast
 *
 * Optional:
 *   MSG91_WHATSAPP_LANGUAGE             — defaults to 'en'
 *   MSG91_WHATSAPP_DEFAULT_COUNTRY_CODE — defaults to '91' (India). Used when a
 *                                         resident's phone is stored without a country code.
 *
 * If any required var is missing, {@link isWhatsAppConfigured} returns false and
 * {@link sendWhatsAppTemplate} reports `skipped_disabled` so the admin can keep
 * sending in-app messages without an MSG91 setup.
 *
 * The exact payload shape used here matches MSG91's v5 "whatsapp bulk outbound"
 * endpoint with a `body_{n}` component map. If MSG91 returns an error, the raw
 * message is surfaced back to the caller so the admin can see it.
 */

import 'server-only';

const ENDPOINT = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

export interface WhatsAppSendSuccess {
  ok: true;
  messageId: string | null;
}

export interface WhatsAppSendSkipped {
  ok: false;
  skipped: true;
  reason: 'skipped_no_phone' | 'skipped_opt_out' | 'skipped_disabled';
}

export interface WhatsAppSendFailure {
  ok: false;
  skipped: false;
  error: string;
}

export type WhatsAppSendResult = WhatsAppSendSuccess | WhatsAppSendSkipped | WhatsAppSendFailure;

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.MSG91_AUTH_KEY &&
    process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER &&
    process.env.MSG91_WHATSAPP_TEMPLATE_NAME,
  );
}

/**
 * Normalize an Indian-friendly phone input to digits-only E.164 (no '+').
 * Returns null if we can't coerce the string into ≥10 digits.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10) {
    const cc = process.env.MSG91_WHATSAPP_DEFAULT_COUNTRY_CODE ?? '91';
    return `${cc}${digits}`;
  }
  return digits;
}

/**
 * Send a templated WhatsApp message to a single recipient.
 * `components` are ordered template variables matching {{1}}, {{2}}, ...
 */
export async function sendWhatsAppTemplate(params: {
  toPhone: string | null | undefined;
  optedIn: boolean;
  components: string[];
}): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) {
    return { ok: false, skipped: true, reason: 'skipped_disabled' };
  }
  if (!params.optedIn) {
    return { ok: false, skipped: true, reason: 'skipped_opt_out' };
  }
  const phone = normalizePhone(params.toPhone);
  if (!phone) {
    return { ok: false, skipped: true, reason: 'skipped_no_phone' };
  }

  // Map ordered components → MSG91's body_1 / body_2 / ... shape.
  const bodyMap = params.components.reduce<Record<string, { type: 'text'; value: string }>>(
    (acc, value, i) => {
      acc[`body_${i + 1}`] = { type: 'text', value };
      return acc;
    },
    {},
  );

  const payload = {
    integrated_number: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER!,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: process.env.MSG91_WHATSAPP_TEMPLATE_NAME!,
        language: {
          code: process.env.MSG91_WHATSAPP_LANGUAGE ?? 'en',
          policy: 'deterministic',
        },
        to_and_components: [
          { to: [phone], components: { body_1: bodyMap } },
        ],
      },
    },
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: process.env.MSG91_AUTH_KEY!,
      },
      body: JSON.stringify(payload),
      // Short timeout — the admin is waiting on the UI. Failed rows stay in the
      // DB with `failed` status so they can be retried later.
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON body, keep raw text */ }

    if (!res.ok) {
      const msg = extractError(parsed) ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
      return { ok: false, skipped: false, error: msg };
    }

    return { ok: true, messageId: extractMessageId(parsed) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, skipped: false, error: msg };
  }
}

function extractError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.error === 'string') return p.error;
  if (p.type === 'error' && typeof p.message === 'string') return p.message;
  return null;
}

function extractMessageId(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.request_id === 'string') return p.request_id;
  if (typeof p.requestId === 'string') return p.requestId;
  if (typeof p.message_id === 'string') return p.message_id;
  return null;
}
