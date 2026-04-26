-- ============================================================
-- 2026-05-06 — Scheduled reminders (admin-curated, society-wide)
--
-- Lets admins compose a reminder ahead of time, pick a fire date,
-- and have the daily cron auto-dispatch it as a society-wide push +
-- Telegram notification. Free-text only in this iteration; the
-- `kind` column is here so we can later add specialised types
-- (recurring dues nudge, fund-deadline ping, event-offset reminder)
-- without another migration.
--
-- Design notes:
--
--   * Daily firing cadence. Vercel Hobby crons can only run once a
--     day, so even though `fire_on` is a `date`, the actual delivery
--     time is "the next 03:30 UTC after fire_on", i.e. ~09:00 IST.
--     The admin UI explains this drift; we don't try to defeat it
--     here.
--
--   * One-shot only. There's no rrule, no "every Monday". Recurring
--     campaigns are modelled as discrete rows the admin recreates,
--     OR as a future `kind = 'dues_monthly'` row that the cron
--     interprets as "fire-and-clone-for-next-month". Out of scope
--     for this PR.
--
--   * Audience: 'all_residents' fixed for now. Adding flat-scoped
--     audiences later is just a new column + a new audience resolver
--     in src/lib/notify-routing.ts.
--
--   * Idempotency: cron flips status='pending' → 'sent' (or
--     'failed') in a single UPDATE so a retry of the cron pass
--     never double-sends. The dispatcher's own dedup ledger
--     (telegram_notifications_sent / push) is the second guard.
--
-- Locked behind admin RLS — residents have no business seeing
-- pending reminders.
-- ============================================================

create table if not exists public.scheduled_reminders (
    id uuid primary key default gen_random_uuid(),

    -- Discriminator. Currently only 'custom'; reserved values listed
    -- below for future iterations. Keep the check tight so a typo
    -- can't ship a phantom reminder type.
    kind text not null default 'custom'
        check (kind in ('custom')),

    -- Free-text content. `title` is the push/Telegram heading.
    -- `body` is the message body. We do not allow markdown — the
    -- renderer escapes everything for MarkdownV2 anyway.
    title text not null check (length(trim(title)) between 1 and 120),
    body  text not null check (length(trim(body))  between 1 and 1500),

    -- The IST date on which the reminder should be eligible to fire.
    -- Stored as `date` (no time component). The cron's "today in
    -- IST" comparison fires it at the next 03:30 UTC (= 09:00 IST)
    -- on or after this date. Setting fire_on in the past is
    -- explicitly allowed — the cron picks it up immediately on the
    -- next run.
    fire_on date not null,

    -- Reserved audience field. 'all_residents' for now; we plan to
    -- add 'flats:[A-101,A-102,...]' / 'flats_with_dues' later.
    audience text not null default 'all_residents'
        check (audience in ('all_residents')),

    -- Lifecycle:
    --   pending   — admin created it, not yet fired
    --   sent      — cron successfully dispatched (notify resolved)
    --   cancelled — admin cancelled before firing (terminal)
    --   failed    — cron tried and notify() threw (terminal; keeps
    --               error_message and the row stays as a paper
    --               trail). Admin can manually fire-now to retry.
    status text not null default 'pending'
        check (status in ('pending', 'sent', 'cancelled', 'failed')),

    -- Audit / telemetry.
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at    timestamptz,
    cancelled_at timestamptz,
    fired_count integer not null default 0,        -- Number of times notify() was attempted.
    error_message text,                            -- Latest failure message, if any.
    last_actor uuid references public.profiles(id) on delete set null
);

-- The cron's hot path is "give me everything ready to fire today".
-- A composite index on (status, fire_on) keeps that cheap even with
-- thousands of historical rows.
create index if not exists scheduled_reminders_status_fire_idx
    on public.scheduled_reminders (status, fire_on);

create index if not exists scheduled_reminders_created_at_idx
    on public.scheduled_reminders (created_at desc);

-- Auto-update `updated_at` so admins can see when a reminder was
-- last edited from the UI without us threading a timestamp through
-- every PATCH route.
create or replace function public.touch_scheduled_reminders_updated_at()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists scheduled_reminders_touch_updated_at on public.scheduled_reminders;
create trigger scheduled_reminders_touch_updated_at
    before update on public.scheduled_reminders
    for each row execute function public.touch_scheduled_reminders_updated_at();

-- RLS: admin-only, end-to-end. Residents never read or write.
alter table public.scheduled_reminders enable row level security;

drop policy if exists "Admins can read scheduled reminders" on public.scheduled_reminders;
create policy "Admins can read scheduled reminders"
    on public.scheduled_reminders for select
    to authenticated
    using (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
        )
    );

drop policy if exists "Admins can insert scheduled reminders" on public.scheduled_reminders;
create policy "Admins can insert scheduled reminders"
    on public.scheduled_reminders for insert
    to authenticated
    with check (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
        )
    );

drop policy if exists "Admins can update scheduled reminders" on public.scheduled_reminders;
create policy "Admins can update scheduled reminders"
    on public.scheduled_reminders for update
    to authenticated
    using (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
        )
    );

drop policy if exists "Admins can delete scheduled reminders" on public.scheduled_reminders;
create policy "Admins can delete scheduled reminders"
    on public.scheduled_reminders for delete
    to authenticated
    using (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
        )
    );

comment on table public.scheduled_reminders is
    'Admin-curated society-wide reminders. The daily cron picks up rows where status=pending and fire_on <= today (IST), dispatches via notify(), and flips status to sent/failed.';

notify pgrst, 'reload schema';
