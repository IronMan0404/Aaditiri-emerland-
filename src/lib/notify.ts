import 'server-only';
import { after } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { sendPushToUsers, isPushConfigured } from '@/lib/push';
import { sendTelegramToUsers, isTelegramConfigured } from '@/lib/telegram';
import { ROUTING } from '@/lib/notify-routing';
import type {
  NotificationKind,
  NotificationPayloads,
  RenderedNotification,
} from '@/lib/notify-routing';
import { renderTelegramButtons } from '@/lib/channels/telegram-actions';

// ============================================================
// Multi-channel notification dispatcher.
//
// Single entry point for every "something happened, tell people"
// flow. Replaces ad-hoc sendPushToUsers / direct DM calls.
//
// Usage:
//
//   import { notify } from '@/lib/notify';
//
//   await notify('booking_submitted', booking.id, {
//     bookingId: booking.id,
//     requesterId: user.id,
//     facilityName: 'Pool',
//     whenLabel: 'Tomorrow 6\u20137 PM',
//   });
//
// Behaviour:
//
//   1. Resolve audience via ROUTING[kind].audience(payload).
//   2. Filter out users who muted (kind, channel) in their
//      notification_preferences (default = unmuted = receive).
//   3. Render channel copy via ROUTING[kind].render(payload).
//   4. Fan out to push + telegram in parallel:
//        - Push: every approved user with a sub gets the same body.
//        - Telegram: callback-action buttons (Approve / Reject)
//          only land in admin DMs; everyone else sees the URL
//          buttons (or no buttons).
//   5. Dedup: telegram_notifications_sent enforces (kind, refId,
//      user) uniqueness, so concurrent crons can't double-send.
//   6. Write a notification_events audit row.
//
// Best-effort. A channel-level failure NEVER throws back to the
// caller. Worst case the audit row records the failure.
// ============================================================

interface ChannelOutcome {
  attempted: number;
  sent: number;
  failed: number;
  skipped?: string;
}

type Outcome = {
  audienceSize: number;
  pushOutcome: ChannelOutcome;
  telegramOutcome: ChannelOutcome;
  error?: string;
};

const ZERO: ChannelOutcome = { attempted: 0, sent: 0, failed: 0 };

async function readMutedUsers(
  kind: NotificationKind,
  channel: 'push' | 'telegram',
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('notification_preferences')
    .select('user_id')
    .eq('kind', kind)
    .eq('channel', channel)
    .eq('muted', true)
    .in('user_id', userIds);
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
}

async function pickAdmins(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('profiles')
    .select('id')
    .in('id', userIds)
    .eq('role', 'admin');
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

async function writeAudit(
  kind: NotificationKind,
  refId: string,
  audienceSize: number,
  pushOutcome: ChannelOutcome,
  telegramOutcome: ChannelOutcome,
  error?: string,
): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    await admin.from('notification_events').insert({
      kind,
      ref_id: refId,
      audience_size: audienceSize,
      push_outcome: pushOutcome,
      telegram_outcome: telegramOutcome,
      error: error ?? null,
    });
  } catch (err) {
    console.error('[notify] failed to write audit row', err);
  }
}

function absolutize(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return base ? `${base}${pathOrUrl}` : pathOrUrl;
}

function absolutizeButtons(
  buttons: { text: string; url: string }[],
): { text: string; url: string }[] {
  return buttons.map((b) => ({ text: b.text, url: absolutize(b.url) }));
}

export async function notify<K extends NotificationKind>(
  kind: K,
  refId: string,
  payload: NotificationPayloads[K],
): Promise<Outcome> {
  const admin = createAdminSupabaseClient();
  const entry = ROUTING[kind];

  // 1. Audience + render
  let audience: string[] = [];
  let rendered: RenderedNotification | null = null;
  try {
    audience = await (entry.audience as (
      p: NotificationPayloads[K],
      sb: typeof admin,
    ) => Promise<string[]>)(payload, admin);
    rendered = (entry.render as (p: NotificationPayloads[K]) => RenderedNotification)(payload);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'render/audience error';
    await writeAudit(kind, refId, 0, ZERO, ZERO, error);
    return { audienceSize: 0, pushOutcome: ZERO, telegramOutcome: ZERO, error };
  }

  if (audience.length === 0 || !rendered) {
    await writeAudit(kind, refId, 0, ZERO, ZERO);
    return { audienceSize: 0, pushOutcome: ZERO, telegramOutcome: ZERO };
  }

  // 2. Mute filtering (per channel).
  const [mutedPush, mutedTg] = await Promise.all([
    readMutedUsers(kind, 'push', audience),
    readMutedUsers(kind, 'telegram', audience),
  ]);

  const pushTargets = audience.filter((id) => !mutedPush.has(id));
  const tgTargets = audience.filter((id) => !mutedTg.has(id));

  const buttonsSplit = renderTelegramButtons(rendered.telegram.buttons);
  const urlButtonsAbs = absolutizeButtons(buttonsSplit.urlButtons);
  const hasCallbackButtons = buttonsSplit.callbackButtons.length > 0;

  // 3. Push fan-out (channel #1).
  const pushPromise = (async (): Promise<ChannelOutcome> => {
    if (!isPushConfigured()) return { ...ZERO, skipped: 'not_configured' };
    if (pushTargets.length === 0) return { ...ZERO, skipped: 'all_muted' };
    const r = await sendPushToUsers(pushTargets, {
      title: rendered.push.title,
      body: rendered.push.body,
      url: absolutize(rendered.push.url),
      tag: rendered.push.tag,
    });
    return { attempted: r.attempted, sent: r.sent, failed: r.failed };
  })();

  // 4. Telegram fan-out (channel #2). Admin recipients get the
  // callback buttons too; non-admins get the URL buttons only.
  const telegramPromise = (async (): Promise<ChannelOutcome> => {
    if (!isTelegramConfigured()) return { ...ZERO, skipped: 'not_configured' };
    if (tgTargets.length === 0) return { ...ZERO, skipped: 'all_muted' };

    // If there are callback buttons, partition the audience into
    // admins (get the callback version) and non-admins (URL only).
    let adminSet = new Set<string>();
    if (hasCallbackButtons) {
      adminSet = await pickAdmins(tgTargets);
    }

    const adminTargets = tgTargets.filter((id) => adminSet.has(id));
    const nonAdminTargets = tgTargets.filter((id) => !adminSet.has(id));

    let attempted = 0;
    let sent = 0;
    let failed = 0;

    // Admin recipients: callback buttons + url buttons.
    if (adminTargets.length > 0) {
      // Telegram inline_keyboard in our wrapper is a single row of
      // {text, url} pairs; for callback buttons we send them via
      // a tiny dedicated path that builds the appropriate payload
      // shape and goes through sendMessage directly. We do that
      // by bypassing sendTelegramToUsers and using the existing
      // helper inside src/lib/telegram.ts.
      const r = await sendTelegramWithMixedButtons(
        adminTargets,
        rendered.telegram.text,
        urlButtonsAbs,
        buttonsSplit.callbackButtons,
        { kind, refId },
      );
      attempted += r.attempted;
      sent += r.sent;
      failed += r.failed;
    }

    // Non-admin recipients: URL buttons only (or no buttons).
    if (nonAdminTargets.length > 0) {
      const r = await sendTelegramToUsers(nonAdminTargets, {
        text: rendered.telegram.text,
        parseMode: 'MarkdownV2',
        buttons: urlButtonsAbs.length ? urlButtonsAbs : undefined,
        dedup: { kind, refId },
      });
      attempted += r.attempted;
      sent += r.sent;
      failed += r.failed;
    }

    return { attempted, sent, failed };
  })();

  const [pushOutcome, telegramOutcome] = await Promise.all([
    pushPromise,
    telegramPromise,
  ]);

  await writeAudit(kind, refId, audience.length, pushOutcome, telegramOutcome);

  return { audienceSize: audience.length, pushOutcome, telegramOutcome };
}

// ============================================================
// Fire-and-forget wrapper that runs notify() AFTER the response
// has been streamed back via Next's `after()` (Vercel `waitUntil`).
//
// Why this exists:
//   On Vercel serverless, an un-awaited promise inside a route
//   handler is silently killed the moment the function returns. We
//   discovered this in production when /api/bookings inserted rows
//   correctly but never wrote a notification_events row — the
//   `notify().catch(() => {})` call started, and the platform
//   yanked the runtime out from under it before the dispatcher
//   could finish reading audience / firing channels. Symptoms:
//   booking succeeds, no push, no Telegram, empty audit log.
//
// Use this from any route handler that wants to dispatch but
// doesn't need to surface the outcome to the caller. If the caller
// IS interested in the outcome (e.g. the broadcasts API returns
// the per-channel result to its UI), keep using `await notify()`.
//
// Falls back to inline best-effort if `after()` isn't available
// (e.g. when called from a non-request context like a script). In
// that case the work runs inline + the call site keeps waiting,
// which is fine — that path is non-serverless.
// ============================================================
export function notifyAfter<K extends NotificationKind>(
  kind: K,
  refId: string,
  payload: NotificationPayloads[K],
): void {
  const work = async (): Promise<void> => {
    try {
      await notify(kind, refId, payload);
    } catch (err) {
      console.error(`[notify] ${kind}/${refId} failed`, err);
    }
  };
  try {
    after(work);
  } catch (err) {
    console.error('[notify] after() unavailable, running inline', err);
    void work();
  }
}

// ============================================================
// Internal: send a Telegram message that mixes URL + callback
// buttons. Used only for admin recipients.
// ============================================================
import { callTelegram } from '@/lib/telegram';

interface MixedButtonResult {
  attempted: number;
  sent: number;
  failed: number;
}

async function sendTelegramWithMixedButtons(
  userIds: string[],
  text: string,
  urlButtons: { text: string; url: string }[],
  callbackButtons: { text: string; callbackData: string }[],
  dedup: { kind: NotificationKind; refId: string },
): Promise<MixedButtonResult> {
  const admin = createAdminSupabaseClient();

  const { data: links } = await admin
    .from('telegram_links')
    .select('user_id, chat_id')
    .eq('is_active', true)
    .in('user_id', userIds);
  const rows = (links ?? []) as { user_id: string; chat_id: number }[];
  if (rows.length === 0) return { attempted: 0, sent: 0, failed: 0 };

  // Reserve dedup tuples — only send to user_ids that aren't
  // already in the ledger for this (kind, refId).
  const dedupRows = rows.map((r) => ({
    user_id: r.user_id,
    kind: dedup.kind,
    ref_id: dedup.refId,
  }));
  const { data: reserved } = await admin
    .from('telegram_notifications_sent')
    .upsert(dedupRows, { onConflict: 'kind,ref_id,user_id', ignoreDuplicates: true })
    .select('user_id');
  const reservedSet = new Set((reserved ?? []).map((r: { user_id: string }) => r.user_id));
  const sendable = rows.filter((r) => reservedSet.has(r.user_id));
  if (sendable.length === 0) return { attempted: 0, sent: 0, failed: 0 };

  // Build the inline keyboard. Two rows: callback buttons first
  // (the action), URL buttons below (the "Open in app" escape
  // hatch). Telegram limits 8 columns per row; we have at most 3
  // of each so a flat row each is fine.
  const inlineKeyboard: { text: string; url?: string; callback_data?: string }[][] = [];
  if (callbackButtons.length) {
    inlineKeyboard.push(
      callbackButtons.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    );
  }
  if (urlButtons.length) {
    inlineKeyboard.push(urlButtons.map((b) => ({ text: b.text, url: b.url })));
  }

  let sent = 0;
  let failed = 0;
  await Promise.all(
    sendable.map(async (row) => {
      const res = await callTelegram('sendMessage', {
        chat_id: row.chat_id,
        text,
        parse_mode: 'MarkdownV2',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
      if (res.ok) sent += 1;
      else failed += 1;
    }),
  );

  return { attempted: sendable.length, sent, failed };
}
