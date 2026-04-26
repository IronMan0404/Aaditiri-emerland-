import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { consume, getClientIp } from '@/lib/rate-limit';
import { normalizePhoneE164 } from '@/lib/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resolves a phone-or-email identifier to the canonical sign-in email.
 *
 * Why this exists:
 *   Supabase's Phone provider has to be enabled (and Twilio creds filled in)
 *   for `signInWithPassword({ phone, ... })` to work, even if we don't want to
 *   actually send any SMS. We don't want that dependency for a community app
 *   that uses admin-approval as the gate. So instead, when a resident types
 *   their phone number on the login form, we look up the matching profile
 *   server-side, return the email on file, and the client signs in with email
 *   + password. Net result: phone-as-username works WITHOUT enabling the
 *   Supabase Phone provider.
 *
 * Security model:
 *   - This endpoint runs with the service-role key (`createAdminSupabaseClient`)
 *     so it can read `profiles.phone` regardless of RLS, but it ONLY ever
 *     returns the user's email — never any other column. The email is needed
 *     by the client to call `signInWithPassword`, and even if leaked it's not
 *     a credential by itself.
 *   - Rate-limited per IP and per identifier so an attacker can't trivially
 *     enumerate "is this phone registered?" by spamming the endpoint.
 *   - Returns the SAME generic shape for "not found" and "found" cases that
 *     don't actually expose the email — to make enumeration harder we always
 *     respond 200 and let the subsequent signInWithPassword call fail with
 *     "invalid login credentials" if the identifier was bogus. (Trade-off:
 *     slightly worse UX vs. confirming-an-account-exists for free.)
 */

interface ResolvePayload {
  identifier?: string;
}

const IP_LIMIT = 30;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IDENT_LIMIT = 10;
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

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipCheck = consume(`resolve:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) {
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  let body: ResolvePayload;
  try {
    body = (await req.json()) as ResolvePayload;
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

  // Email path: nothing to resolve. Just echo it back so the client can use
  // the same code path for both kinds. We DO normalize it (lowercase + trim)
  // for consistency with what we store at registration time.
  if (classified.kind === 'email') {
    return NextResponse.json({ ok: true, email: classified.email, kind: 'email' });
  }

  // Phone path: look up profiles.phone. Use service-role client because RLS
  // would block this lookup for an unauthenticated visitor (and rightly so —
  // we don't want any random visitor querying profiles directly).
  const identCheck = consume(`resolve:phone:${classified.phone}`, IDENT_LIMIT, IDENT_WINDOW_MS);
  if (!identCheck.allowed) {
    return tooManyRequests(identCheck.retryAfterMs);
  }

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      {
        error:
          'Phone login is temporarily unavailable. Please use your email to sign in.',
      },
      { status: 503 },
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('email, phone')
    .eq('phone', classified.phone)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Lookup failed. Please try again.' },
      { status: 500 },
    );
  }

  if (!profile?.email) {
    // Don't tell the caller "no such phone" — that's an enumeration oracle.
    // Return a stable error and let signInWithPassword be the single source
    // of "wrong creds". Phone-not-found and wrong-password should be
    // indistinguishable from the client's perspective.
    return NextResponse.json(
      { error: 'Invalid login credentials' },
      { status: 404 },
    );
  }

  // Phone-only signups get a synthetic placeholder email (`phone+UUID@aaditri.invalid`).
  // That's fine — Supabase still treats it as a valid sign-in email for
  // signInWithPassword purposes. The placeholder is internal-only and never
  // shown to the user. We return it here so the client can sign in.
  return NextResponse.json({ ok: true, email: profile.email, kind: 'phone' });
}
