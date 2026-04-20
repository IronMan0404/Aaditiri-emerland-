-- ============================================================
-- AADITRI EMERLAND COMMUNITY APP - SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- PROFILES TABLE (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text not null,
  phone text,
  avatar_url text,
  flat_number text,
  vehicle_number text,
  resident_type text check (resident_type in ('owner', 'tenant')),
  role text not null default 'user' check (role in ('admin', 'user')),
  is_approved boolean not null default true,
  is_bot boolean not null default false,
  whatsapp_opt_in boolean not null default true,
  push_token text,
  created_at timestamptz not null default now()
);

-- Idempotent column migrations for existing databases.
-- Safe to re-run on fresh installs (they just no-op).
alter table public.profiles add column if not exists vehicle_number text;
alter table public.profiles add column if not exists resident_type text;
alter table public.profiles add column if not exists is_bot boolean not null default false;
alter table public.profiles add column if not exists whatsapp_opt_in boolean not null default true;

-- At most one profile can be flagged as the Aaditri Bot at a time.
-- Partial unique index: rows with is_bot = false are ignored, only the
-- single is_bot = true row is enforced unique.
create unique index if not exists profiles_single_bot_idx
  on public.profiles ((true)) where is_bot = true;

-- Ensure the resident_type CHECK constraint exists exactly once.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_resident_type_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_resident_type_check
      check (resident_type is null or resident_type in ('owner', 'tenant'));
  end if;
end $$;

-- ANNOUNCEMENTS
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  image_url text,
  is_pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- EVENTS
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  date date not null,
  time text not null,
  location text not null,
  image_url text,
  max_attendees integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- EVENT RSVPs
create table if not exists public.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'going' check (status in ('going', 'not_going', 'maybe')),
  created_at timestamptz not null default now(),
  unique(event_id, user_id)
);

-- BOOKINGS
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  facility text not null,
  date date not null,
  time_slot text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

-- BROADCASTS
create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- PHOTOS
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  url text not null,
  caption text,
  created_at timestamptz not null default now()
);

-- VEHICLES (one row per resident vehicle; replaces legacy profiles.vehicle_number)
-- Multiple vehicles per resident are now supported. The legacy single-vehicle
-- column is kept for backwards-compat and one-time backfilled below.
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  number text not null,
  type text not null default 'car' check (type in ('car', 'bike', 'other')),
  created_at timestamptz not null default now(),
  unique (user_id, number)
);

create index if not exists vehicles_user_idx on public.vehicles (user_id);

-- One-time backfill: copy any existing profiles.vehicle_number values into the
-- new vehicles table. Idempotent thanks to ON CONFLICT — safe to re-run.
insert into public.vehicles (user_id, number, type)
select id, vehicle_number, 'car'
  from public.profiles
 where vehicle_number is not null
   and length(trim(vehicle_number)) > 0
on conflict (user_id, number) do nothing;

-- FAMILY MEMBERS (one row per relative living with the resident)
-- A resident (owner OR tenant) can list spouse, children, parents, etc.
-- Admins can also view/edit to keep the directory accurate.
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  relation text not null check (relation in ('spouse','son','daughter','parent','sibling','other')),
  gender text check (gender is null or gender in ('male','female','other')),
  age int check (age is null or (age >= 0 and age <= 120)),
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists family_members_user_idx on public.family_members (user_id);

-- PETS (one row per pet living in the flat)
create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  species text not null default 'dog' check (species in ('dog','cat','bird','other')),
  vaccinated boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists pets_user_idx on public.pets (user_id);

-- COMMUNITY UPDATES
create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text not null default 'General',
  image_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- BOT MESSAGES (admin-authored, sent under the "Aaditri Bot" identity)
-- ============================================================

-- The actual message body, written once.
create table if not exists public.bot_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  -- The human admin who composed it (audit trail). May be null if that admin is later deleted.
  authored_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per (message, recipient) so we can track read state per user.
create table if not exists public.bot_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.bot_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  -- WhatsApp delivery tracking (null/absent for in-app-only installs).
  whatsapp_status text check (
    whatsapp_status is null or whatsapp_status in (
      'pending',         -- queued locally, not yet submitted
      'sent',            -- accepted by MSG91
      'delivered',       -- webhook-confirmed delivery (future)
      'read',            -- webhook-confirmed read (future)
      'failed',          -- provider rejected or network error
      'skipped_no_phone',
      'skipped_opt_out',
      'skipped_disabled' -- provider not configured server-side
    )
  ),
  whatsapp_message_id text,
  whatsapp_error text,
  whatsapp_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

-- Idempotent column migrations for older installs where bot_message_recipients
-- was created before the WhatsApp columns existed.
alter table public.bot_message_recipients add column if not exists whatsapp_status text;
alter table public.bot_message_recipients add column if not exists whatsapp_message_id text;
alter table public.bot_message_recipients add column if not exists whatsapp_error text;
alter table public.bot_message_recipients add column if not exists whatsapp_sent_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_message_recipients_whatsapp_status_check'
      and conrelid = 'public.bot_message_recipients'::regclass
  ) then
    alter table public.bot_message_recipients
      add constraint bot_message_recipients_whatsapp_status_check
      check (
        whatsapp_status is null or whatsapp_status in (
          'pending','sent','delivered','read','failed',
          'skipped_no_phone','skipped_opt_out','skipped_disabled'
        )
      );
  end if;
end $$;

create index if not exists bot_message_recipients_user_unread_idx
  on public.bot_message_recipients (user_id) where read_at is null;
create index if not exists bot_message_recipients_message_idx
  on public.bot_message_recipients (message_id);

-- ============================================================
-- WEB PUSH SUBSCRIPTIONS (one row per device endpoint per user)
-- A single resident may have several active subscriptions (phone PWA + a
-- desktop browser, etc.). The browser-issued endpoint is globally unique.
-- ============================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ============================================================
-- EVENT REMINDER TRACKING
-- One row per (event, user) marking that we've already sent the 24h
-- reminder push, so the cron job is idempotent and never spams a user
-- twice for the same event.
-- ============================================================
create table if not exists public.event_reminders_sent (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.announcements enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.bookings enable row level security;
alter table public.broadcasts enable row level security;
alter table public.photos enable row level security;
alter table public.updates enable row level security;
alter table public.bot_messages enable row level security;
alter table public.bot_message_recipients enable row level security;
alter table public.vehicles enable row level security;
alter table public.family_members enable row level security;
alter table public.pets enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.event_reminders_sent enable row level security;

-- PROFILES policies
-- Idempotent: drop old versions before recreating so re-running this file is safe.
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can update any profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

-- Self-edit: any authenticated user can update their own row.
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admin-edit: an admin can update any profile (incl. role / is_approved).
create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- ANNOUNCEMENTS policies
create policy "Announcements viewable by all authenticated" on public.announcements for select to authenticated using (true);
create policy "Only admins can insert announcements" on public.announcements for insert to authenticated with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Only admins can delete announcements" on public.announcements for delete to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- EVENTS policies
create policy "Events viewable by all authenticated" on public.events for select to authenticated using (true);
create policy "Only admins can create events" on public.events for insert to authenticated with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Only admins can delete events" on public.events for delete to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- EVENT RSVPs policies
create policy "RSVPs viewable by authenticated" on public.event_rsvps for select to authenticated using (true);
create policy "Users can manage their own RSVPs" on public.event_rsvps for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- BOOKINGS policies
create policy "Users can view their own bookings" on public.bookings for select to authenticated using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Users can create bookings" on public.bookings for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own bookings or admins can update any" on public.bookings for update to authenticated using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- BROADCASTS policies
create policy "Broadcasts viewable by all authenticated" on public.broadcasts for select to authenticated using (true);
create policy "Only admins can send broadcasts" on public.broadcasts for insert to authenticated with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Only admins can delete broadcasts" on public.broadcasts for delete to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- PHOTOS policies
create policy "Photos viewable by all authenticated" on public.photos for select to authenticated using (true);
create policy "Users can upload photos" on public.photos for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can delete their own photos" on public.photos for delete to authenticated using (auth.uid() = user_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- UPDATES policies
create policy "Updates viewable by all authenticated" on public.updates for select to authenticated using (true);
create policy "Only admins can post updates" on public.updates for insert to authenticated with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Only admins can delete updates" on public.updates for delete to authenticated using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- BOT MESSAGES policies
-- Idempotent: drop old versions before recreating so re-running this file is safe.
drop policy if exists "Recipients or admins can view bot messages" on public.bot_messages;
drop policy if exists "Only admins can insert bot messages" on public.bot_messages;
drop policy if exists "Only admins can delete bot messages" on public.bot_messages;
drop policy if exists "Users can view their own bot message recipients" on public.bot_message_recipients;
drop policy if exists "Only admins can insert bot message recipients" on public.bot_message_recipients;
drop policy if exists "Users update their own recipient row, admins update any" on public.bot_message_recipients;
drop policy if exists "Only admins can delete bot message recipients" on public.bot_message_recipients;

-- A user may read a bot message only if they are a recipient of it (or they are admin).
create policy "Recipients or admins can view bot messages"
  on public.bot_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.bot_message_recipients r
      where r.message_id = bot_messages.id and r.user_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Only admins can insert bot messages"
  on public.bot_messages for insert
  to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Only admins can delete bot messages"
  on public.bot_messages for delete
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- A user can see only their own recipient rows. Admins see all.
create policy "Users can view their own bot message recipients"
  on public.bot_message_recipients for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Only admins fan out new recipients (used by the admin "send" flow).
create policy "Only admins can insert bot message recipients"
  on public.bot_message_recipients for insert
  to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- A user may update their own recipient row (to set read_at). Admins may update any.
create policy "Users update their own recipient row, admins update any"
  on public.bot_message_recipients for update
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Only admins can delete bot message recipients"
  on public.bot_message_recipients for delete
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- VEHICLES policies
-- Idempotent: drop old versions before recreating so re-running this file is safe.
drop policy if exists "Vehicles are viewable by authenticated users" on public.vehicles;
drop policy if exists "Users manage their own vehicles" on public.vehicles;
drop policy if exists "Admins can manage any vehicle" on public.vehicles;

-- Anyone signed in can read all vehicle plates (matches profiles' read policy
-- so admins can search the directory and gate logs can resolve plates later).
create policy "Vehicles are viewable by authenticated users"
  on public.vehicles for select
  to authenticated
  using (true);

-- A resident can insert/update/delete their own vehicles.
create policy "Users manage their own vehicles"
  on public.vehicles for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins can also insert/update/delete any resident's vehicles (to fix typos
-- or remove a sold car when a resident asks).
create policy "Admins can manage any vehicle"
  on public.vehicles for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- FAMILY MEMBERS policies
-- Idempotent: drop old versions before recreating so re-running this file is safe.
drop policy if exists "Family members are viewable by authenticated users" on public.family_members;
drop policy if exists "Users manage their own family members" on public.family_members;
drop policy if exists "Admins can manage any family member" on public.family_members;

create policy "Family members are viewable by authenticated users"
  on public.family_members for select
  to authenticated
  using (true);

create policy "Users manage their own family members"
  on public.family_members for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Admins can manage any family member"
  on public.family_members for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- PETS policies
-- Idempotent: drop old versions before recreating so re-running this file is safe.
drop policy if exists "Pets are viewable by authenticated users" on public.pets;
drop policy if exists "Users manage their own pets" on public.pets;
drop policy if exists "Admins can manage any pet" on public.pets;

create policy "Pets are viewable by authenticated users"
  on public.pets for select
  to authenticated
  using (true);

create policy "Users manage their own pets"
  on public.pets for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Admins can manage any pet"
  on public.pets for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- PUSH SUBSCRIPTIONS policies
-- A user can manage only their own subscriptions; admins can read all so the
-- cron jobs (running as a privileged service-role client) can fan out, but
-- regular admin reads are also useful for debugging.
drop policy if exists "Users can view their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users can manage their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Admins can read all push subscriptions" on public.push_subscriptions;

create policy "Users can view their own push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Admins can read all push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- EVENT REMINDER TRACKING policies
-- This table is written exclusively by the server-role cron job; clients
-- only need to read their own rows so the UI can hide a "Reminder sent"
-- indicator if we ever want one. Inserts/updates/deletes are blocked at
-- the policy level (the cron uses the service-role client which bypasses RLS).
drop policy if exists "Users can read their own reminder receipts" on public.event_reminders_sent;
create policy "Users can read their own reminder receipts"
  on public.event_reminders_sent for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGN UP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $func$
begin
  insert into public.profiles (id, email, full_name, flat_number, role, is_approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'flat_number',
    'user',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$func$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict do nothing;

-- Storage policies
create policy "Anyone can view photos" on storage.objects for select using (bucket_id = 'photos');
create policy "Authenticated users can upload photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "Users can delete own photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Anyone can view avatars" on storage.objects for select using (bucket_id = 'avatars');
create policy "Authenticated users can upload avatars" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
create policy "Users can update own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- CREATE FIRST ADMIN (run this manually after setup)
-- Replace 'your-admin-email@example.com' with actual admin email
-- ============================================================
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'your-admin-email@example.com';

-- ============================================================
-- AADITRI BOT USER (one-time setup, then idempotent)
--
-- The "Aaditri Bot" is a virtual sender for admin-broadcast messages.
-- It IS a real auth.users row so messages have a stable sender_id.
--
-- STEP 1 (manual, ONCE per environment): create the user in the Supabase
--   Auth dashboard with:
--     Email:    bot@aaditri-emerland.local
--     Password: <any strong password — nobody ever signs in as the bot>
--   Auto-confirm the email.
--
-- STEP 2: re-run this SQL file. The snippet below is idempotent and:
--   - flips is_bot = true
--   - sets full_name = 'Aaditri Bot'
--   - sets role = 'admin' (so RLS-protected reads of the sender's profile
--     don't break, and the bot can be referenced from admin contexts)
--   - sets is_approved = true so it never appears in the pending-approval queue
-- ============================================================
update public.profiles
   set is_bot      = true,
       full_name   = 'Aaditri Bot',
       role        = 'admin',
       is_approved = true
 where email = 'bot@aaditri-emerland.local';

-- ============================================================
-- ISSUES (community ticket tracker) - 2026-04-20
-- Mirrors supabase/migrations/20260420_tickets_clubhouse.sql section 1.
-- Kept here for fresh installs; the migration is the source of truth for
-- incremental upgrades on existing databases.
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
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists issue_comments_issue_idx on public.issue_comments (issue_id, created_at);

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
      if (new.status = 'resolved' and new.resolved_at is null) then new.resolved_at := now(); end if;
      if (new.status = 'closed' and new.closed_at is null) then new.closed_at := now(); end if;
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
-- CLUBHOUSE FACILITIES / TIERS / SUBSCRIPTIONS / PASSES - 2026-04-20
-- See migration 20260420_tickets_clubhouse.sql sections 2-5 for full notes.
-- ============================================================
create table if not exists public.clubhouse_facilities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  hourly_rate numeric(10, 2) not null default 0,
  pass_rate_per_visit numeric(10, 2) not null default 0,
  requires_subscription boolean not null default false,
  is_bookable boolean not null default true,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists clubhouse_facilities_active_idx
  on public.clubhouse_facilities (is_active, display_order);

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

create table if not exists public.clubhouse_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  monthly_price numeric(10, 2) not null,
  yearly_price numeric(10, 2),
  included_facilities text[] not null default '{}'::text[],
  pass_quota_per_month integer,
  max_pass_duration_hours integer not null default 168,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists clubhouse_tiers_active_idx
  on public.clubhouse_tiers (is_active, display_order);

create table if not exists public.clubhouse_subscriptions (
  id uuid primary key default gen_random_uuid(),
  flat_number text not null,
  tier_id uuid not null references public.clubhouse_tiers(id) on delete restrict,
  primary_user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'active'
    check (status in ('pending_approval', 'active', 'expiring', 'expired', 'cancelled', 'rejected')),
  -- Resident-initiated request metadata. NULL for admin-created
  -- subscriptions (which are still allowed for backfills).
  requested_months integer
    check (requested_months is null or requested_months in (1, 3, 6, 12)),
  requested_at timestamptz,
  request_notes text,
  -- Approval audit. Filled when status transitions pending_approval -> active.
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Date sanity only enforced once the subscription has real
  -- start/end dates; pending requests can have placeholder dates.
  constraint clubhouse_subscriptions_active_dates_check check (
    status in ('pending_approval', 'rejected', 'cancelled')
    or end_date >= start_date
  )
);

create unique index if not exists clubhouse_subscriptions_one_active_per_flat
  on public.clubhouse_subscriptions (flat_number)
  where status = 'active';
-- One pending request per flat at a time so a resident can't
-- spam-create requests by mashing the Subscribe button.
create unique index if not exists clubhouse_subscriptions_one_pending_per_flat
  on public.clubhouse_subscriptions (flat_number)
  where status = 'pending_approval';
create index if not exists clubhouse_subscriptions_status_idx
  on public.clubhouse_subscriptions (status, end_date);
create index if not exists clubhouse_subscriptions_flat_idx
  on public.clubhouse_subscriptions (flat_number);

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
      if (new.status = 'active' and old.status = 'pending_approval' and new.approved_at is null) then
        new.approved_at := now();
        if (new.approved_by is null) then new.approved_by := auth.uid(); end if;
      end if;
      if (new.status = 'cancelled' and new.cancelled_at is null) then new.cancelled_at := now(); end if;
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

create table if not exists public.clubhouse_subscription_notices_sent (
  subscription_id uuid not null references public.clubhouse_subscriptions(id) on delete cascade,
  notice_kind text not null check (notice_kind in ('expiring', 'expired')),
  sent_at timestamptz not null default now(),
  primary key (subscription_id, notice_kind)
);

create table if not exists public.clubhouse_passes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
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

-- Uses scalar variables instead of %ROWTYPE because the Supabase SQL Editor
-- can misparse rowtype-typed locals on paste, raising a misleading
-- "relation \"sub_row\" does not exist" error.
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

  if not found then raise exception 'Subscription not found'; end if;
  if v_status <> 'active' then raise exception 'Subscription is not active (status=%)', v_status; end if;
  if current_date > v_end_date then raise exception 'Subscription has expired'; end if;

  select name, included_facilities, max_pass_duration_hours, pass_quota_per_month
    into v_tier_name, v_included, v_max_hours, v_quota
    from public.clubhouse_tiers
   where id = v_tier_id;

  if not found then raise exception 'Subscription tier not found'; end if;

  select slug into v_facility_slug
    from public.clubhouse_facilities
   where id = new.facility_id;

  if v_facility_slug is null then raise exception 'Facility not found'; end if;
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

-- RLS for the issues + clubhouse tables (mirrors migration section 6).
alter table public.issues                              enable row level security;
alter table public.issue_comments                      enable row level security;
alter table public.issue_status_events                 enable row level security;
alter table public.clubhouse_facilities                enable row level security;
alter table public.clubhouse_tiers                     enable row level security;
alter table public.clubhouse_subscriptions             enable row level security;
alter table public.clubhouse_subscription_events       enable row level security;
alter table public.clubhouse_subscription_notices_sent enable row level security;
alter table public.clubhouse_passes                    enable row level security;

drop policy if exists "Users can view their own issues or admins all"   on public.issues;
drop policy if exists "Users can create their own issues"               on public.issues;
drop policy if exists "Users update own todo issues, admins update any" on public.issues;
drop policy if exists "Admins can delete issues"                        on public.issues;

create policy "Users can view their own issues or admins all"
  on public.issues for select to authenticated
  using (created_by = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Users can create their own issues"
  on public.issues for insert to authenticated with check (created_by = auth.uid());
create policy "Users update own todo issues, admins update any"
  on public.issues for update to authenticated
  using ((created_by = auth.uid() and status = 'todo') or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check ((created_by = auth.uid() and status = 'todo') or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can delete issues"
  on public.issues for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Comments visible to issue parties"   on public.issue_comments;
drop policy if exists "Comments insertable by issue parties" on public.issue_comments;
drop policy if exists "Comments deletable by author or admin" on public.issue_comments;

create policy "Comments visible to issue parties"
  on public.issue_comments for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and ((i.created_by = auth.uid() and issue_comments.is_internal = false)
             or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );
create policy "Comments insertable by issue parties"
  on public.issue_comments for insert to authenticated
  with check (
    author_id = auth.uid() and exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and ((i.created_by = auth.uid() and issue_comments.is_internal = false)
             or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );
create policy "Comments deletable by author or admin"
  on public.issue_comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Status events visible to issue parties" on public.issue_status_events;
create policy "Status events visible to issue parties"
  on public.issue_status_events for select to authenticated
  using (
    exists (
      select 1 from public.issues i
      where i.id = issue_status_events.issue_id
        and (i.created_by = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );

drop policy if exists "Facilities readable by all authenticated" on public.clubhouse_facilities;
drop policy if exists "Admins manage facilities"                 on public.clubhouse_facilities;
create policy "Facilities readable by all authenticated"
  on public.clubhouse_facilities for select to authenticated using (true);
create policy "Admins manage facilities"
  on public.clubhouse_facilities for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Tiers readable by all authenticated" on public.clubhouse_tiers;
drop policy if exists "Admins manage tiers"                 on public.clubhouse_tiers;
create policy "Tiers readable by all authenticated"
  on public.clubhouse_tiers for select to authenticated using (true);
create policy "Admins manage tiers"
  on public.clubhouse_tiers for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Residents view own flat subscription, admins all" on public.clubhouse_subscriptions;
drop policy if exists "Residents request own subscription"               on public.clubhouse_subscriptions;
drop policy if exists "Admins manage subscriptions"                      on public.clubhouse_subscriptions;
create policy "Residents view own flat subscription, admins all"
  on public.clubhouse_subscriptions for select to authenticated
  using (
    flat_number in (select flat_number from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
-- Residents may insert ONLY a pending_approval row for their own flat,
-- naming themselves as primary user and leaving all approval columns null.
create policy "Residents request own subscription"
  on public.clubhouse_subscriptions for insert to authenticated
  with check (
    primary_user_id = auth.uid()
    and status = 'pending_approval'
    and approved_by is null
    and approved_at is null
    and rejected_reason is null
    and flat_number in (select flat_number from public.profiles where id = auth.uid())
  );
create policy "Admins manage subscriptions"
  on public.clubhouse_subscriptions for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Sub events readable by residents on own flat or admins" on public.clubhouse_subscription_events;
create policy "Sub events readable by residents on own flat or admins"
  on public.clubhouse_subscription_events for select to authenticated
  using (
    flat_number in (select flat_number from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "Residents read own notice receipts" on public.clubhouse_subscription_notices_sent;
create policy "Residents read own notice receipts"
  on public.clubhouse_subscription_notices_sent for select to authenticated
  using (
    exists (
      select 1 from public.clubhouse_subscriptions s
      where s.id = clubhouse_subscription_notices_sent.subscription_id
        and (s.flat_number in (select flat_number from public.profiles where id = auth.uid())
             or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    )
  );

drop policy if exists "Passes readable by own flat or admins"   on public.clubhouse_passes;
drop policy if exists "Passes insertable by own flat residents" on public.clubhouse_passes;
drop policy if exists "Admins update or delete passes"          on public.clubhouse_passes;
create policy "Passes readable by own flat or admins"
  on public.clubhouse_passes for select to authenticated
  using (
    flat_number in (select flat_number from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "Passes insertable by own flat residents"
  on public.clubhouse_passes for insert to authenticated
  with check (
    issued_to = auth.uid()
    and flat_number in (select flat_number from public.profiles where id = auth.uid())
  );
create policy "Admins update or delete passes"
  on public.clubhouse_passes for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

insert into public.clubhouse_tiers (
  name, description, monthly_price, yearly_price,
  included_facilities, pass_quota_per_month, max_pass_duration_hours, display_order
)
values
  ('Basic',    'Pool + party hall access',           500,  5000,  array['swimming_pool','party_hall'],                                                                           20,   24,  10),
  ('Premium',  'Pool, gym, yoga, party hall',        1000, 10000, array['swimming_pool','gym','yoga_room','party_hall'],                                                         40,   24,  20),
  ('Platinum', 'All facilities, unlimited passes',   1500, 15000, array['swimming_pool','gym','yoga_room','party_hall','tennis_court','badminton_court','clubhouse','conference_room'], null, 168, 30)
on conflict (name) do nothing;

-- ============================================================
-- ADMIN AUDIT LOG
-- Append-only journal of every privileged write performed by
-- an admin (delete / modify of subscriptions, bookings, users,
-- issues). Surfaced via the /admin/audit page and consulted
-- when reconstructing "who changed what".
-- ============================================================
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  actor_name  text,
  action text not null check (action in ('create', 'update', 'delete')),
  target_type text not null,
  target_id text not null,
  target_label text,
  reason text,
  before jsonb,
  after  jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id, created_at desc);
-- Composite (created_at desc, id desc) so /admin/audit can keyset-
-- paginate without a sequential scan even at hundreds of thousands
-- of rows.
create index if not exists admin_audit_log_keyset_idx
  on public.admin_audit_log (created_at desc, id desc);

alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_log_select on public.admin_audit_log;
create policy admin_audit_log_select on public.admin_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
-- Deliberately no INSERT/UPDATE/DELETE policies. Inserts come
-- exclusively from the service-role client used by
-- `logAdminAction()`; nothing on the RLS path can ever forge
-- or rewrite an audit row.

-- Retention function. Schedule via pg_cron in production
-- (see migration 20260423_admin_audit_log_retention.sql).
create or replace function public.prune_admin_audit_log(
  retention_days integer default 365
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pruned bigint;
begin
  if retention_days is null or retention_days < 1 then
    raise exception 'retention_days must be >= 1';
  end if;
  delete from public.admin_audit_log
   where created_at < now() - (retention_days || ' days')::interval;
  get diagnostics pruned = row_count;
  return pruned;
end;
$$;
revoke all on function public.prune_admin_audit_log(integer) from public;
revoke all on function public.prune_admin_audit_log(integer) from authenticated;
revoke all on function public.prune_admin_audit_log(integer) from anon;

-- ============================================================
-- REFRESH POSTGREST SCHEMA CACHE
-- Tells Supabase's REST layer to reload column/table metadata
-- so clients stop seeing "Could not find the 'X' column of 'Y'
-- in the schema cache" errors immediately after migrations.
-- ============================================================
notify pgrst, 'reload schema';
