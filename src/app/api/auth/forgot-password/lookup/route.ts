import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { consume, getClientIp } from '@/lib/rate-limit';
import { normalizePhoneE164 } from '@/lib/phone';
import {
  maskEmail,
  maskTelegramHandle,
} from '@/lib/forgot-password';
import { mintLookupToken } from '@/lib/forgot-password-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Step 1 of forgot-password: figure out which channels are
// available to the resident based on what they typed.
//
// IMPORTANT — anti-enumeration:
//   The response shape is identical for "no such account" and
//   "account exists but neither channel is set up". The only
//   thing the client gets back is a `lookup_id` (a server-issued
//   opaque value bound to the profile via signed token) plus
//   booleans for has_email / has_telegram and *masked* hints.
//   We never echo back the raw email or phone, and we always
//   return 200, so a tester can't tell the two states apart.
//
// The lookup_id is a signed JSON blob, NOT a DB row, so a hostile
// caller can't replay it to enumerate user IDs. The /send and
// /verify endpoints validate it server-side via
// consumeLookupToken from src/lib/forgot-password-token.ts.
// =============================================================

interface LookupPayload {
  identifier?: string;
}

const IP_LIMIT = 30;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IDENT_LIMIT = 8;
const IDENT_WINDOW_MS = 15 * 60 * 1000;

function tooManyRequests(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: 'Too many attempts. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

function classify(input: string): { kind: 'email'; email: string } | { kind: 'phone'; phone: string } | { kind: 'invalid' } {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'invalid' };
  if (trimmed.includes('@')) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { kind: 'email', email: trimmed.toLowerCase() };
    }
    return { kind: 'invalid' };
  }
  const normalized = normalizePhoneE164(trimmed);
  if (normalized) return { kind: 'phone', phone: normalized };
  return { kind: 'invalid' };
}

// Same legacy-format fallback as /api/auth/resolve-identifier so
// residents whose phone was stored in pre-E.164 shape can still
// get their reset code.
function legacyPhoneVariants(e164: string): string[] {
  const out = new Set<string>();
  if (e164.startsWith('+')) out.add(e164.slice(1));
  if (e164.startsWith('+91') && e164.length === 13) {
    out.add(e164.slice(3));
    out.add(`0${e164.slice(3)}`);
  }
  return Array.from(out);
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipCheck = consume(`fp:lookup:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  let body: LookupPayload;
  try {
    body = (await req.json()) as LookupPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw = body.identifier?.trim() ?? '';
  if (!raw) {
    return NextResponse.json({ error: 'identifier is required' }, { status: 400 });
  }

  const classified = classify(raw);
  if (classified.kind === 'invalid') {
    return NextResponse.json(
      { error: 'Enter a valid email or phone number' },
      { status: 400 },
    );
  }

  // Per-identifier limit too — separate from the IP one. Keeps a
  // single user's typo storm from also blocking everyone behind
  // the same NAT.
  const identKey = classified.kind === 'email' ? `e:${classified.email}` : `p:${classified.phone}`;
  const identCheck = consume(`fp:lookup:${identKey}`, IDENT_LIMIT, IDENT_WINDOW_MS);
  if (!identCheck.allowed) return tooManyRequests(identCheck.retryAfterMs);

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      {
        ok: true,
        // Pretend we found nothing so prod misconfiguration looks
        // identical to "no such account" from the caller's side.
        // Misconfig will surface in server logs / health checks
        // through other paths.
        lookup_id: null,
        has_email: false,
        has_telegram: false,
        masked_email: null,
        masked_telegram: null,
        notice: 'Service unavailable, please try again later.',
      },
      { status: 200 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Resolve to a single profile.
  let profileId: string | null = null;
  let profileEmail: string | null = null;

  if (classified.kind === 'email') {
    const { data } = await admin
      .from('profiles')
      .select('id, email')
      .eq('email', classified.email)
      .maybeSingle();
    if (data) {
      profileId = data.id;
      profileEmail = data.email;
    }
  } else {
    const { data: primary } = await admin
      .from('profiles')
      .select('id, email')
      .eq('phone', classified.phone)
      .maybeSingle();
    if (primary) {
      profileId = primary.id;
      profileEmail = primary.email;
    } else {
      const variants = legacyPhoneVariants(classified.phone);
      if (variants.length > 0) {
        const { data: legacy } = await admin
          .from('profiles')
          .select('id, email')
          .in('phone', variants)
          .limit(1)
          .maybeSingle();
        if (legacy) {
          profileId = legacy.id;
          profileEmail = legacy.email;
        }
      }
    }
  }

  // Account-not-found path. Return a 200 with empty channel info
  // so this case is indistinguishable from "found but no channels".
  if (!profileId) {
    return NextResponse.json({
      ok: true,
      lookup_id: null,
      has_email: false,
      has_telegram: false,
      masked_email: null,
      masked_telegram: null,
    });
  }

  // Telegram link lookup. Inactive links don't count.
  const { data: tg } = await admin
    .from('telegram_links')
    .select('username, first_name, is_active')
    .eq('user_id', profileId)
    .eq('is_active', true)
    .maybeSingle();

  // We treat synthetic phone-only signup emails as "no email channel"
  // — they look like phone+1714155-…@aaditri.invalid. The resident
  // can't actually receive mail there.
  const hasRealEmail = Boolean(
    profileEmail && !profileEmail.endsWith('@aaditri.invalid'),
  );
  const hasTelegram = Boolean(tg);

  return NextResponse.json({
    ok: true,
    lookup_id: mintLookupToken(profileId),
    has_email: hasRealEmail,
    has_telegram: hasTelegram,
    masked_email: hasRealEmail ? maskEmail(profileEmail) : null,
    masked_telegram: hasTelegram
      ? maskTelegramHandle({
          username: (tg as { username: string | null }).username,
          firstName: (tg as { first_name: string | null }).first_name,
        })
      : null,
  });
}
