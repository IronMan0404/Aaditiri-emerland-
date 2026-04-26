-- ============================================================
-- Staff management (V1) — security guards + housekeeping
--
-- DESIGN
-- ------
-- A "staff" account is a Supabase auth.users row that is NOT a
-- resident. Every Supabase user has a row in public.profiles for
-- legacy reasons, so we keep that, but staff profiles are flagged
-- with role='staff' and joined to public.staff_profiles for the
-- staff-specific fields (role, address, photo, hire date).
--
-- Why a separate staff_profiles table rather than overloading
-- profiles:
--   1. profiles is full of resident-specific columns (flat_number,
--      vehicle_number, resident_type, family/pets/vehicles via FKs)
--      that make zero sense for a guard. Adding 8 more nullable
--      columns to profiles would erode its semantics fast.
--   2. RLS for the resident-facing app already trusts that every
--      profiles row belongs to a resident. Mixing staff into
--      profiles would mean re-auditing every "Profiles viewable by
--      authenticated" policy in the schema. Splitting the table
--      lets us keep resident RLS untouched.
--   3. V2 features (shifts, leaves, salary register) all hang off
--      staff_profiles cleanly — they would be far worse layered on
--      profiles.
--
-- Why we still write to profiles at all: the proxy.ts role-cookie
-- machinery, the useAuth() hook, the layout shells, and the audit-
-- log helpers all already key off `profiles.id`. Forking that for
-- staff would balloon the change. We just store a *minimal* shadow
-- profiles row (id + email + full_name + role='staff' + is_approved=true).
--
-- ATTENDANCE MODEL
-- ----------------
-- Free-form check in / check out. Each shift is one row in
-- staff_attendance with a non-null check_in_at and a (initially)
-- null check_out_at. When the staff member taps "Check Out" we
-- patch the OPEN row (the one with null check_out_at) for that
-- staff_id. There is at most one open row per staff_id, enforced
-- by a partial unique index, which doubles as the "are they on
-- duty right now?" lookup.
--
-- RLS
-- ---
-- Three audiences touch staff data:
--   - Admins: full read + write on staff_profiles, full read on
--     staff_attendance, full insert on staff_attendance for
--     admin-driven retroactive adjustments (V2-ish).
--   - The staff member themselves: read their own staff_profiles
--     row, read their own staff_attendance rows, insert/update
--     their own staff_attendance via the API (the policy allows
--     this directly so the API can use the user-scoped client; the
--     check-in/out endpoints still validate server-side that the
--     row makes sense before writing).
--   - Residents: read-only access to a tiny projection of "who's
--     on duty right now" — full_name + role only, NO phone, NO
--     address, NO photo. We expose this via a view, not a direct
--     table policy, so we can shape the projection precisely.
-- ============================================================

-- ─── 1. extend profiles.role to allow 'staff' ──────────────────
-- The existing CHECK constraint on profiles.role is
-- `check (role in ('admin', 'user'))`. We need to drop it and
-- replace it with one that also permits 'staff'. Idempotent.
do $$
declare
  con_name text;
begin
  for con_name in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%in%admin%user%'
  loop
    execute format('alter table public.profiles drop constraint %I', con_name);
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'user', 'staff'));


-- ─── 2. staff_profiles ────────────────────────────────────────
create table if not exists public.staff_profiles (
  -- One-to-one with auth.users / public.profiles. Cascades delete
  -- so removing the auth user cleans up the staff record.
  id uuid primary key references public.profiles(id) on delete cascade,

  -- 'security' or 'housekeeping'. We deliberately don't use a
  -- Postgres ENUM here because adding a new role later would
  -- require an ALTER TYPE that's painful inside a transaction.
  -- Plain text + check constraint is easier to evolve.
  staff_role text not null
    check (staff_role in ('security', 'housekeeping')),

  -- Display + contact details. full_name and phone are also on
  -- profiles for legacy reasons; we keep them denormalised here
  -- so a staff query is a single-table read (no profiles join
  -- needed for the staff list view). We do NOT keep them in sync
  -- via a trigger — the admin UI writes both at once, and there
  -- is no resident-driven flow that mutates a staff member's
  -- name/phone after creation.
  full_name text not null,
  phone text not null,

  -- Free-form one-line address. "House 4-12, Boduppal" type stuff.
  -- Bounded so a hostile admin client can't post a novel.
  address text check (address is null or length(address) <= 500),

  -- Avatar URL (Supabase Storage). Optional. Stored as a public
  -- URL because the resident "On duty now" widget needs to render
  -- a tiny thumbnail and we don't want to round-trip a signed URL
  -- on every dashboard load.
  photo_url text,

  -- Tombstone. We never hard-delete a staff row because the
  -- attendance table FKs back here and we want the historical
  -- attendance to remain readable. Setting is_active=false hides
  -- them from the "current staff" lists and blocks check-in.
  is_active boolean not null default true,

  -- Joining date. Optional. Useful for the admin list view.
  hired_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_profiles_role_active_idx
  on public.staff_profiles (staff_role, is_active);

-- ─── 3. staff_attendance ──────────────────────────────────────
create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,

  -- Both stored as full timestamptz. The "duty day" the row
  -- belongs to is implicit (= the date of check_in_at in IST).
  -- We keep a generated `duty_date` column so the admin monthly
  -- view can group/filter without a function call.
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,

  -- Who actually wrote each side of the row. 99% of the time
  -- this is the staff member themselves (self-check-in via
  -- /api/staff/checkin), but admins may retroactively adjust
  -- attendance — the audit log helper writes the admin's id
  -- into this column when that happens.
  check_in_by uuid references public.profiles(id) on delete set null,
  check_out_by uuid references public.profiles(id) on delete set null,

  -- Computed duty date in IST (Asia/Kolkata is UTC+05:30, fixed
  -- offset, so "at time zone" works without DST surprises). We
  -- mark it `stored` so it indexes; `virtual` would force a
  -- recompute on every read.
  duty_date date generated always as
    ((check_in_at at time zone 'Asia/Kolkata')::date) stored,

  notes text check (notes is null or length(notes) <= 500),

  created_at timestamptz not null default now()
);

create index if not exists staff_attendance_staff_date_idx
  on public.staff_attendance (staff_id, duty_date desc);

-- One open shift per staff member. If they tap Check In twice,
-- the second insert fails — the API catches that and surfaces
-- "you're already checked in". This is the canonical "are they
-- on duty right now?" signal: rows where check_out_at is null.
create unique index if not exists staff_attendance_one_open_per_staff
  on public.staff_attendance (staff_id)
  where check_out_at is null;


-- ─── 4. updated_at trigger for staff_profiles ────────────────
create or replace function public.staff_profiles_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_staff_profiles_updated_at on public.staff_profiles;
create trigger trg_staff_profiles_updated_at
  before update on public.staff_profiles
  for each row execute function public.staff_profiles_touch_updated_at();


-- ─── 5. Function: residents see "who's on duty right now" ────
-- Returns the narrow projection the resident dashboard needs.
-- Runs with SECURITY DEFINER so it can read the underlying
-- staff_* tables even though authenticated residents have NO
-- direct SELECT on them. This is the right shape: residents
-- can see "Ramesh K. is on security duty" but NEVER the
-- guard's phone or address.
--
-- We deliberately mask the surname (first name + initial) so
-- a chatty resident posting a screenshot in a WhatsApp group
-- doesn't accidentally dox a staff member. The photo_url is
-- exposed because the user UX really benefits from a face,
-- and Supabase Storage URLs are already public-by-default for
-- the avatar bucket.
create or replace function public.staff_on_duty_now()
returns table (
  id           uuid,
  staff_role   text,
  display_name text,
  photo_url    text,
  on_duty_since timestamptz
)
language sql
security definer
set search_path = public
stable
as $func$
  select
    sa.staff_id    as id,
    sp.staff_role,
    case
      when position(' ' in trim(sp.full_name)) > 0 then
        split_part(trim(sp.full_name), ' ', 1)
          || ' ' || left(split_part(trim(sp.full_name), ' ', 2), 1) || '.'
      else trim(sp.full_name)
    end            as display_name,
    sp.photo_url,
    sa.check_in_at as on_duty_since
  from public.staff_attendance sa
  join public.staff_profiles sp on sp.id = sa.staff_id
  where sa.check_out_at is null
    and sp.is_active = true
  order by sa.check_in_at asc
$func$;

-- Grant execution to all authenticated users; anon gets nothing.
revoke all on function public.staff_on_duty_now() from public;
grant execute on function public.staff_on_duty_now() to authenticated;


-- ─── 6. RLS ──────────────────────────────────────────────────
alter table public.staff_profiles enable row level security;
alter table public.staff_attendance enable row level security;

-- Defensive drops so the migration is idempotent.
drop policy if exists "Admins manage staff_profiles" on public.staff_profiles;
drop policy if exists "Staff read own staff_profiles" on public.staff_profiles;

-- Admins: full CRUD on staff_profiles.
create policy "Admins manage staff_profiles"
  on public.staff_profiles for all
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

-- Staff member: read own row only. No update — we want all
-- staff edits to go through admin (a guard cannot rename
-- themselves).
create policy "Staff read own staff_profiles"
  on public.staff_profiles for select
  using (id = auth.uid());

-- ── attendance policies ──
drop policy if exists "Admins manage staff_attendance" on public.staff_attendance;
drop policy if exists "Staff manage own attendance" on public.staff_attendance;

create policy "Admins manage staff_attendance"
  on public.staff_attendance for all
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

-- Staff: insert own attendance (check-in), read own, update own
-- (check-out). The application API still validates that an
-- update only sets check_out_at on a row that's currently open
-- — the policy doesn't try to enforce that because expressing
-- "old.check_out_at is null and new.check_out_at is not null"
-- in RLS is awkward and the partial unique index already blocks
-- multi-open-row abuse.
create policy "Staff manage own attendance"
  on public.staff_attendance for all
  using (staff_id = auth.uid())
  with check (staff_id = auth.uid());

-- ============================================================
-- That's the entire RLS surface. There is intentionally NO
-- resident-facing SELECT policy on staff_profiles or
-- staff_attendance — residents reach staff data exclusively
-- through the staff_on_duty_now() SECURITY DEFINER function,
-- which masks surname and excludes phone / address / hire date.
-- This stays correct even if a curious resident pokes around
-- in the Supabase REST endpoint directly.
-- ============================================================
