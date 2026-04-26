-- ============================================================
-- 2026-05-03 — Booking UPDATE hardening (resident column lock)
--
-- Why this exists
-- ---------------
-- The 2026-04-28 hardening migration narrowed bookings INSERT to
-- admins only and added a `with check` clause restricting residents
-- to status in ('pending','cancelled'). That blocked self-approval
-- but DID NOT block residents from mutating the row's other columns.
-- A resident could:
--
--   1. POST /api/bookings { facility: 'badminton' }     -- subscription gate passes
--   2. supabase.from('bookings').update({              -- direct supabase-js
--        facility: 'pool',                             -- subscription-gated facility
--        date: '<other day>',
--        time_slot: '<other slot>'
--      }).eq('id', booking.id)
--
-- Both writes leave status='pending', so the policy's `with check`
-- clause is satisfied. The resident has now booked a facility their
-- tier doesn't cover by sneaking past /api/bookings. Same trick lets
-- them edit notes after admin approval, change date after approval,
-- or reassign user_id (RLS using-clause already blocks foreign rows
-- but defence in depth wants this too).
--
-- Fix
-- ---
-- A BEFORE UPDATE trigger that:
--   * Service-role (auth.uid() is null) is exempt — that's how
--     /api/bookings + admin decision helpers write.
--   * Admins are exempt — they manage every column via the
--     /api/admin/bookings/[id]/update route and decision helpers.
--   * Residents (auth.uid() = old.user_id) may modify ONLY the
--     status column, and the only legal value transitions are:
--         pending  -> cancelled
--         cancelled -> cancelled  (no-op idempotent)
--     Anything else raises 'permission denied' and aborts the txn.
--
-- We deliberately do not try to express this as RLS `with check`
-- alone — RLS policies cannot reference OLD.* on UPDATE, so we
-- can't say "facility must equal old.facility". A trigger is the
-- right hammer. The corresponding RLS policy still exists for
-- privilege scope (no admin = can't even see the row); the
-- trigger handles column immutability.
-- ============================================================

create or replace function public.bookings_block_resident_column_edits()
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

  -- Service-role escape hatch (admin SDK, server cron, /api/bookings).
  if v_caller is null then
    return new;
  end if;

  -- Admins keep full update power.
  select role into v_caller_role
    from public.profiles
   where id = v_caller;
  if v_caller_role = 'admin' then
    return new;
  end if;

  -- From here on: authenticated non-admin. RLS already restricted them
  -- to rows where auth.uid() = old.user_id, but we double-check rather
  -- than trust upstream policy ordering.
  if v_caller is distinct from old.user_id then
    raise exception 'permission denied: cannot update another resident''s booking'
      using errcode = '42501';
  end if;

  -- Residents may not change ownership.
  if (new.user_id is distinct from old.user_id) then
    raise exception 'permission denied: cannot reassign booking'
      using errcode = '42501';
  end if;

  -- Residents may not change which facility/date/time_slot they booked.
  -- These are the columns that, if mutable, would let a resident
  -- bypass the /api/bookings subscription gate retroactively.
  if (new.facility is distinct from old.facility) then
    raise exception 'permission denied: cannot change booking facility (cancel and rebook instead)'
      using errcode = '42501';
  end if;
  if (new.date is distinct from old.date) then
    raise exception 'permission denied: cannot change booking date (cancel and rebook instead)'
      using errcode = '42501';
  end if;
  if (new.time_slot is distinct from old.time_slot) then
    raise exception 'permission denied: cannot change booking time slot (cancel and rebook instead)'
      using errcode = '42501';
  end if;

  -- Residents may not edit the admin-facing notes field after submission.
  -- (The /api/bookings POST sets it once at creation.)
  if (new.notes is distinct from old.notes) then
    raise exception 'permission denied: cannot edit booking notes after creation'
      using errcode = '42501';
  end if;

  -- created_at must never change; defence in depth.
  if (new.created_at is distinct from old.created_at) then
    raise exception 'permission denied: cannot rewrite booking timestamp'
      using errcode = '42501';
  end if;

  -- The only legal status transition for a resident is to cancel a
  -- pending booking (or re-cancel an already-cancelled one as a no-op).
  -- Any move to 'approved' or 'rejected' is reserved for admins and
  -- the decision-helper code path which runs as service-role.
  if (new.status is distinct from old.status) then
    if not (
      (old.status = 'pending'   and new.status = 'cancelled')
      or
      (old.status = 'cancelled' and new.status = 'cancelled')
    ) then
      raise exception 'permission denied: residents may only cancel a pending booking'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_bookings_block_resident_column_edits on public.bookings;
create trigger trg_bookings_block_resident_column_edits
  before update on public.bookings
  for each row execute procedure public.bookings_block_resident_column_edits();

-- Schema cache reload so PostgREST picks up immediately.
notify pgrst, 'reload schema';
