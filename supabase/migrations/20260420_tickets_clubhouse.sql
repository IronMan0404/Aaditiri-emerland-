-- ============================================================
-- 2026-04-20 - Issues (community ticket tracker) + Clubhouse
-- (subscriptions, facilities, passes, analytics ledgers).
--
-- Apply once to existing prod databases. Fresh installs get
-- the same content via supabase/schema.sql. The whole file is
-- idempotent (create-if-not-exists, drop-if-exists policies).
-- ============================================================

-- ============================================================
-- 1. ISSUES (community ticket tracker)
-- ============================================================

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null check (category in (
    'plumbing', 'electrical', 'housekeeping', 'security',
    'lift', 'garden', 'pest_control', 'internet', 'other'
  )),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  -- Snapshotted from creator's profile at insert time so admin filters keep
  -- working even if the resident later moves out / changes flat.
  flat_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

create index if not exists issues_status_created_idx on public.issues (status, created_at desc);
create index if not exists issues_category_idx on public.issues (category);
create index if not exists issues_created_by_idx on public.issues (created_by);

create table if not exists public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  -- Internal admin-only note ("called plumber, ETA Tue") that the resident
  -- never sees. Default is false so resident comments stay public to staff.
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists issue_comments_issue_idx on public.issue_comments (issue_id, created_at);

-- Status transition ledger. Powers the burndown / cumulative-flow charts so
-- the analytics dashboard never has to compute "what was the state on day X"
-- from a moving target. One row per status change, including the implicit
-- 'todo' insert (from_status = null).
create table if not exists public.issue_status_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists issue_status_events_changed_idx on public.issue_status_events (changed_at);
create index if not exists issue_status_events_issue_idx on public.issue_status_events (issue_id, changed_at);

-- Trigger: capture every status change (incl. the initial insert) and stamp
-- resolved_at / closed_at automatically. Runs as security definer so the
-- ledger stays consistent even when a resident updates their own row.
create or replace function public.issues_status_event_trigger()
returns trigger language plpgsql security definer set search_path = public
as $func$
begin
  if (tg_op = 'INSERT') then
    insert into public.issue_status_events (issue_id, from_status, to_status, changed_by)
      values (new.id, null, new.status, new.created_by);
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if (new.status is distinct from old.status) then
      insert into public.issue_status_events (issue_id, from_status, to_status, changed_by)
        values (new.id, old.status, new.status, auth.uid());
      if (new.status = 'resolved' and new.resolved_at is null) then
        new.resolved_at := now();
      end if;
      if (new.status = 'closed' and new.closed_at is null) then
        new.closed_at := now();
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  return null;
end;
$func$;

drop trigger if exists trg_issues_status_event on public.issues;
create trigger trg_issues_status_event
  before insert or update on public.issues
  for each row execute procedure public.issues_status_event_trigger();

-- ============================================================
-- 2. CLUBHOUSE FACILITIES (replaces the hard-coded list in
--    src/app/dashboard/bookings/page.tsx). Admin-managed catalog.
-- ============================================================
create table if not exists public.clubhouse_facilities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  hourly_rate numeric(10, 2) not null default 0,
  pass_rate_per_visit numeric(10, 2) not null default 0,
  -- Some facilities (gym/yoga) require an active subscription whose tier
  -- includes them; others (party hall) anyone can book ad-hoc.
  requires_subscription boolean not null default false,
  is_bookable boolean not null default true,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists clubhouse_facilities_active_idx
  on public.clubhouse_facilities (is_active, display_order);

-- Seed the catalog with the existing hard-coded facilities so the bookings
-- page keeps working post-migration. Idempotent via on conflict on slug.
insert into public.clubhouse_facilities (slug, name, requires_subscription, display_order)
values
  ('clubhouse',       'Clubhouse',       false, 10),
  ('swimming_pool',   'Swimming Pool',   true,  20),
  ('tennis_court',    'Tennis Court',    false, 30),
  ('badminton_court', 'Badminton Court', false, 40),
  ('gym',             'Gym',             true,  50),
  ('yoga_room',       'Yoga Room',       true,  60),
  ('party_hall',      'Party Hall',      false, 70),
  ('conference_room', 'Conference Room', false, 80)
on conflict (slug) do nothing;

-- ============================================================
-- 3. CLUBHOUSE TIERS (subscription plans)
-- ============================================================
create table if not exists public.clubhouse_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  monthly_price numeric(10, 2) not null,
  yearly_price numeric(10, 2),
  -- Facility slugs included in this tier (e.g. {'gym','yoga_room'}).
  -- Stored as text[] not FK array so admins can curate without complex joins.
  included_facilities text[] not null default '{}'::text[],
  -- Hard cap on passes per calendar month per subscription. NULL = unlimited.
  pass_quota_per_month integer,
  -- Largest single pass duration the resident can request (e.g. 7 days for
  -- a weekly pass, 1 day for a single-day pass). Defaults to 7 days.
  max_pass_duration_hours integer not null default 168,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists clubhouse_tiers_active_idx
  on public.clubhouse_tiers (is_active, display_order);

-- ============================================================
-- 4. CLUBHOUSE SUBSCRIPTIONS (per flat)
-- ============================================================
create table if not exists public.clubhouse_subscriptions (
  id uuid primary key default gen_random_uuid(),
  flat_number text not null,
  tier_id uuid not null references public.clubhouse_tiers(id) on delete restrict,
  -- The resident who registered the subscription. Useful for admin contact
  -- and for default "issued_to" when a pass is generated. Family members are
  -- joined separately via public.family_members on flat_number.
  primary_user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'active'
    check (status in ('active', 'expiring', 'expired', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- Only one ACTIVE subscription per flat at a time. Renewals create a new row
-- after the previous one transitions to 'expired' or 'cancelled'.
create unique index if not exists clubhouse_subscriptions_one_active_per_flat
  on public.clubhouse_subscriptions (flat_number)
  where status = 'active';

create index if not exists clubhouse_subscriptions_status_idx
  on public.clubhouse_subscriptions (status, end_date);
create index if not exists clubhouse_subscriptions_flat_idx
  on public.clubhouse_subscriptions (flat_number);

-- Subscription event ledger (parallel to issue_status_events). Powers churn
-- and "drop-off funnel" charts in the admin analytics tab.
create table if not exists public.clubhouse_subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.clubhouse_subscriptions(id) on delete cascade,
  flat_number text not null,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists clubhouse_subscription_events_changed_idx
  on public.clubhouse_subscription_events (changed_at);
create index if not exists clubhouse_subscription_events_sub_idx
  on public.clubhouse_subscription_events (subscription_id, changed_at);

create or replace function public.clubhouse_subscriptions_event_trigger()
returns trigger language plpgsql security definer set search_path = public
as $func$
begin
  if (tg_op = 'INSERT') then
    insert into public.clubhouse_subscription_events
      (subscription_id, flat_number, from_status, to_status, changed_by)
      values (new.id, new.flat_number, null, new.status, auth.uid());
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if (new.status is distinct from old.status) then
      insert into public.clubhouse_subscription_events
        (subscription_id, flat_number, from_status, to_status, changed_by)
        values (new.id, new.flat_number, old.status, new.status, auth.uid());
      if (new.status = 'cancelled' and new.cancelled_at is null) then
        new.cancelled_at := now();
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  return null;
end;
$func$;

drop trigger if exists trg_clubhouse_subscriptions_event on public.clubhouse_subscriptions;
create trigger trg_clubhouse_subscriptions_event
  before insert or update on public.clubhouse_subscriptions
  for each row execute procedure public.clubhouse_subscriptions_event_trigger();

-- Dedupe ledger for "subscription expiring in 7 days" cron-fired pushes.
-- Mirrors the public.event_reminders_sent pattern so the daily cron stays
-- idempotent across multiple runs of the same notice.
create table if not exists public.clubhouse_subscription_notices_sent (
  subscription_id uuid not null references public.clubhouse_subscriptions(id) on delete cascade,
  -- 'expiring' (7 days out), 'expired' (after end_date) are the kinds today.
  notice_kind text not null check (notice_kind in ('expiring', 'expired')),
  sent_at timestamptz not null default now(),
  primary key (subscription_id, notice_kind)
);

-- ============================================================
-- 5. CLUBHOUSE PASSES (self-serve, time-bound, QR-validated)
-- ============================================================
create table if not exists public.clubhouse_passes (
  id uuid primary key default gen_random_uuid(),
  -- Short human-readable code (e.g. AE-7K2J9F) for manual entry at the gate.
  code text not null unique,
  -- HMAC-signed opaque token embedded in the QR. Forgery-resistant when
  -- combined with CLUBHOUSE_PASS_SECRET on the server.
  qr_payload text not null,
  subscription_id uuid not null references public.clubhouse_subscriptions(id) on delete cascade,
  flat_number text not null,
  issued_to uuid not null references public.profiles(id) on delete cascade,
  facility_id uuid not null references public.clubhouse_facilities(id) on delete restrict,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'used', 'expired', 'revoked')),
  used_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_until > valid_from)
);

create index if not exists clubhouse_passes_status_idx
  on public.clubhouse_passes (status, valid_until);
create index if not exists clubhouse_passes_subscription_idx
  on public.clubhouse_passes (subscription_id, created_at);
create index if not exists clubhouse_passes_facility_idx
  on public.clubhouse_passes (facility_id, created_at);

-- Quota + tier-membership enforcement at the DB layer so a malicious client
-- can't bypass the API and burn through unlimited passes. Raises with a
-- descriptive message that bubbles back to the resident UI.
-- NOTE: We deliberately use scalar variables here instead of %ROWTYPE.
-- The Supabase SQL Editor's lexer occasionally misparses %rowtype-typed
-- locals (e.g. "sub_row public.clubhouse_subscriptions%rowtype") when
-- the script is pasted with CRLF line endings, raising a confusing
-- "relation \"sub_row\" does not exist" error. Plain scalars sidestep it.
create or replace function public.clubhouse_passes_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_status            text;
  v_end_date          date;
  v_tier_id           uuid;
  v_tier_name         text;
  v_included          text[];
  v_max_hours         integer;
  v_quota             integer;
  v_facility_slug     text;
  v_used_this_month   integer;
  v_duration_hours    numeric;
begin
  select status, end_date, tier_id
    into v_status, v_end_date, v_tier_id
    from public.clubhouse_subscriptions
   where id = new.subscription_id;

  if not found then
    raise exception 'Subscription not found';
  end if;
  if v_status <> 'active' then
    raise exception 'Subscription is not active (status=%)', v_status;
  end if;
  if current_date > v_end_date then
    raise exception 'Subscription has expired';
  end if;

  select name, included_facilities, max_pass_duration_hours, pass_quota_per_month
    into v_tier_name, v_included, v_max_hours, v_quota
    from public.clubhouse_tiers
   where id = v_tier_id;

  if not found then
    raise exception 'Subscription tier not found';
  end if;

  select slug into v_facility_slug
    from public.clubhouse_facilities
   where id = new.facility_id;

  if v_facility_slug is null then
    raise exception 'Facility not found';
  end if;
  if not (v_facility_slug = any (v_included)) then
    raise exception 'Facility % is not included in tier %', v_facility_slug, v_tier_name;
  end if;

  v_duration_hours := extract(epoch from (new.valid_until - new.valid_from)) / 3600.0;
  if v_duration_hours > v_max_hours then
    raise exception 'Pass duration (% h) exceeds tier maximum (% h)', v_duration_hours, v_max_hours;
  end if;

  if v_quota is not null then
    select count(*) into v_used_this_month
      from public.clubhouse_passes p
     where p.subscription_id = new.subscription_id
       and p.status <> 'revoked'
       and date_trunc('month', p.created_at) = date_trunc('month', now());
    if v_used_this_month >= v_quota then
      raise exception 'Monthly pass quota (%) reached for this subscription', v_quota;
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_clubhouse_passes_enforce_quota on public.clubhouse_passes;
create trigger trg_clubhouse_passes_enforce_quota
  before insert on public.clubhouse_passes
  for each row execute procedure public.clubhouse_passes_enforce_quota();

-- ============================================================
-- 6. ROW-LEVEL SECURITY
-- ============================================================

alter table public.issues                              enable row level security;
alter table public.issue_comments                      enable row level security;
alter table public.issue_status_events                 enable row level security;
alter table public.clubhouse_facilities                enable row level security;
alter table public.clubhouse_tiers                     enable row level security;
alter table public.clubhouse_subscriptions             enable row level security;
alter table public.clubhouse_subscription_events       enable row level security;
alter table public.clubhouse_subscription_notices_sent enable row level security;
alter table public.clubhouse_passes                    enable row level security;

-- ----- ISSUES -----
drop policy if exists "Users can view their own issues or admins all" on public.issues;
drop policy if exists "Users can create their own issues"             on public.issues;
drop policy if exists "Users update own todo issues, admins update any" on public.issues;
drop policy if exists "Admins can delete issues"                       on public.issues;

create policy "Users can view their own issues or admins all"
  on public.issues for select
  to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can create their own issues"
  on public.issues for insert
  to authenticated
  with check (created_by = auth.uid());

-- A resident may edit ONLY their own issue and ONLY while it is still 'todo'
-- (so they can't tamper after admin starts work). Admins may update any row.
create policy "Users update own todo issues, admins update any"
  on public.issues for update
  to authenticated
  using (
    (created_by = auth.uid() and status = 'todo')
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    (created_by = auth.uid() and status = 'todo')
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can delete issues"
  on public.issues for delete
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ----- ISSUE COMMENTS -----
drop policy if exists "Comments visible to issue parties" on public.issue_comments;
drop policy if exists "Comments insertable by issue parties" on public.issue_comments;
drop policy if exists "Comments deletable by author or admin" on public.issue_comments;

-- Visible to: the issue's creator (but NOT internal notes), or any admin.
create policy "Comments visible to issue parties"
  on public.issue_comments for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and (
          (i.created_by = auth.uid() and issue_comments.is_internal = false)
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
        )
    )
  );

-- Insertable by: the issue's creator (public comments only) or any admin.
create policy "Comments insertable by issue parties"
  on public.issue_comments for insert
  to authenticated
  with check (
    author_id = auth.uid() and exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and (
          (i.created_by = auth.uid() and issue_comments.is_internal = false)
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
        )
    )
  );

create policy "Comments deletable by author or admin"
  on public.issue_comments for delete
  to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ----- ISSUE STATUS EVENTS -----
-- Read-only ledger from the client's perspective. The trigger writes rows
-- using SECURITY DEFINER so it bypasses these policies on its own.
drop policy if exists "Status events visible to issue parties" on public.issue_status_events;

create policy "Status events visible to issue parties"
  on public.issue_status_events for select
  to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_status_events.issue_id
        and (
          i.created_by = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
        )
    )
  );

-- ----- CLUBHOUSE FACILITIES -----
drop policy if exists "Facilities readable by all authenticated" on public.clubhouse_facilities;
drop policy if exists "Admins manage facilities"                 on public.clubhouse_facilities;

create policy "Facilities readable by all authenticated"
  on public.clubhouse_facilities for select
  to authenticated
  using (true);

create policy "Admins manage facilities"
  on public.clubhouse_facilities for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ----- CLUBHOUSE TIERS -----
drop policy if exists "Tiers readable by all authenticated" on public.clubhouse_tiers;
drop policy if exists "Admins manage tiers"                 on public.clubhouse_tiers;

create policy "Tiers readable by all authenticated"
  on public.clubhouse_tiers for select
  to authenticated
  using (true);

create policy "Admins manage tiers"
  on public.clubhouse_tiers for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ----- CLUBHOUSE SUBSCRIPTIONS -----
-- Residents read subs that match their own flat_number. Admins read all.
-- All writes are admin-only since payments are collected offline.
drop policy if exists "Residents view own flat subscription, admins all" on public.clubhouse_subscriptions;
drop policy if exists "Admins manage subscriptions"                      on public.clubhouse_subscriptions;

create policy "Residents view own flat subscription, admins all"
  on public.clubhouse_subscriptions for select
  to authenticated
  using (
    flat_number in (select flat_number from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins manage subscriptions"
  on public.clubhouse_subscriptions for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ----- SUBSCRIPTION EVENTS -----
drop policy if exists "Sub events readable by residents on own flat or admins" on public.clubhouse_subscription_events;

create policy "Sub events readable by residents on own flat or admins"
  on public.clubhouse_subscription_events for select
  to authenticated
  using (
    flat_number in (select flat_number from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ----- SUBSCRIPTION NOTICE LEDGER -----
-- Residents may read their own notices (so the UI can show "we sent you a
-- reminder on date X"). Writes are cron-only via service role.
drop policy if exists "Residents read own notice receipts" on public.clubhouse_subscription_notices_sent;

create policy "Residents read own notice receipts"
  on public.clubhouse_subscription_notices_sent for select
  to authenticated
  using (
    exists (
      select 1 from public.clubhouse_subscriptions s
      where s.id = clubhouse_subscription_notices_sent.subscription_id
        and (
          s.flat_number in (select flat_number from public.profiles where id = auth.uid())
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
        )
    )
  );

-- ----- CLUBHOUSE PASSES -----
-- Read: own flat (any pass for any resident in that flat) or admin.
-- Insert: own flat (and trigger enforces tier/quota/window rules above).
-- Update/delete: admin only (validation, revocation, manual cleanup).
drop policy if exists "Passes readable by own flat or admins"   on public.clubhouse_passes;
drop policy if exists "Passes insertable by own flat residents" on public.clubhouse_passes;
drop policy if exists "Admins update or delete passes"          on public.clubhouse_passes;

create policy "Passes readable by own flat or admins"
  on public.clubhouse_passes for select
  to authenticated
  using (
    flat_number in (select flat_number from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Passes insertable by own flat residents"
  on public.clubhouse_passes for insert
  to authenticated
  with check (
    issued_to = auth.uid()
    and flat_number in (select flat_number from public.profiles where id = auth.uid())
  );

create policy "Admins update or delete passes"
  on public.clubhouse_passes for update
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- 7. SEED A DEFAULT TIER (idempotent) so the admin UI has a starting row.
-- ============================================================
insert into public.clubhouse_tiers (
  name, description, monthly_price, yearly_price,
  included_facilities, pass_quota_per_month, max_pass_duration_hours, display_order
)
values
  ('Basic',    'Pool + party hall access',           500,  5000,  array['swimming_pool','party_hall'],                  20, 24, 10),
  ('Premium',  'Pool, gym, yoga, party hall',        1000, 10000, array['swimming_pool','gym','yoga_room','party_hall'], 40, 24, 20),
  ('Platinum', 'All facilities, unlimited passes',   1500, 15000, array['swimming_pool','gym','yoga_room','party_hall','tennis_court','badminton_court','clubhouse','conference_room'], null, 168, 30)
on conflict (name) do nothing;

-- ============================================================
-- 8. REFRESH POSTGREST SCHEMA CACHE
-- ============================================================
notify pgrst, 'reload schema';
