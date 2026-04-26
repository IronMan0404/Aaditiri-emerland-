import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { consume, getClientIp } from '@/lib/rate-limit';
import { consumeLookupToken } from '@/lib/forgot-password-token';
import { mintOtp } from '@/lib/forgot-password';
import {
  sendTelegramToUsers,
  isTelegramConfigured,
  escapeMarkdownV2,
} from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Step 2 of forgot-password: actually send the code.
//
// The client passes:
//   - lookup_id: the signed token from /lookup
//   - channel:   'telegram' | 'email'
//
// Telegram path (the new feature):
//   - mint a fresh OTP (hashed in DB, plaintext returned to us)
//   - DM it to every active telegram_links row for this user
//     (`sendTelegramToUsers` already handles dedup & retries)
//   - return { ok: true, channel: 'telegram', expiresInSec }
//
// Email path:
//   - we DON'T mint our own OTP — Supabase's
//     resetPasswordForEmail does its own thing. We just trigger
//     it through the admin API and let the existing email link
//     flow take over.
//   - return { ok: true, channel: 'email' }
//
// Rate limit on this endpoint is intentionally tight: the cost of
// each call is real (DM delivery, Supabase email quota) and we
// don't want a single hostile client spamming a resident's
// Telegram with codes. Per-profile cap = 3 / 30 min covers
// "I didn't get the first one, send another" without giving an
// attacker much room to flood.
// =============================================================

interface SendPayload {
  lookup_id?: string;
  channel?: 'telegram' | 'email';
}

const IP_LIMIT = 12;
const IP_WINDOW_MS = 15 * 60 * 1000;
const PROFILE_LIMIT = 3;
const PROFILE_WINDOW_MS = 30 * 60 * 1000;

function tooManyRequests(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: 'Too many requests. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipCheck = consume(`fp:send:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  let body: SendPayload;
  try {
    body = (await req.json()) as SendPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lookupId = (body.lookup_id ?? '').trim();
  const channel = body.channel;
  if (!lookupId) {
    return NextResponse.json({ error: 'lookup_id required' }, { status: 400 });
  }
  if (channel !== 'telegram' && channel !== 'email') {
    return NextResponse.json(
      { error: 'channel must be "telegram" or "email"' },
      { status: 400 },
    );
  }

  const verified = consumeLookupToken(lookupId);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }
  const profileId = verified.profileId;

  const profileCheck = consume(`fp:send:pid:${profileId}`, PROFILE_LIMIT, PROFILE_WINDOW_MS);
  if (!profileCheck.allowed) return tooManyRequests(profileCheck.retryAfterMs);

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      { error: 'Service unavailable. Please try again later.' },
      { status: 503 },
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', profileId)
    .maybeSingle();
  if (!profile) {
    // Shouldn't happen — the lookup_id was just minted from a real
    // row — but if profile got deleted in the interim, fail closed.
    return NextResponse.json({ error: 'Account no longer exists' }, { status: 404 });
  }

  if (channel === 'telegram') {
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: 'Telegram is not configured on this server.' },
        { status: 503 },
      );
    }

    // Look up THIS resident's chat — and ONLY this resident's chat.
    // We deliberately do not call sendTelegramToUsers([userId], ...)
    // here. That helper is fine for fan-out (broadcasts, registration
    // approvals, etc.), but for a password reset we want a tighter
    // contract: exactly one row, exactly one chat_id, and a defensive
    // check that this chat is not also bound to another app account.
    //
    // The partial unique index telegram_links_one_active_per_chat
    // (migration 20260504) is supposed to prevent the second case at
    // the DB level. We re-check it here in code so that even if the
    // index is somehow missing (forgot to run the migration on prod),
    // a reset OTP for resident A is NEVER delivered to a chat that
    // resident B also has an active link to.
    const { data: myLinks, error: linkErr } = await admin
      .from('telegram_links')
      .select('id, chat_id')
      .eq('user_id', profileId)
      .eq('is_active', true);
    if (linkErr) {
      return NextResponse.json(
        { error: 'Could not look up Telegram link.' },
        { status: 500 },
      );
    }
    if (!myLinks || myLinks.length === 0) {
      return NextResponse.json(
        { error: 'No active Telegram link found. Pick "Email" instead.' },
        { status: 409 },
      );
    }
    if (myLinks.length > 1) {
      // Should be impossible (telegram_links.user_id is unique), but
      // fail closed if it ever isn't.
      return NextResponse.json(
        {
          error:
            'Your Telegram pairing is in an inconsistent state. Re-pair the bot or pick "Email".',
        },
        { status: 409 },
      );
    }
    const chatId = (myLinks[0] as { chat_id: number }).chat_id;

    // Defense-in-depth: make sure this chat_id isn't also bound to a
    // different active app account. If it is, refuse — the reset OTP
    // would land in someone else's eyes.
    const { count: chatActiveLinks, error: countErr } = await admin
      .from('telegram_links')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('is_active', true);
    if (countErr) {
      return NextResponse.json(
        { error: 'Could not validate Telegram link.' },
        { status: 500 },
      );
    }
    if ((chatActiveLinks ?? 0) > 1) {
      // Two or more app accounts share this Telegram chat. We would
      // be DM-ing the OTP to a chat that another resident also reads.
      // Hard refuse and tell the user to use email instead. Fixing
      // requires the duplicate accounts to /unlink — handled by
      // /api/telegram/pair DELETE or by re-running migration 20260504
      // which auto-resolves duplicates by keeping only the most
      // recently linked row active.
      return NextResponse.json(
        {
          error:
            'Your Telegram chat is linked to more than one account on this server, so we cannot safely DM the reset code. Please use Email, or contact admin.',
        },
        { status: 409 },
      );
    }

    const minted = await mintOtp(profileId, 'telegram', req);
    if (!minted.ok) {
      return NextResponse.json({ error: minted.error }, { status: 500 });
    }

    const text = renderOtpTelegramMessage({
      otp: minted.otp,
      fullName: profile.full_name,
      ttlMinutes: Math.round((minted.expiresAt.getTime() - Date.now()) / 60000),
    });

    // sendTelegramToUsers re-resolves the chat_id from the same
    // telegram_links row we just validated. Safe because we've
    // already proven there's exactly one active link for this user
    // and exactly one active link for the resulting chat_id.
    const r = await sendTelegramToUsers([profileId], {
      text,
      parseMode: 'MarkdownV2',
    });

    if ('skipped' in r && r.skipped) {
      return NextResponse.json(
        { error: 'Telegram delivery is currently unavailable. Try email.' },
        { status: 503 },
      );
    }
    if (r.sent === 0) {
      return NextResponse.json(
        {
          error:
            r.deactivated > 0
              ? 'Your Telegram link is no longer reachable. Pair the bot again.'
              : 'Could not deliver the code. Try again or pick email.',
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      channel: 'telegram',
      expires_in_sec: Math.max(0, Math.round((minted.expiresAt.getTime() - Date.now()) / 1000)),
    });
  }

  // ---------- Email channel (legacy / fallback) ----------
  // Supabase's resetPasswordForEmail handles the email + reset link
  // by itself; we don't store anything in password_reset_otps for
  // this path. The Supabase Phone provider stays disabled.
  if (!profile.email || profile.email.endsWith('@aaditri.invalid')) {
    return NextResponse.json(
      {
        error:
          'No real email is on file for this account. Please use Telegram or contact admin.',
      },
      { status: 409 },
    );
  }

  const origin = (() => {
    const headerOrigin = req.headers.get('origin');
    if (headerOrigin) return headerOrigin;
    return (
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      'https://aaditiri-emerland.vercel.app'
    );
  })();

  const { error: resetErr } = await admin.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${origin}/auth/reset-password`,
  });
  if (resetErr) {
    return NextResponse.json({ error: resetErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, channel: 'email' });
}

// ----------------------------------------------------------------
// Telegram message renderer.
//
// MarkdownV2 has aggressive escaping rules: every `_*[]()~``>#+-=|{}.!` MUST
// be escaped except where used as actual markup. We use escapeMarkdownV2
// (already exported from src/lib/telegram.ts) for the user-controlled
// fields. The OTP itself is digits-only so it doesn't need escaping; it
// goes inside a `code` block via backticks for one-tap copy on the user's
// phone.
// ----------------------------------------------------------------

interface RenderArgs {
  otp: string;
  fullName: string | null;
  ttlMinutes: number;
}

function renderOtpTelegramMessage(args: RenderArgs): string {
  const greeting = args.fullName
    ? `Hi ${escapeMarkdownV2(args.fullName.split(' ')[0])},`
    : 'Hi there,';

  const lines = [
    '🔑 *Aaditri Emerland — password reset*',
    '',
    greeting,
    '',
    'Your one\\-time reset code is:',
    '',
    `\`${args.otp}\``,
    '',
    `It is valid for *${args.ttlMinutes}* minutes\\.`,
    '',
    '_If you did not request this, you can safely ignore this message — your password is unchanged\\._',
    '_The bot will *never* ask you to send this code back here\\._',
  ];
  return lines.join('\n');
}
