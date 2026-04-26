-- ============================================================
-- 2026-05-01 — Multi-channel notification dispatcher
--
-- Adds two tables that support src/lib/notify.ts:
--
--   1. notification_events
--      Audit trail. One row per logical event ("booking 123 was
--      submitted", "broadcast 456 was published"). Stores the
--      kind, ref_id, audience size, per-channel send/fail counts,
--      and optional error blob. Admin-only read; never user-facing.
--      Powers the future "Notification health" admin panel.
--
--   2. notification_preferences
--      Future per-user opt-out grid: (user_id, kind, channel) →
--      muted bool. The dispatcher already consults this so when
--      we ship the UI in a follow-up, no dispatcher change is
--      needed. Empty rows = "default" = ON.
--
-- Both tables are RLS-locked: residents see only their own
-- preferences row(s). Admins see everything. Dispatcher writes
-- with the service-role client, which bypasses RLS.
-- ============================================================

-- 1) notification_events ---------------------------------------------
create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  ref_id text not null,
  -- Snapshot of who we *intended* to reach. May differ from
  -- per-channel counts if some users have no push sub or no
  -- Telegram link.
  audience_size int not null,
  -- Per-channel outcomes. Each is { attempted, sent, failed }.
  push_outcome   jsonb not null default '{}'::jsonb,
  telegram_outcome jsonb not null default '{}'::jsonb,
  -- Free-form error blob if the dispatcher itself blew up
  -- partway through. Intentionally never user-visible.
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_events_kind_created
  on public.notification_events (kind, created_at desc);
create index if not exists idx_notification_events_ref
  on public.notification_events (kind, ref_id);

alter table public.notification_events enable row level security;

drop policy if exists "Admins can view all notification events" on public.notification_events;
create policy "Admins can view all notification events"
  on public.notification_events for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 2) notification_preferences ----------------------------------------
-- One row per (user, kind, channel) opt-OUT. Absence = default ON.
-- We store opt-OUTs (not opt-INs) so the default for a brand-new
-- notification kind is "send" — which matches today's behaviour
-- and prevents silent failures when we add new kinds.
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('push', 'telegram', 'email')),
  muted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, channel)
);

create index if not exists idx_notification_prefs_user
  on public.notification_preferences (user_id);

alter table public.notification_preferences enable row level security;

drop policy if exists "Users can view their own notification prefs"   on public.notification_preferences;
drop policy if exists "Users can manage their own notification prefs" on public.notification_preferences;

create policy "Users can view their own notification prefs"
  on public.notification_preferences for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can manage their own notification prefs"
  on public.notification_preferences for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at touch ---------------------------------------------------
create or replace function public.notification_preferences_touch_updated_at()
returns trigger language plpgsql as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists trg_notification_prefs_touch on public.notification_preferences;
create trigger trg_notification_prefs_touch
  before update on public.notification_preferences
  for each row execute procedure public.notification_preferences_touch_updated_at();
