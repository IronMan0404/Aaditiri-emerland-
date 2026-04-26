import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { callTelegram, escapeMarkdownV2 } from '@/lib/telegram';
import {
  handleCallbackQuery,
  finalisePendingReject,
} from '@/lib/channels/telegram-actions';

// ============================================================
// Telegram bot webhook.
//
// Telegram POSTs every inbound update (message, edited message,
// callback query, etc.) to this URL. We:
//
//   1. Verify the X-Telegram-Bot-Api-Secret-Token header against
//      TELEGRAM_WEBHOOK_SECRET. Without this, any random caller
//      could feed us forged updates and impersonate residents.
//
//   2. Route on the message text:
//
//      /start <code>   pair the chat with the user that owns <code>
//      /start          generic welcome — ask them to pair from the app
//      /help           list available commands
//      /disconnect     revoke this chat's link
//
//   3. Respond with sendMessage. Replies are short and use
//      MarkdownV2 (with everything dynamic ESCAPED) so a hostile
//      pairing code can't inject markup.
//
// Two-way commands like /dues and /issue land in Step 4 — for now
// the webhook simply tells the user the command is coming soon.
//
// IMPORTANT: this endpoint must always return 200 OK, even on
// failure. Telegram retries non-2xx responses for hours, which
// would amplify any transient bug into a flood. We log + swallow.
// ============================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}

interface TgCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

function ok(): NextResponse {
  // Telegram only cares that we return 2xx — body is ignored.
  return NextResponse.json({ ok: true });
}

function isWebhookAuthorized(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    // Without a configured secret we refuse to process updates at
    // all. This is intentional — a bot that accepts every inbound
    // request is a hijack risk. The /api/telegram/init endpoint
    // sets the secret on Telegram's side at registration time.
    return false;
  }
  const got = request.headers.get('x-telegram-bot-api-secret-token');
  return got === expected;
}

async function reply(chatId: number, text: string): Promise<void> {
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    link_preview_options: { is_disabled: true },
  });
}

async function handleStart(message: TgMessage, args: string): Promise<void> {
  const chatId = message.chat.id;
  const code = args.trim();

  // Bare /start with no payload — generic welcome.
  if (!code) {
    await reply(
      chatId,
      [
        '*Aaditri Emerland Community Bot*',
        '',
        'I deliver society notifications \\(broadcasts, events, ticket updates, clubhouse\\) straight to your Telegram\\.',
        '',
        'To link this chat with your resident profile:',
        '1\\. Open the Aaditri Emerland app',
        '2\\. Profile → *Connect Telegram*',
        '3\\. Tap the link the app gives you',
        '',
        'Type /help for the full command list\\.',
      ].join('\n'),
    );
    return;
  }

  // /start <code> — pair flow.
  const admin = createAdminSupabaseClient();
  const { data: pairing, error } = await admin
    .from('telegram_pairings')
    .select('id, user_id, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle();

  if (error || !pairing) {
    await reply(
      chatId,
      'That pairing code is not valid\\. Generate a fresh one from your profile in the app and try again\\.',
    );
    return;
  }
  if (pairing.consumed_at) {
    await reply(chatId, 'That pairing code has already been used\\. Generate a new one if you want to re\\-link\\.');
    return;
  }
  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    await reply(chatId, 'That pairing code has expired \\(codes are valid for 15 minutes\\)\\. Generate a new one\\.');
    return;
  }

  // Mark consumed FIRST so racing /start <same-code> calls can't
  // both succeed. The .eq('consumed_at', null) guard makes the
  // update idempotent.
  const { data: claimed, error: claimErr } = await admin
    .from('telegram_pairings')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', pairing.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();
  if (claimErr || !claimed) {
    await reply(chatId, 'Could not claim that pairing code \\(it may have just been used\\)\\. Try again with a fresh code\\.');
    return;
  }

  // Upsert the link row. user_id is unique — re-pairing the *same*
  // app account replaces its old chat_id. The partial unique index
  // telegram_links_one_active_per_chat (20260504) blocks a *different*
  // app account from claiming a chat that's already actively linked,
  // which would otherwise mis-route notifications.
  const from = message.from;
  const { error: upsertErr } = await admin
    .from('telegram_links')
    .upsert(
      {
        user_id: pairing.user_id,
        chat_id: chatId,
        username: from?.username ?? null,
        first_name: from?.first_name ?? null,
        last_name: from?.last_name ?? null,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (upsertErr) {
    // Postgres 23505 = unique_violation. With our two unique constraints
    // (user_id PK + telegram_links_one_active_per_chat partial), the
    // only realistic 23505 here means *another* app account already
    // owns this chat. Surface a clear message so the human can /unlink
    // from the other account first instead of seeing "try again".
    const code = (upsertErr as { code?: string }).code;
    if (code === '23505') {
      await reply(
        chatId,
        'This Telegram chat is already linked to a different resident\\. ' +
        'Send /unlink from the other account first, then try /start with your code again\\.',
      );
      return;
    }
    await reply(chatId, 'Something went wrong saving the link\\. Please try again in a minute\\.');
    return;
  }

  // Look up the resident's name for a friendly confirmation. We
  // don't expose the flat number / role here.
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', pairing.user_id)
    .maybeSingle();
  const safeName = escapeMarkdownV2(profile?.full_name ?? 'resident');

  await reply(
    chatId,
    [
      `*Linked\\!* You are connected as ${safeName}\\.`,
      '',
      "You'll start receiving society notifications here\\. Type /help for commands or /disconnect to unlink any time\\.",
    ].join('\n'),
  );
}

async function handleHelp(chatId: number): Promise<void> {
  await reply(
    chatId,
    [
      '*Available commands*',
      '',
      '/start    — link this chat to your resident profile',
      '/help     — show this list',
      '/disconnect — unlink this chat',
      '',
      '_More commands \\(/dues, /issue\\) coming soon\\._',
    ].join('\n'),
  );
}

async function handleDisconnect(chatId: number): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('telegram_links')
    .delete()
    .eq('chat_id', chatId)
    .select('id');
  if (error) {
    await reply(chatId, 'Could not disconnect right now\\. Try again in a minute\\.');
    return;
  }
  if (!data || data.length === 0) {
    await reply(chatId, 'This chat is not currently linked to any account\\.');
    return;
  }
  await reply(
    chatId,
    'Disconnected\\. You will no longer receive notifications here\\. Re\\-link any time from your profile\\.',
  );
}

async function handleMessage(message: TgMessage): Promise<void> {
  // Only react to private chats. We don't currently support being
  // added to groups; if the user does it anyway we just ignore.
  if (message.chat.type !== 'private') return;

  const text = (message.text ?? '').trim();
  if (!text) return;

  // Update last_seen on any incoming text so admins can spot stale
  // pairings.
  if (message.from && !message.from.is_bot) {
    const admin = createAdminSupabaseClient();
    await admin
      .from('telegram_links')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('chat_id', message.chat.id);
  }

  // Parse "/cmd args..."
  const m = text.match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+(.*))?$/);
  if (m) {
    const cmd = m[1].toLowerCase();
    const args = m[2] ?? '';
    switch (cmd) {
      case 'start':
        await handleStart(message, args);
        return;
      case 'help':
        await handleHelp(message.chat.id);
        return;
      case 'disconnect':
        await handleDisconnect(message.chat.id);
        return;
      case 'dues':
      case 'issue':
        await reply(message.chat.id, '_That command is coming soon\\._');
        return;
      default:
        await reply(message.chat.id, 'Unknown command\\. Type /help to see what I can do\\.');
        return;
    }
  }

  // Free text — first check whether this admin tapped Reject on a
  // notification recently and is now sending the rejection reason.
  // If so, finalisePendingReject consumes the message and we stop.
  const consumed = await finalisePendingReject(message.chat.id, text);
  if (consumed) return;

  // Otherwise, gentle nudge.
  await reply(message.chat.id, 'I only understand commands right now\\. Try /help\\.');
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isWebhookAuthorized(request)) {
    // Don't leak a hint about whether the secret is set. Telegram
    // never sees this anyway when called by a forger.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return ok();
  }

  const message = update.message ?? update.edited_message;
  if (message) {
    try {
      await handleMessage(message);
    } catch (err) {
      // Swallow: we MUST 200 so Telegram doesn't retry storm us.
      console.error('[telegram-webhook] handler crashed', err);
    }
  }

  if (update.callback_query) {
    try {
      await handleCallbackQuery(update.callback_query);
    } catch (err) {
      console.error('[telegram-webhook] callback handler crashed', err);
    }
  }

  return ok();
}
