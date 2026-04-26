import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { callTelegram, escapeMarkdownV2 } from '@/lib/telegram';
import {
  approveRegistration,
  rejectRegistration,
  type DecisionActor,
} from '@/lib/decisions/registrations';
import {
  approveSubscription,
  rejectSubscription,
} from '@/lib/decisions/subscriptions';
import {
  approveBooking,
  rejectBooking,
} from '@/lib/decisions/bookings';

// ============================================================
// Telegram inline-button helpers + admin callback dispatcher.
//
// Two responsibilities:
//
//   1. renderTelegramButtons(buttons)
//      Splits the routing-table button list into:
//        - urlButtons    : safe to send to anyone (open in app)
//        - callbackButtons: admin-actionable (Approve / Reject)
//
//   2. handleCallbackQuery(update)
//      Called by /api/telegram/webhook when Telegram delivers a
//      callback_query (someone tapped Approve/Reject). Verifies:
//        - the chat is paired
//        - the paired user is currently role='admin'
//        - the action is one of the documented patterns
//      Then runs the action and replies to Telegram.
//
// Action callback_data format:  "<resource>:<verb>:<id>"
//   reg:approve:<profileId>      → registration approve
//   reg:reject:<profileId>       → registration reject
//   sub:approve:<subscriptionId> → clubhouse subscription approve
//   sub:reject:<subscriptionId>  → clubhouse subscription reject
//   bk:approve:<bookingId>       → booking approve
//   bk:reject:<bookingId>        → booking reject
//
// The verbs are intentionally short — Telegram limits
// callback_data to 64 bytes including the colons and the UUID.
// ============================================================

interface RoutingButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface SplitButtons {
  /** Buttons that point at a URL — safe to broadcast to anyone. */
  urlButtons: { text: string; url: string }[];
  /** Buttons that fire a callback_query — admin-actionable. */
  callbackButtons: { text: string; callbackData: string }[];
}

export function renderTelegramButtons(buttons?: RoutingButton[]): SplitButtons {
  const urlButtons: { text: string; url: string }[] = [];
  const callbackButtons: { text: string; callbackData: string }[] = [];
  for (const b of buttons ?? []) {
    if (b.url) urlButtons.push({ text: b.text, url: b.url });
    else if (b.callbackData) callbackButtons.push({ text: b.text, callbackData: b.callbackData });
  }
  return { urlButtons, callbackButtons };
}

// ============================================================
// Callback dispatcher
// ============================================================

interface TgCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  message?: {
    message_id: number;
    chat: { id: number };
  };
  data?: string;
}

/**
 * Reply to the callback_query (so Telegram dismisses the spinner
 * on the user's button) and optionally show a toast.
 */
async function answerCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

/**
 * Edit the original message to disable the buttons after an
 * action lands, so a second admin can't double-click. We keep the
 * message text and only strip the keyboard.
 */
async function disableButtons(chatId: number, messageId: number, suffix: string): Promise<void> {
  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: suffix,
    parse_mode: 'MarkdownV2',
  });
}

interface ActingAdmin {
  userId: string;
  fullName: string;
  email: string | null;
}

async function resolveActingAdmin(tgUserId: number): Promise<ActingAdmin | null> {
  const admin = createAdminSupabaseClient();
  // Defence in depth: even though the partial unique index
  // telegram_links_one_active_per_chat (20260504) guarantees at most
  // one active row per chat, we filter on is_active = true and use
  // .maybeSingle() with an explicit row count cap so a historical
  // duplicate (or a constraint failure during a hot migration)
  // surfaces as "not linked" rather than silently mis-authorising
  // an admin action against the wrong profile.
  const { data: link, error: linkErr } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('chat_id', tgUserId)
    .eq('is_active', true)
    .limit(2)
    .maybeSingle();
  if (linkErr || !link) return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', link.user_id)
    .maybeSingle();
  if (!profile || profile.role !== 'admin') return null;
  return {
    userId: profile.id,
    fullName: profile.full_name ?? 'admin',
    email: profile.email ?? null,
  };
}

function actorFromAdmin(admin: ActingAdmin): DecisionActor {
  return {
    id: admin.userId,
    fullName: admin.fullName,
    email: admin.email,
    via: 'telegram',
  };
}

// ============================================================
// Two-step reject state machine
// ============================================================
//
// When admin taps ❌ Reject we don't act immediately — we record a
// telegram_pending_actions row keyed by chat_id, prompt the admin
// for a reason, and let the webhook's free-text-message handler
// finish the job. See migrations/20260502_telegram_pending_actions.sql.

const PENDING_TTL_MS = 10 * 60 * 1000;

async function setPendingAction(
  chatId: number,
  acting: ActingAdmin,
  action: string,
  originMessageId: number,
): Promise<void> {
  const sb = createAdminSupabaseClient();
  await sb.from('telegram_pending_actions').upsert(
    {
      chat_id: chatId,
      user_id: acting.userId,
      action,
      created_at: new Date().toISOString(),
      origin_chat_id: chatId,
      origin_message_id: originMessageId,
    },
    { onConflict: 'chat_id' },
  );
}

interface PendingAction {
  chat_id: number;
  user_id: string;
  action: string;
  created_at: string;
  origin_chat_id: number | null;
  origin_message_id: number | null;
}

export async function readPendingAction(chatId: number): Promise<PendingAction | null> {
  const sb = createAdminSupabaseClient();
  const { data } = await sb
    .from('telegram_pending_actions')
    .select('chat_id, user_id, action, created_at, origin_chat_id, origin_message_id')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (!data) return null;
  // Soft TTL — we still return the row but the caller decides what
  // to do based on age. Keeping it stored means we don't lose the
  // origin_message_id when admins are slow.
  return data as PendingAction;
}

export async function clearPendingAction(chatId: number): Promise<void> {
  const sb = createAdminSupabaseClient();
  await sb.from('telegram_pending_actions').delete().eq('chat_id', chatId);
}

export function isPendingActionExpired(pending: PendingAction): boolean {
  return Date.now() - new Date(pending.created_at).getTime() > PENDING_TTL_MS;
}

// ============================================================
// Action runners.
//
// Each one delegates to a shared helper in src/lib/decisions/* so
// the Telegram path triggers the EXACT same side effects as the web
// path (DB write + audit log + notify dispatch). This is the
// architectural commitment that keeps "admin approves via Telegram"
// from quietly skipping welcome emails, audit rows, etc.
// ============================================================

interface RunnerResult {
  ok: boolean;
  /** Short label for the disabled message ("Approved by ...") */
  label: string;
}

async function runRegistrationApprove(
  profileId: string,
  acting: ActingAdmin,
): Promise<RunnerResult> {
  const r = await approveRegistration(profileId, actorFromAdmin(acting));
  return { ok: r.ok, label: r.label };
}

async function runRegistrationReject(
  profileId: string,
  reason: string,
  acting: ActingAdmin,
): Promise<RunnerResult> {
  const r = await rejectRegistration(profileId, reason, actorFromAdmin(acting));
  return { ok: r.ok, label: r.label };
}

async function runSubscriptionApprove(id: string, acting: ActingAdmin): Promise<RunnerResult> {
  const r = await approveSubscription(id, actorFromAdmin(acting));
  return { ok: r.ok, label: r.label };
}

async function runSubscriptionReject(
  id: string,
  reason: string,
  acting: ActingAdmin,
): Promise<RunnerResult> {
  const r = await rejectSubscription(id, reason, actorFromAdmin(acting));
  return { ok: r.ok, label: r.label };
}
async function runBookingApprove(id: string, acting: ActingAdmin): Promise<RunnerResult> {
  const r = await approveBooking(id, actorFromAdmin(acting));
  return { ok: r.ok, label: r.label };
}

async function runBookingReject(
  id: string,
  reason: string,
  acting: ActingAdmin,
): Promise<RunnerResult> {
  const r = await rejectBooking(id, reason, actorFromAdmin(acting));
  return { ok: r.ok, label: r.label };
}

/**
 * Webhook entry point for callback_query updates. Returns void —
 * we always answer the callback so Telegram dismisses the spinner.
 *
 * Approve flows fire immediately. Reject flows park a row in
 * telegram_pending_actions and prompt the admin for a reason; the
 * actual rejection happens in finalisePendingReject() when the
 * admin's next message arrives.
 */
export async function handleCallbackQuery(query: TgCallbackQuery): Promise<void> {
  const data = query.data ?? '';
  const message = query.message;
  if (!message) {
    await answerCallback(query.id);
    return;
  }

  const acting = await resolveActingAdmin(message.chat.id);
  if (!acting) {
    await answerCallback(query.id, 'Only admins can take this action.', true);
    return;
  }

  // Parse "<resource>:<verb>:<id>"
  const m = data.match(/^([a-z]+):(approve|reject):([0-9a-f-]{8,})$/i);
  if (!m) {
    await answerCallback(query.id, 'Unknown action.', true);
    return;
  }
  const [, resource, verb, id] = m;

  // ── REJECT path: ask for a reason in the next message ─────────
  if (verb === 'reject') {
    await setPendingAction(message.chat.id, acting, data, message.message_id);
    await answerCallback(query.id, 'Reply with a reason for rejection.');
    await callTelegram('sendMessage', {
      chat_id: message.chat.id,
      text: [
        '*Reply with a reason for rejection*',
        '_The next message you send will be used as the rejection note\\. You have 10 minutes\\._',
      ].join('\n'),
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  // ── APPROVE path: act immediately ─────────────────────────────
  let result: RunnerResult;
  switch (resource) {
    case 'reg':
      result = await runRegistrationApprove(id, acting);
      break;
    case 'sub':
      result = await runSubscriptionApprove(id, acting);
      break;
    case 'bk':
      result = await runBookingApprove(id, acting);
      break;
    default:
      await answerCallback(query.id, 'Unknown action.', true);
      return;
  }

  if (!result.ok) {
    await answerCallback(
      query.id,
      result.label || 'Could not apply that action (it may have already been resolved).',
      true,
    );
    return;
  }

  await answerCallback(query.id, result.label);
  await disableButtons(
    message.chat.id,
    message.message_id,
    `_${escapeMarkdownV2(result.label)}_`,
  );
}

/**
 * Called by the webhook's free-text-message handler when there's a
 * pending action for this chat. The message text becomes the
 * rejection reason. Returns true if the message was consumed (i.e.
 * we treated it as a rejection reason), false if there was no
 * pending action or it had expired.
 */
export async function finalisePendingReject(
  chatId: number,
  reasonText: string,
): Promise<boolean> {
  const pending = await readPendingAction(chatId);
  if (!pending) return false;
  if (isPendingActionExpired(pending)) {
    await clearPendingAction(chatId);
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '_Rejection prompt expired \\(>10 min\\)\\. Please tap Reject again\\._',
      parse_mode: 'MarkdownV2',
    });
    return true;
  }

  // Re-confirm the user is still an admin (in case privileges were
  // revoked between the tap and the reply).
  const acting = await resolveActingAdmin(chatId);
  if (!acting || acting.userId !== pending.user_id) {
    await clearPendingAction(chatId);
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Only admins can complete a rejection.',
    });
    return true;
  }

  const m = pending.action.match(/^([a-z]+):reject:([0-9a-f-]{8,})$/i);
  if (!m) {
    await clearPendingAction(chatId);
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'That pending rejection was malformed; cleared.',
    });
    return true;
  }
  const [, resource, id] = m;

  let result: RunnerResult;
  switch (resource) {
    case 'reg':
      result = await runRegistrationReject(id, reasonText, acting);
      break;
    case 'sub':
      result = await runSubscriptionReject(id, reasonText, acting);
      break;
    case 'bk':
      result = await runBookingReject(id, reasonText, acting);
      break;
    default:
      await clearPendingAction(chatId);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Unknown rejection target; cleared.',
      });
      return true;
  }

  await clearPendingAction(chatId);

  if (!result.ok) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `Rejection failed: ${result.label}`,
    });
    return true;
  }

  // Edit the original notification message to disable its buttons
  // and append the verdict, mirroring what the Approve path does.
  if (pending.origin_chat_id && pending.origin_message_id) {
    await disableButtons(
      pending.origin_chat_id,
      pending.origin_message_id,
      `_${escapeMarkdownV2(result.label)}_\n_Reason: ${escapeMarkdownV2(reasonText.slice(0, 200))}_`,
    );
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: `_${escapeMarkdownV2(result.label)}_`,
    parse_mode: 'MarkdownV2',
  });
  return true;
}
