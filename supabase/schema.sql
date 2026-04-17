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
  push_token text,
  created_at timestamptz not null default now()
);

-- Idempotent column migrations for existing databases.
-- Safe to re-run on fresh installs (they just no-op).
alter table public.profiles add column if not exists vehicle_number text;
alter table public.profiles add column if not exists resident_type text;

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

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGN UP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
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
$$;

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
-- REFRESH POSTGREST SCHEMA CACHE
-- Tells Supabase's REST layer to reload column/table metadata
-- so clients stop seeing "Could not find the 'X' column of 'Y'
-- in the schema cache" errors immediately after migrations.
-- ============================================================
notify pgrst, 'reload schema';
