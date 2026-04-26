import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { callTelegram, escapeMarkdownV2 } from '@/lib/telegram';
import {
  handleCallbackQuery,
  finalisePendingReject,
} from '@/lib/channels/telegram-actions';
import { computeFlatDues, formatPaiseAsRupees } from '@/lib/dues';

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
// Two-way commands:
//
//   /dues           show the calling resident's pending dues
//                   across active collecting funds (their own flat
//                   only — never another resident's).
//
//   /issue          start a 2-step ticket-creation flow. The bot
//                   prompts for a title; the next non-/cancel
//                   message becomes the issue title. We park the
//                   "awaiting title" state in telegram_pending_actions
//                   keyed by chat_id, the same table the reject flow
//                   uses, with a distinct action prefix so the two
//                   flows can't collide.
//
//   /cancel         clear any pending two-step state for this chat.
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
      '/start \\<code\\> — link this chat to your resident profile',
      '/help — show this list',
      '/dues — your pending society dues',
      '/issue — raise a maintenance ticket',
      '/cancel — abort the current /issue or /reject step',
      '/disconnect — unlink this chat',
    ].join('\n'),
  );
}

// ============================================================
// Resident lookup (chat_id → linked profile)
// ============================================================
//
// Used by /dues and /issue. Unlike resolveActingAdmin (which is
// strict about role='admin'), this resolver returns ANY approved
// non-bot resident linked to the chat. Returns null if the chat
// is not paired or the profile is not approved.

interface LinkedResident {
  userId: string;
  fullName: string;
  flatNumber: string | null;
  isApproved: boolean;
}

async function resolveLinkedResident(chatId: number): Promise<LinkedResident | null> {
  const adb = createAdminSupabaseClient();
  const { data: link } = await adb
    .from('telegram_links')
    .select('user_id')
    .eq('chat_id', chatId)
    .eq('is_active', true)
    .limit(2)
    .maybeSingle();
  if (!link) return null;
  const { data: profile } = await adb
    .from('profiles')
    .select('id, full_name, flat_number, is_approved, is_bot')
    .eq('id', link.user_id)
    .maybeSingle();
  if (!profile || profile.is_bot) return null;
  return {
    userId: profile.id,
    fullName: profile.full_name ?? 'resident',
    flatNumber: profile.flat_number ?? null,
    isApproved: profile.is_approved === true,
  };
}

async function handleDues(chatId: number): Promise<void> {
  const me = await resolveLinkedResident(chatId);
  if (!me) {
    await reply(
      chatId,
      'This chat is not linked\\. Open the app → Profile → *Connect Telegram* to pair, then try /dues again\\.',
    );
    return;
  }
  if (!me.isApproved) {
    await reply(
      chatId,
      'Your account is still pending admin approval\\. Once you are approved you can check dues here\\.',
    );
    return;
  }
  if (!me.flatNumber) {
    await reply(
      chatId,
      'Your profile does not have a flat number on file\\. Update it in the app under *Profile* and try again\\.',
    );
    return;
  }

  const summary = await computeFlatDues(me.flatNumber);
  const safeFlat = escapeMarkdownV2(me.flatNumber);
  if (!summary) {
    await reply(
      chatId,
      [
        `*Flat ${safeFlat}* — *no pending dues* ✅`,
        '',
        'You are square on every active fund\\. Thank you\\!',
      ].join('\n'),
    );
    return;
  }

  const lines: string[] = [
    `*Flat ${safeFlat}* — pending dues`,
    '',
  ];
  for (const l of summary.lines) {
    lines.push(
      `• ${escapeMarkdownV2(l.fundName)}: ${escapeMarkdownV2(formatPaiseAsRupees(l.pendingPaise))}`,
    );
  }
  lines.push('');
  lines.push(
    `*Total outstanding:* ${escapeMarkdownV2(formatPaiseAsRupees(summary.totalPendingPaise))} across ${summary.lines.length} fund${summary.lines.length === 1 ? '' : 's'}`,
  );
  lines.push('');
  lines.push('_Pay offline to your treasurer; entries are reflected after admin marks them received\\._');
  await reply(chatId, lines.join('\n'));
}

// ============================================================
// /issue — two-step ticket creation
// ============================================================
//
// Flow:
//   1. Resident sends /issue.
//      → We upsert a telegram_pending_actions row with
//        action = 'issue:awaiting_title:<userId>'.
//      → Bot replies "Send a short title…".
//
//   2. Resident sends free text on the same chat.
//      → handleMessage's free-text branch first asks finalisePendingReject
//        (unrelated reject flow) — that returns false because our action
//        prefix is 'issue:', not '<resource>:reject:'.
//      → Then we call finalisePendingIssue, which inserts an
//        issues row using the service-role client (the resident has
//        no browser session here) and clears the pending row.
//
//   3. /cancel at any point clears the pending row.

async function startIssue(chatId: number): Promise<void> {
  const me = await resolveLinkedResident(chatId);
  if (!me) {
    await reply(
      chatId,
      'This chat is not linked\\. Open the app → Profile → *Connect Telegram* to pair, then try /issue again\\.',
    );
    return;
  }
  if (!me.isApproved) {
    await reply(
      chatId,
      'Your account is still pending admin approval\\. Once approved you can raise tickets from here or in the app\\.',
    );
    return;
  }

  // Park "awaiting title" state. We re-use telegram_pending_actions —
  // the existing reject flow only matches actions of shape
  // "<resource>:reject:<uuid>", so an "issue:awaiting_title:<userId>"
  // row will not be picked up by finalisePendingReject. The chat_id
  // primary key means a fresh /issue overwrites any stale state.
  const adb = createAdminSupabaseClient();
  await adb.from('telegram_pending_actions').upsert(
    {
      chat_id: chatId,
      user_id: me.userId,
      action: `issue:awaiting_title:${me.userId}`,
      created_at: new Date().toISOString(),
      origin_chat_id: chatId,
      origin_message_id: null,
    },
    { onConflict: 'chat_id' },
  );

  await reply(
    chatId,
    [
      '*Raise a new ticket*',
      '',
      'Send a short *title* describing the problem \\(one message, max 200 chars\\)\\. Examples:',
      '• Lift not working in C wing',
      '• Water leakage in basement',
      '',
      'Send /cancel to abort\\.',
    ].join('\n'),
  );
}

async function handleCancel(chatId: number): Promise<void> {
  const adb = createAdminSupabaseClient();
  const { data } = await adb
    .from('telegram_pending_actions')
    .delete()
    .eq('chat_id', chatId)
    .select('action');
  if (!data || data.length === 0) {
    await reply(chatId, 'Nothing to cancel\\.');
    return;
  }
  await reply(chatId, 'Cancelled\\.');
}

const ISSUE_TTL_MS = 10 * 60 * 1000;

/**
 * Returns true if the message was consumed as the title for a
 * pending /issue. Should be called BEFORE the unknown-text fallback
 * but AFTER finalisePendingReject (which has its own prefix).
 */
async function finalisePendingIssue(chatId: number, text: string): Promise<boolean> {
  const adb = createAdminSupabaseClient();
  const { data: pending } = await adb
    .from('telegram_pending_actions')
    .select('chat_id, user_id, action, created_at')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (!pending) return false;
  const action = pending.action as string;
  if (!action.startsWith('issue:awaiting_title:')) return false;

  // TTL check.
  const ageMs = Date.now() - new Date(pending.created_at as string).getTime();
  if (ageMs > ISSUE_TTL_MS) {
    await adb.from('telegram_pending_actions').delete().eq('chat_id', chatId);
    await reply(chatId, '_Your /issue prompt expired \\(>10 min\\)\\. Send /issue again to start over\\._');
    return true;
  }

  // Re-confirm the resident is still approved (defence in depth).
  const me = await resolveLinkedResident(chatId);
  if (!me || !me.isApproved || me.userId !== pending.user_id) {
    await adb.from('telegram_pending_actions').delete().eq('chat_id', chatId);
    await reply(chatId, 'Your account is no longer eligible to raise tickets\\.');
    return true;
  }

  const title = text.trim().slice(0, 200);
  if (title.length < 3) {
    await reply(chatId, 'That title is too short \\(minimum 3 characters\\)\\. Send a longer one or /cancel\\.');
    return true;
  }

  // Insert the issue row. category and description default to "other"
  // and the title (issues.description NOT NULL) — admins can edit the
  // ticket on the board if needed. We snapshot flat_number from the
  // resident's profile so admin filters keep working even if they
  // later move out.
  const description = `Raised via Telegram by ${me.fullName}.`;
  const { data: inserted, error } = await adb
    .from('issues')
    .insert({
      created_by: me.userId,
      title,
      description,
      category: 'other',
      priority: 'normal',
      status: 'todo',
      flat_number: me.flatNumber,
    })
    .select('id')
    .maybeSingle();

  // Clear the pending row regardless of insert outcome — we don't want
  // a stuck state.
  await adb.from('telegram_pending_actions').delete().eq('chat_id', chatId);

  if (error || !inserted) {
    console.error('[telegram-webhook] /issue insert failed', error);
    await reply(chatId, 'Could not raise the ticket right now\\. Try again in a minute or use the app\\.');
    return true;
  }

  await reply(
    chatId,
    [
      '*Ticket raised* ✅',
      '',
      `Title: ${escapeMarkdownV2(title)}`,
      'Status: *todo*',
      '',
      'You will get a Telegram notification when an admin updates the status\\. To add details or photos, open the ticket in the app under *Issues*\\.',
    ].join('\n'),
  );
  return true;
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
        await handleDues(message.chat.id);
        return;
      case 'issue':
        await startIssue(message.chat.id);
        return;
      case 'cancel':
        await handleCancel(message.chat.id);
        return;
      default:
        await reply(message.chat.id, 'Unknown command\\. Type /help to see what I can do\\.');
        return;
    }
  }

  // Free text — order matters here:
  //
  //   1. finalisePendingReject (admin reject reason)
  //      Only consumes rows whose action matches "<resource>:reject:<uuid>".
  //
  //   2. finalisePendingIssue (resident /issue title)
  //      Only consumes rows whose action starts with "issue:awaiting_title:".
  //
  // The two flows can never collide because their action prefixes are
  // disjoint. If neither claims the message we fall through to a nudge.
  const consumedReject = await finalisePendingReject(message.chat.id, text);
  if (consumedReject) return;

  const consumedIssue = await finalisePendingIssue(message.chat.id, text);
  if (consumedIssue) return;

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
