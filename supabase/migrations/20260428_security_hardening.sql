-- ============================================================
-- 2026-04-28 — Security hardening migration
--
-- Three independent fixes bundled into one migration so they ship
-- atomically. Each section is idempotent (drop-and-recreate) and
-- safe to re-run.
--
--   1. profiles.role / is_approved / is_bot self-promotion lock
--   2. bookings — block direct INSERTs, force /api/bookings
--   3. bookings — block residents from self-approving via UPDATE
--
-- Rationale
-- ---------
-- The original "Users can update their own profile" RLS policy let any
-- authenticated user update ANY column on their own row, including the
-- role they advertise to the rest of the app. Because src/proxy.ts
-- gates /admin on profiles.role = 'admin', a malicious resident could
-- escalate themselves to admin with a single supabase-js call.
--
-- The original "Users can create bookings" RLS policy only checked
-- user_id = auth.uid(), which let a resident skip the API's
-- subscription gate by inserting directly via supabase-js — booking
-- pool/gym/yoga without a valid clubhouse tier.
--
-- The original "Users can update their own bookings" RLS policy let
-- residents move their own pending booking to status='approved',
-- bypassing the admin approval workflow.
--
-- Fix strategy
-- ------------
-- Use BEFORE UPDATE / BEFORE INSERT triggers (security definer) that
-- inspect the calling user. Triggers run AFTER RLS has admitted the
-- statement, so they're enforced for every authenticated path
-- (supabase-js, REST, server components) but transparently bypassed
-- when the row is written by the service-role client (auth.uid() is
-- null in that case — see the explicit null-check escape hatch).
-- ============================================================

-- ============================================================
-- 1) profiles: lock role / is_approved / is_bot to admin or service_role
-- ============================================================
create or replace function public.profiles_block_privileged_self_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller uuid;
  v_caller_role text;
begin
  v_caller := auth.uid();

  -- Service-role client (admin SDK, server cron) has no auth.uid().
  -- Anything it does is implicitly trusted because the key never
  -- reaches the browser (see src/lib/supabase-admin.ts which imports
  -- 'server-only').
  if v_caller is null then
    return new;
  end if;

  -- Caller's current persisted role. We don't trust the row being
  -- updated (that's exactly what we're protecting).
  select role into v_caller_role
    from public.profiles
   where id = v_caller;

  if v_caller_role = 'admin' then
    return new;
  end if;

  -- Non-admin authenticated caller: any change to a privileged column
  -- raises. We compare with `is distinct from` so flipping a true to
  -- a different true (no-op) doesn't trip the check.
  if (new.role is distinct from old.role) then
    raise exception 'permission denied: cannot change profiles.role'
      using errcode = '42501';
  end if;
  if (new.is_approved is distinct from old.is_approved) then
    raise exception 'permission denied: cannot change profiles.is_approved'
      using errcode = '42501';
  end if;
  if (new.is_bot is distinct from old.is_bot) then
    raise exception 'permission denied: cannot change profiles.is_bot'
      using errcode = '42501';
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_profiles_block_privileged_self_edit on public.profiles;
create trigger trg_profiles_block_privileged_self_edit
  before update on public.profiles
  for each row execute procedure public.profiles_block_privileged_self_edit();

-- ============================================================
-- 2) bookings: block resident direct INSERTs (force /api/bookings)
-- 3) bookings: block resident self-approval on UPDATE
-- ============================================================
-- We keep the SELECT policy as-is (residents see their own; admins
-- see all) and rewrite INSERT + UPDATE to enforce the workflow.
--
-- INSERT  — only admins may insert directly. Residents must hit
--           /api/bookings, which uses the service-role client to
--           perform the actual write after running the subscription
--           gate. See src/app/api/bookings/route.ts.
-- UPDATE  — residents may only update their OWN booking, and may
--           only set the status to 'cancelled' (or leave it
--           unchanged). Admins keep the full update power they
--           need for approval.

drop policy if exists "Users can create bookings"                            on public.bookings;
drop policy if exists "Users can update their own bookings or admins can update any" on public.bookings;
drop policy if exists "Admins can insert bookings"                           on public.bookings;
drop policy if exists "Residents can cancel own pending bookings, admins update any" on public.bookings;

create policy "Admins can insert bookings"
  on public.bookings for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Residents can cancel own pending bookings, admins update any"
  on public.bookings for update to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    -- Admin: anything goes.
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or (
      -- Resident: row must remain theirs and the only legal
      -- terminal status is 'cancelled'. Any other status change is
      -- rejected by the policy.
      auth.uid() = user_id
      and status in ('pending', 'cancelled')
    )
  );

-- ============================================================
-- Schema cache reload so PostgREST picks up the new policies
-- immediately.
-- ============================================================
notify pgrst, 'reload schema';
