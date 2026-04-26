-- =========================================================
-- 2026-05-14 — Staff directory now includes admins
--
-- The staff_visible_residents() function originally projected
-- only role='user' rows so staff didn't see admins or other
-- staff in the directory. Operationally the staff need to be
-- able to escalate ("Madam, somebody at the gate refusing to
-- show ID — who do I call?"), and the admin's name + phone is
-- exactly the contact they need.
--
-- Changes vs the 20260512 version:
--   1. Filter now accepts role IN ('user', 'admin') instead of
--      role = 'user'.
--   2. Returns a `role` column so the staff UI can badge admin
--      rows. Staff still don't see role='staff' rows (that
--      would let them peek at each other's phone numbers, which
--      is a separate decision and we keep it conservative).
--   3. Sort key now puts admins first, then by flat number.
--      Admins typically don't have a flat_number set, and the
--      previous "flat_number nulls last" rule pushed them to
--      the end of the list.
--
-- The role-gate inside the function body is unchanged — only
-- callers with role IN ('staff', 'admin') can run it; anon and
-- residents still get an empty result set + a 403 from the API
-- on top.
-- =========================================================

create or replace function public.staff_visible_residents(
  search_query text default null,
  page_size    int  default 50,
  page_offset  int  default 0
)
returns table (
  id            uuid,
  full_name     text,
  flat_number   text,
  phone         text,
  resident_type text,
  is_approved   boolean,
  -- New in this migration. Either 'user' or 'admin' (never
  -- 'staff' — see filter below). Letting the UI render a small
  -- "Admin" badge so staff can spot office bearers at a glance.
  role          text
)
language sql
security definer
set search_path = public
stable
as $func$
  with caller as (
    select role
    from public.profiles
    where id = auth.uid()
    limit 1
  )
  select
    p.id,
    p.full_name,
    p.flat_number,
    p.phone,
    p.resident_type,
    p.is_approved,
    p.role
  from public.profiles p, caller
  where caller.role in ('staff', 'admin')
    and p.is_approved = true
    and p.is_bot = false
    -- Include admins so staff can see society office bearers'
    -- contact details. Staff are deliberately excluded — that's
    -- a peer-visibility question we don't want to bundle into
    -- this change.
    and p.role in ('user', 'admin')
    and (
      search_query is null
      or search_query = ''
      or p.full_name   ilike '%' || search_query || '%'
      or coalesce(p.flat_number, '') ilike '%' || search_query || '%'
      or coalesce(p.phone, '')       ilike '%' || search_query || '%'
    )
  order by
    -- Admins first so the staff member's escalation contact is
    -- always at the top of the search-empty view.
    case when p.role = 'admin' then 0 else 1 end,
    p.flat_number nulls last,
    p.full_name asc
  limit greatest(1, least(page_size, 200))
  offset greatest(0, page_offset)
$func$;

-- Refresh grants. CREATE OR REPLACE preserves existing grants
-- for an unchanged signature, but our return type changed so a
-- belt-and-braces re-grant keeps the function reachable from
-- the authenticated role.
revoke all on function public.staff_visible_residents(text, int, int) from public;
revoke all on function public.staff_visible_residents(text, int, int) from anon;
grant execute on function public.staff_visible_residents(text, int, int) to authenticated;

comment on function public.staff_visible_residents(text, int, int) is
  'Returns a privacy-preserving projection of approved residents AND admins (name, flat, phone, type, role) for use by staff and admin clients only. Caller-side role gate inside the function body restricts to role IN (staff, admin). Bypasses RLS on profiles via SECURITY DEFINER but does NOT expose email or any other sensitive columns. Excludes role=''staff'' rows so peers don''t see each other.';

notify pgrst, 'reload schema';
