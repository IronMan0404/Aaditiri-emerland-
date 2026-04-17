/**
 * Admin-only debug endpoint: reports whether the server sees a Brevo API key
 * and what "From" address it would use. NEVER returns the key itself.
 *
 * Safe to delete once you've confirmed email is working end-to-end.
 *
 * Example:
 *   GET /api/_debug/email-status
 *   → {
 *       configured: true,
 *       from: "Aaditri Emerland Community <you@gmail.com>",
 *       keyFingerprint: "xkey…12"
 *     }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isEmailConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_FROM_NAME = 'Aaditri Emerland Community';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const rawKey = process.env.BREVO_API_KEY ?? '';
  const trimmed = rawKey.trim();
  const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim() ?? '';
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME;
  const from = fromAddress ? `${fromName} <${fromAddress}>` : null;

  // Fingerprint: first 4 + last 2 chars only. Gives enough to confirm the key
  // *changed* between sessions without ever leaking a working value.
  const keyFingerprint = trimmed.length >= 8
    ? `${trimmed.slice(0, 4)}…${trimmed.slice(-2)}`
    : trimmed.length > 0 ? '(short)' : null;

  return NextResponse.json({
    configured: isEmailConfigured(),
    from,
    keyFingerprint,
    // Diagnostics to catch common mistakes:
    hints: {
      keyRawLength: rawKey.length,
      keyTrimmedLength: trimmed.length,
      keyHasLeadingOrTrailingWhitespace: rawKey !== trimmed,
      keyStartsWithXkeysib: trimmed.startsWith('xkeysib-'),
      keyContainsQuotes: trimmed.includes('"') || trimmed.includes("'"),
      fromAddressPresent: Boolean(fromAddress),
      fromAddressLooksLikeEmail: /.+@.+\..+/.test(fromAddress),
    },
  });
}
