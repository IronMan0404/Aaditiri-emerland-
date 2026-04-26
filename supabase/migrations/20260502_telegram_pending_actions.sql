-- ============================================================
-- 2026-05-02 — Telegram two-step reject flow
--
-- Enables admins to reject registrations / bookings / clubhouse
-- subscription requests directly from a Telegram DM AND attach a
-- typed reason without leaving Telegram.
--
-- UX:
--   1. Admin taps ❌ Reject in the original notification message.
--      The webhook records a row in telegram_pending_actions
--      (one per admin chat) describing what they're rejecting.
--      The bot replies: "Reply with a reason for rejection."
--
--   2. Admin sends a plain-text message in the same chat.
--      The webhook sees there's a pending action for that chat,
--      treats the message text as the rejection reason, finalises
--      the rejection (writes to the target row + dispatches the
--      "decided" notification), and clears the pending row.
--
--   3. If the admin sends nothing for 10 minutes, the pending
--      row is treated as expired (filtered by the webhook) and
--      a new tap is required.
--
-- Why a table (and not, say, an in-memory map):
--   * the webhook runs on Vercel where every request is a fresh
--     serverless function invocation; in-memory state is lost.
--   * we want at-most-one pending action per admin chat, which is
--     exactly the unique constraint a row gives us.
--
-- Locked behind service_role only — admins never read this table
-- from the client.
-- ============================================================

create table if not exists public.telegram_pending_actions (
    -- One pending action per admin chat (UNIQUE on chat_id), so a
    -- second tap simply replaces the previous one.
    chat_id      bigint primary key,
    -- The admin user this pending action is for. We record this
    -- so the webhook can verify the typing user is still an admin
    -- when they send the reason.
    user_id      uuid not null references public.profiles(id) on delete cascade,
    -- "<resource>:<verb>:<id>" — same shape as Telegram callback_data.
    -- e.g. "reg:reject:8a1b...", "bk:reject:c3d4...", "sub:reject:9e2f...".
    -- Verb is currently always 'reject' but we keep the column generic
    -- for future actions (e.g. tag a ticket, snooze a reminder).
    action       text   not null,
    -- ISO timestamptz the row was created. The webhook treats anything
    -- older than 10 minutes as expired.
    created_at   timestamptz not null default now(),
    -- We re-use the original message id so the webhook can edit the
    -- original notification's keyboard once the rejection is
    -- finalised (strips buttons and appends "Rejected by X").
    origin_chat_id    bigint,
    origin_message_id bigint
);

create index if not exists telegram_pending_actions_user_idx
    on public.telegram_pending_actions(user_id);

create index if not exists telegram_pending_actions_created_idx
    on public.telegram_pending_actions(created_at desc);

alter table public.telegram_pending_actions enable row level security;

-- No RLS policies are intentional: every read/write goes through
-- the service-role client (createAdminSupabaseClient) inside the
-- webhook. Residents have no business reading this table.

comment on table public.telegram_pending_actions is
    'Short-lived per-admin Telegram pending actions awaiting a typed reason. Service-role only.';
