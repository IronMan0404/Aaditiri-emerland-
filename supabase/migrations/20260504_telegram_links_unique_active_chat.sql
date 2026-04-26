-- ============================================================
-- 2026-05-04 — telegram_links: enforce one active link per chat
--
-- Problem
-- -------
-- The original schema only constrained telegram_links by user_id
-- uniqueness. That left a hole: two distinct app accounts (A and B)
-- could both have an *active* row pointing to the same Telegram
-- chat_id. When that happens:
--
--   * resolveActingAdmin (src/lib/channels/telegram-actions.ts)
--     calls .eq('chat_id', X).maybeSingle() — when two rows match,
--     PostgREST/maybeSingle returns null + an error, and the
--     webhook silently rejects the legitimate admin's tap as
--     "not linked". Auth correctness bug.
--   * /api/telegram/pair would happily re-pair B's account to a
--     chat that already belongs to A, and any DM the bot sent for
--     "user A" would land on the shared chat. Notification
--     mis-delivery.
--
-- Fix
-- ---
-- Partial unique index over (chat_id) WHERE is_active. Soft-disabled
-- rows are excluded from the constraint, so the historical "user
-- blocked the bot" rows we keep around for re-pair history don't
-- collide with a fresh active link.
--
-- The webhook upsert in /api/telegram/webhook uses
--   .upsert(..., { onConflict: 'user_id' })
-- so it never tried to insert a duplicate-by-chat row by accident
-- before — but if account B sends /start with their own pairing
-- code from a Telegram chat that's already active for A, the
-- upsert will now hit this index and the webhook surfaces a
-- friendly error instead of silently mis-routing notifications.
-- ============================================================

create unique index if not exists telegram_links_one_active_per_chat
  on public.telegram_links (chat_id)
  where is_active = true;

-- One-time cleanup: if any historical duplicates already exist
-- (two active rows for the same chat_id), keep the most recently
-- linked one and soft-disable the rest. We don't delete because
-- the row may still be referenced by historical notification logs.
with ranked as (
  select
    id,
    row_number() over (
      partition by chat_id
      order by linked_at desc, id desc
    ) as rn
  from public.telegram_links
  where is_active = true
)
update public.telegram_links l
   set is_active = false,
       updated_at = now()
  from ranked r
 where l.id = r.id
   and r.rn > 1;

notify pgrst, 'reload schema';
