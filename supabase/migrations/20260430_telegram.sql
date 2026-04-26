-- ============================================================
-- 2026-04-30 — Telegram bot integration
--
-- Adds three tables that let the society bot DM residents and
-- admins for every existing notification (broadcasts, events,
-- ticket updates, clubhouse subscriptions, direct messages, etc.).
--
--   1. telegram_links             — long-lived pairing between a
--                                   profile.id and a Telegram chat_id.
--                                   One row per user; a re-pair
--                                   replaces the row in place.
--
--   2. telegram_pairings          — short-lived (15 min) one-time
--                                   codes the resident hands the
--                                   bot via `/start <code>` to
--                                   prove the chat belongs to them.
--
--   3. telegram_notifications_sent
--                                   — dedup ledger. Each row marks
--                                   "we already DMed user X about
--                                   reference (kind, ref_id)" so
--                                   crons / retries can't double-
--                                   notify. Same pattern as
--                                   event_reminders_sent.
--
-- All RLS-locked: residents can read ONLY their own link row and
-- their own active pairing code. Inserts / updates / deletes flow
-- through the service-role client (the webhook + pair API). The
-- chat_id is sensitive (can be used to DM the user from any other
-- bot), so it's never exposed to other residents.
-- ============================================================

-- 1) telegram_links --------------------------------------------------
create table if not exists public.telegram_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,

  -- Telegram chat_id is the routing key for sendMessage. It's
  -- typed bigint because Telegram chat IDs comfortably exceed
  -- int4 (private chat IDs are positive, group/channel negative,
  -- and supergroups can be < -10^12).
  chat_id bigint not null,

  -- Mirrored at pair time so /admin/telegram can show "linked as
  -- @bbatchu" without an extra Telegram round-trip.
  username text,
  first_name text,
  last_name text,

  -- Soft-disable. If we ever auto-detect a user who blocked the
  -- bot (Telegram returns 403), we flip this so the dispatcher
  -- skips them but we keep the row for re-pair history.
  is_active boolean not null default true,

  linked_at timestamptz not null default now(),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_telegram_links_chat_id on public.telegram_links (chat_id);
create index if not exists idx_telegram_links_active  on public.telegram_links (is_active) where is_active;

-- 2) telegram_pairings -----------------------------------------------
-- Short-lived one-time codes. The resident clicks "Connect Telegram"
-- in their profile, the API generates a code (e.g. "AE-7K2P-Q9F3"),
-- stores it here with a 15-minute expiry, and gives the resident a
-- t.me/<bot>?start=<code> deep-link. The bot's /start handler reads
-- the code, looks it up here, links the chat_id, and deletes the
-- row. Codes are single-use.
create table if not exists public.telegram_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_pairings_user on public.telegram_pairings (user_id);
create index if not exists idx_telegram_pairings_unconsumed
  on public.telegram_pairings (expires_at)
  where consumed_at is null;

-- 3) telegram_notifications_sent ------------------------------------
-- Idempotency ledger. (kind, ref_id, user_id) is unique. The cron
-- and broadcast paths write here BEFORE sending so a retry can't
-- double-send. Mirror of event_reminders_sent /
-- clubhouse_subscription_notices_sent.
create table if not exists public.telegram_notifications_sent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,        -- e.g. 'broadcast', 'event_reminder', 'ticket_status'
  ref_id text not null,      -- the row id (uuid as text) the kind points to
  sent_at timestamptz not null default now(),

  unique (kind, ref_id, user_id)
);

create index if not exists idx_telegram_notifications_sent_user
  on public.telegram_notifications_sent (user_id, sent_at desc);

-- ============================================================
-- updated_at trigger on telegram_links
-- ============================================================
create or replace function public.telegram_links_touch_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists trg_telegram_links_touch_updated_at on public.telegram_links;
create trigger trg_telegram_links_touch_updated_at
  before update on public.telegram_links
  for each row execute procedure public.telegram_links_touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.telegram_links              enable row level security;
alter table public.telegram_pairings           enable row level security;
alter table public.telegram_notifications_sent enable row level security;

-- telegram_links ---------------------------------------------
-- Residents can SELECT only their own row (so the profile page can
-- show "linked / not linked" and the username). Nobody can INSERT
-- / UPDATE / DELETE through RLS — the webhook and the pair API run
-- with the service-role client, which bypasses RLS entirely.
drop policy if exists "Users can view their own telegram link"   on public.telegram_links;
drop policy if exists "Admins can view all telegram links"       on public.telegram_links;

create policy "Users can view their own telegram link"
  on public.telegram_links for select to authenticated
  using (auth.uid() = user_id);

create policy "Admins can view all telegram links"
  on public.telegram_links for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- telegram_pairings ------------------------------------------
-- Residents can SELECT only their own pending pairing (so the UI
-- can poll "did the bot consume my code yet?" and reveal the
-- linked status). No INSERT/UPDATE/DELETE via RLS — only the API
-- with the service-role client.
drop policy if exists "Users can view their own pending pairing" on public.telegram_pairings;

create policy "Users can view their own pending pairing"
  on public.telegram_pairings for select to authenticated
  using (auth.uid() = user_id);

-- telegram_notifications_sent --------------------------------
-- Internal ledger. No resident-visible policy — the only writers
-- are server-side fan-outs running with the service-role client.
-- (RLS still enabled to deny any accidental anon/authenticated
--  read attempt.)

-- ============================================================
-- Helper: clear pairings older than a day. Cheap to run from cron
-- but we don't actually schedule it — Postgres will get to it via
-- our existing audit-log retention if we add it later. Codes
-- expire after 15 min anyway and the table is tiny; this is just
-- a hygiene helper.
-- ============================================================
create or replace function public.telegram_pairings_purge_stale()
returns void
language sql
security definer
set search_path = public
as $func$
  delete from public.telegram_pairings
   where (consumed_at is not null and consumed_at < now() - interval '1 day')
      or (consumed_at is null     and expires_at  < now() - interval '1 hour');
$func$;
