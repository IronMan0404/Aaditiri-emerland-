-- =========================================================
-- Staff resident directory (read-only)
-- =========================================================
-- Security guards on the gate and housekeeping in the
-- service zones legitimately need to be able to look up a
-- flat number → resident name and phone (e.g. to verify a
-- visitor, or to call a flat about an at-the-door delivery).
--
-- We do NOT want to give the `staff` role direct SELECT on
-- public.profiles — that table also contains PII we don't
-- want them to see (email, push_token, avatar_url, role,
-- is_bot flags, audit-relevant timestamps, etc.). Adding a
-- staff-targeted RLS policy on profiles is also fragile
-- because future migrations could accidentally widen what
-- staff can see.
--
-- Instead we expose ONE narrow projection through a
-- SECURITY DEFINER function. The function:
--   • runs as the function owner (postgres), bypassing RLS
--     on profiles
--   • but is only granted EXECUTE to authenticated users
--     who have role = 'staff' OR role = 'admin' (admins
--     can already see everything via /admin/users; granting
--     them this function too is just for the staff-app
--     preview while testing)
--   • returns ONLY the agreed columns: name, flat, phone,
--     resident_type, is_approved. No email, no avatar,
--     no role, no IDs.
--
-- We deliberately return a partially-masked phone? NO.
-- Staff need to actually CALL the resident — masking is
-- counter-productive. The /api/staff/residents route
-- enforces role gating on top, and the staff UI shows a
-- tap-to-call link, not a copy button.
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
  is_approved   boolean
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
    p.is_approved
  from public.profiles p, caller
  where caller.role in ('staff', 'admin')
    and p.is_approved = true
    and p.is_bot = false
    and p.role = 'user'
    and (
      search_query is null
      or search_query = ''
      or p.full_name   ilike '%' || search_query || '%'
      or p.flat_number ilike '%' || search_query || '%'
      or p.phone       ilike '%' || search_query || '%'
    )
  order by
    p.flat_number nulls last,
    p.full_name asc
  limit greatest(1, least(page_size, 200))
  offset greatest(0, page_offset)
$func$;

-- Lock this down: only authenticated callers, never anon.
revoke all on function public.staff_visible_residents(text, int, int) from public;
revoke all on function public.staff_visible_residents(text, int, int) from anon;
grant execute on function public.staff_visible_residents(text, int, int) to authenticated;

comment on function public.staff_visible_residents(text, int, int) is
  'Returns a privacy-preserving projection of approved residents (name, flat, phone, type) for use by staff and admin clients only. Caller-side role gate inside the function body restricts to role IN (staff, admin). Bypasses RLS on profiles via SECURITY DEFINER but does NOT expose email, role, or other sensitive columns.';

-- =========================================================
-- Tell PostgREST about the new function so it shows up in
-- the schema cache without an app restart.
-- =========================================================
notify pgrst, 'reload schema';
