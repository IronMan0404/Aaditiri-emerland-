-- ============================================================
-- 2026-05-13 — Repeating scheduled reminders ("send until")
--
-- Original 20260506_scheduled_reminders.sql modelled a reminder
-- as single-fire: pick a `fire_on` date, the daily 09:00 IST
-- cron picks it up once, status flips to 'sent', done.
--
-- Admins routinely want to re-send the same reminder for
-- several mornings in a row (e.g. AGM voting closes Friday —
-- nudge daily Mon, Tue, Wed, Thu, Fri). Doing that today means
-- creating five identical rows, which is annoying and easy to
-- forget the last one.
--
-- This migration adds:
--
--   * send_until date   — optional end date (inclusive). NULL means
--                         single-fire (back-compat with existing
--                         rows). Set equal to fire_on for an
--                         explicit "today only".
--
--   * last_fired_on date — populated by the cron each time it
--                          fires the reminder. We use this to
--                          decide whether today's run still owes
--                          the row a fire (last_fired_on < today)
--                          and to render "fired N× through DATE"
--                          in the admin UI.
--
-- Lifecycle for a repeating row:
--
--   pending  ──[fire_on cron run]── pending (fired today)
--   pending  ──[fire_on+1 cron run]── pending (fired again)
--   ...
--   pending  ──[send_until cron run]── sent  (terminal)
--
-- The cron always uses an idempotent UPDATE-where-status-is-
-- pending-AND-last_fired_on-is-not-today guard, so a re-run of
-- the same cron pass on the same day can never double-fire.
-- ============================================================

alter table public.scheduled_reminders
  add column if not exists send_until date,
  add column if not exists last_fired_on date;

-- Sanity guard: send_until, when present, must not predate
-- fire_on. We don't enforce a hard upper bound (e.g. "no more
-- than 60 days") in the DB — that's a UX nudge, not a data-
-- integrity rule, and the API enforces the cap there.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_reminders_send_until_after_fire_on'
      and conrelid = 'public.scheduled_reminders'::regclass
  ) then
    alter table public.scheduled_reminders
      add constraint scheduled_reminders_send_until_after_fire_on
      check (send_until is null or send_until >= fire_on);
  end if;
end;
$$;

-- The cron's hot path is now "rows where status='pending' AND
-- (send_until IS NULL OR send_until >= today) AND fire_on <=
-- today AND (last_fired_on IS NULL OR last_fired_on < today)".
-- The existing (status, fire_on) index still helps; we add a
-- partial index targeting the live ones to keep the planner
-- honest as the table grows.
create index if not exists scheduled_reminders_live_idx
  on public.scheduled_reminders (status, fire_on, send_until)
  where status = 'pending';

comment on column public.scheduled_reminders.send_until is
  'Inclusive end date for repeating reminders. NULL means single-fire (legacy + the default for new rows that don''t opt in). Cron evaluates the row each day in IST until last_fired_on >= send_until, then flips status to sent.';

comment on column public.scheduled_reminders.last_fired_on is
  'IST date of the most recent successful fire. Cron uses this to skip rows already fired today (idempotency under retry) and to decide when the row should transition to status=sent.';

notify pgrst, 'reload schema';
