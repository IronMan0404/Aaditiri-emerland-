-- =========================================================
-- 2026-05-16 — Pin/Unpin support for announcements + events
--
-- Announcements already had `is_pinned boolean` from the
-- initial schema, but there was no UPDATE policy on the
-- table, so an admin trying to toggle the flag from the UI
-- would silently no-op (PostgREST returns 0 rows updated
-- under RLS rather than erroring). We add the missing
-- admin-only UPDATE policy here.
--
-- Events did not have an `is_pinned` column at all. We
-- mirror the announcements design so admins can keep
-- "Annual Day", "Diwali Bash" etc. at the top of the events
-- list while older RSVP-collecting events scroll down.
-- Same admin-only INSERT / DELETE / UPDATE policy shape.
--
-- Idempotent: safe to re-run on dev DBs that already have
-- the column or policy.
-- =========================================================

-- 1. Add is_pinned to events (announcements already has it).
alter table public.events
  add column if not exists is_pinned boolean not null default false;

-- Helps the dashboard listing keep pinned rows on top
-- without a sequential scan once the table grows.
create index if not exists events_is_pinned_idx
  on public.events (is_pinned)
  where is_pinned = true;

-- 2. UPDATE policy on announcements (was missing).
drop policy if exists "Only admins can update announcements" on public.announcements;
create policy "Only admins can update announcements"
  on public.announcements
  for update
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 3. UPDATE policy on events (was missing).
drop policy if exists "Only admins can update events" on public.events;
create policy "Only admins can update events"
  on public.events
  for update
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
