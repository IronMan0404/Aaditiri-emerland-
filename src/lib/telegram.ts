import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// ============================================================
// Telegram bot helper.
//
// Surface-level contract intentionally mirrors src/lib/push.ts:
//
//   sendTelegramToUsers(userIds, payload)
//   sendTelegramToAllResidents(payload)
//   isTelegramConfigured()
//
// All sends are best-effort. If the env isn't configured we return
// `{ skipped: 'not_configured' }` and the caller continues; the
// in-app row / push notification is still authoritative. Same
// philosophy as web push — Telegram is an enhancement, not a hard
// dependency.
//
// Dedup: callers can pass `dedup: { kind, ref_id }` and we'll
// register the (kind, ref_id, user_id) tuple in
// telegram_notifications_sent BEFORE sending. A unique constraint
// blocks the second attempt at the database level, so concurrent
// crons can't double-send.
//
// IMPORTANT: server-only. The module imports 'server-only' so it
// physically cannot be bundled into the browser, which is exactly
// what we want — the bot token bypasses every other auth check.
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';

const TG_API = 'https://api.telegram.org';

export interface TelegramPayload {
  text: string;
  // Optional inline button. Telegram supports a 2D array of buttons;
  // we keep it simple and accept a single row of {text, url} pairs.
  buttons?: { text: string; url: string }[];
  // If true, send as MarkdownV2 (which means the caller is responsible
  // for escaping). If omitted we send plain text.
  parseMode?: 'MarkdownV2' | 'HTML';
  // Don't trigger a sound on the recipient's phone (used for
  // low-priority notifications like "subscription nearing expiry").
  silent?: boolean;
  // Optional dedup key. If provided we register the tuple before
  // sending and refuse if it already exists. `kind` is whatever
  // string the dispatcher uses (see NotificationKind in
  // src/lib/notify-routing.ts) — the DB column is just text.
  dedup?: { kind: string; refId: string };
}

export interface TelegramFanOutResult {
  attempted: number;
  sent: number;
  failed: number;
  /** Telegram chat IDs we deactivated because the user blocked the bot. */
  deactivated: number;
  skipped?: 'not_configured';
}

interface LinkRow {
  user_id: string;
  chat_id: number;
}

export function isTelegramConfigured(): boolean {
  return Boolean(BOT_TOKEN);
}

export function getBotUsername(): string {
  return BOT_USERNAME;
}

/**
 * Escape user-supplied text for MarkdownV2 — Telegram's flavour is
 * picky and silently drops messages that contain unescaped reserved
 * characters. Reference: https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}

/**
 * Low-level wrapper around Telegram's sendMessage. Returns the
 * raw API response. Callers should generally not use this — prefer
 * sendTelegramToUsers — but the webhook needs it for /start replies.
 */
export async function callTelegram<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; description?: string; error_code?: number }> {
  if (!BOT_TOKEN) {
    return { ok: false, description: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  try {
    const res = await fetch(`${TG_API}/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // We never want long Telegram round-trips to block a request
      // handler. 8s is generous; the API is normally < 300ms.
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };
    return json;
  } catch (err) {
    return {
      ok: false,
      description: err instanceof Error ? err.message : 'fetch failed',
    };
  }
}

/**
 * Send a single message to one chat. Returns true on success.
 * Marks the link inactive if Telegram says the user blocked the bot
 * (error_code = 403, "Forbidden: bot was blocked by the user").
 */
async function sendOne(chatId: number, payload: TelegramPayload): Promise<{
  ok: boolean;
  blocked: boolean;
}> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: payload.text,
    disable_notification: payload.silent === true,
    link_preview_options: { is_disabled: true },
  };
  if (payload.parseMode) body.parse_mode = payload.parseMode;
  if (payload.buttons && payload.buttons.length > 0) {
    body.reply_markup = {
      inline_keyboard: [payload.buttons.map((b) => ({ text: b.text, url: b.url }))],
    };
  }

  const res = await callTelegram('sendMessage', body);
  if (res.ok) return { ok: true, blocked: false };

  // 403 means the user blocked the bot. Their chat_id is dead — we
  // soft-deactivate the link so future fan-outs skip them.
  const blocked = res.error_code === 403;
  return { ok: false, blocked };
}

async function deactivateLinks(chatIds: number[]): Promise<void> {
  if (chatIds.length === 0) return;
  const admin = createAdminSupabaseClient();
  await admin
    .from('telegram_links')
    .update({ is_active: false })
    .in('chat_id', chatIds);
}

/**
 * Reserve dedup tuples up-front. Inserts (kind, ref_id, user_id)
 * rows in telegram_notifications_sent and returns the user_ids that
 * were *successfully* inserted (i.e. that hadn't been notified
 * before). Conflicts are silently dropped. The caller then sends to
 * exactly the returned user_ids.
 */
async function reserveDedup(
  userIds: string[],
  dedup: { kind: string; refId: string },
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const admin = createAdminSupabaseClient();
  const rows = userIds.map((uid) => ({
    user_id: uid,
    kind: dedup.kind,
    ref_id: dedup.refId,
  }));
  const { data, error } = await admin
    .from('telegram_notifications_sent')
    .upsert(rows, { onConflict: 'kind,ref_id,user_id', ignoreDuplicates: true })
    .select('user_id');
  if (error || !data) return [];
  return (data as { user_id: string }[]).map((r) => r.user_id);
}

/**
 * Fan a payload out to a list of user IDs over Telegram. If `userIds`
 * is null we send to every approved, non-bot resident with an active
 * Telegram link. Mirrors sendPushToUsers for one-stop notification
 * pipelines.
 */
export async function sendTelegramToUsers(
  userIds: string[] | null,
  payload: TelegramPayload,
): Promise<TelegramFanOutResult> {
  if (!isTelegramConfigured()) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0, skipped: 'not_configured' };
  }

  const admin = createAdminSupabaseClient();

  let query = admin
    .from('telegram_links')
    .select('user_id, chat_id')
    .eq('is_active', true);
  if (userIds && userIds.length > 0) query = query.in('user_id', userIds);

  const { data, error } = await query;
  if (error || !data) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0 };
  }
  let links = data as LinkRow[];

  if (links.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0 };
  }

  // Apply dedup if requested.
  if (payload.dedup) {
    const allowedUserIds = new Set(
      await reserveDedup(
        links.map((l) => l.user_id),
        payload.dedup,
      ),
    );
    links = links.filter((l) => allowedUserIds.has(l.user_id));
    if (links.length === 0) {
      return { attempted: 0, sent: 0, failed: 0, deactivated: 0 };
    }
  }

  let sent = 0;
  let failed = 0;
  const blockedChatIds: number[] = [];

  // Telegram allows ~30 messages/sec. We're nowhere near that even
  // for a society-wide broadcast, so we just fire-and-await in
  // parallel chunks of 20.
  const CHUNK = 20;
  for (let i = 0; i < links.length; i += CHUNK) {
    const chunk = links.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (l) => {
        const r = await sendOne(l.chat_id, payload);
        if (r.ok) sent += 1;
        else {
          failed += 1;
          if (r.blocked) blockedChatIds.push(l.chat_id);
        }
      }),
    );
  }

  if (blockedChatIds.length) await deactivateLinks(blockedChatIds);

  return {
    attempted: links.length,
    sent,
    failed,
    deactivated: blockedChatIds.length,
  };
}

/** Convenience: fan out to every approved, non-bot resident. */
export async function sendTelegramToAllResidents(
  payload: TelegramPayload,
): Promise<TelegramFanOutResult> {
  if (!isTelegramConfigured()) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0, skipped: 'not_configured' };
  }
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('is_approved', true)
    .eq('is_bot', false);
  const ids = (data ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0 };
  }
  return sendTelegramToUsers(ids, payload);
}

/** Send to every admin — used for "new registration" / "new ticket" alerts. */
export async function sendTelegramToAdmins(
  payload: TelegramPayload,
): Promise<TelegramFanOutResult> {
  if (!isTelegramConfigured()) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0, skipped: 'not_configured' };
  }
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin');
  const ids = (data ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, deactivated: 0 };
  }
  return sendTelegramToUsers(ids, payload);
}

/**
 * Build a t.me deep-link the resident clicks to start the bot with
 * their pairing code already filled in. Telegram's `?start=<arg>`
 * delivers the arg to the bot as `/start <arg>` on first message.
 */
export function buildPairingDeepLink(code: string): string {
  const username = BOT_USERNAME || 'AaditriEmeraldBot';
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}
