-- =========================================================
-- 2026-05-15 — Resident-facing staff directory
--
-- Residents (and tenants) need to see the full active staff
-- roster so they know who's on the property and how to reach
-- them. The existing staff_on_duty_now() function is fine for
-- the dashboard "X security on duty" widget but it (a) masks
-- surnames, (b) only returns currently-on-duty staff, and
-- (c) excludes phone numbers. None of those are right for a
-- directory page where the resident wants to call the guard.
--
-- This migration adds a SECOND function, resident_visible_staff(),
-- that returns the full active roster with the columns residents
-- legitimately need: id, full_name, staff_role, phone, photo_url,
-- and on_duty_since (null for off-duty staff).
--
-- WHAT WE INTENTIONALLY DO NOT EXPOSE
--   - email             — staff sign in with phone, but their
--                         synthesized email is internal infra.
--   - address           — residents have no business knowing
--                         where their guard lives.
--   - hired_on,
--     created_at,
--     updated_at        — admin-only audit columns.
--   - is_active=false   — terminated staff stay invisible to
--                         residents even though their attendance
--                         remains on file.
--
-- WHO CAN CALL THIS
--   Authenticated approved residents AND admins (admins skip the
--   approval check via role gate). Anon, pending residents, and
--   bots return empty. We deliberately INCLUDE staff callers in
--   the gate too — a guard pulling up the directory on their
--   phone shouldn't get a 403 when their teammate's phone goes
--   missing and they need to call them. Staff peer visibility
--   *here* (with phone) is acceptable because we already share
--   shifts and the phone is on a clipboard at the gate anyway —
--   and we deliberately exclude staff from the staff resident
--   directory at /staff/residents for the same reason inverted.
--
-- Implementation note: we DROP first because we have no prior
-- version of this function — that's a no-op the first time and
-- still safe on re-run.
-- =========================================================

drop function if exists public.resident_visible_staff();

create function public.resident_visible_staff()
returns table (
  id            uuid,
  full_name     text,
  staff_role    text,
  phone         text,
  photo_url     text,
  on_duty_since timestamptz
)
language sql
security definer
set search_path = public
stable
as $func$
  with caller as (
    select role, is_approved, is_bot
    from public.profiles
    where id = auth.uid()
    limit 1
  )
  select
    sp.id,
    sp.full_name,
    sp.staff_role,
    sp.phone,
    sp.photo_url,
    -- Pick the open shift's start time, if any. A staff member
    -- has at most one open shift due to the partial unique index
    -- on staff_attendance, so this scalar subquery is safe.
    (
      select sa.check_in_at
      from public.staff_attendance sa
      where sa.staff_id = sp.id
        and sa.check_out_at is null
      limit 1
    ) as on_duty_since
  from public.staff_profiles sp, caller c
  where sp.is_active = true
    and c.is_bot = false
    -- Approved residents OR any admin/staff. Pending residents
    -- get no rows (they haven't been onboarded yet).
    and (
      c.role = 'admin'
      or c.role = 'staff'
      or (c.role = 'user' and c.is_approved = true)
    )
  order by
    -- On-duty first so the "who do I call right now" answer
    -- is at the top.
    case when (
      select 1 from public.staff_attendance sa2
      where sa2.staff_id = sp.id and sa2.check_out_at is null
    ) is not null then 0 else 1 end,
    sp.staff_role asc,
    sp.full_name asc
$func$;

-- Authenticated callers only; anon never sees staff.
revoke all on function public.resident_visible_staff() from public;
revoke all on function public.resident_visible_staff() from anon;
grant execute on function public.resident_visible_staff() to authenticated;

comment on function public.resident_visible_staff() is
  'Resident-facing read-only projection of the full active staff roster: id, full_name, staff_role, phone, photo_url, and on_duty_since (null for off-duty). Caller-side gate restricts to admins, staff, and APPROVED residents only — pending residents and anon get an empty set. Bypasses RLS on staff_profiles via SECURITY DEFINER but does NOT expose email, address, hire date, or any audit columns. Distinct from staff_on_duty_now() which masks surnames + omits phone for the dashboard glance widget.';

notify pgrst, 'reload schema';
