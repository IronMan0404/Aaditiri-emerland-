-- ============================================================
-- 2026-04-21 - Resident-initiated clubhouse subscriptions with
-- admin approval. Adds the 'pending_approval' and 'rejected'
-- statuses, requested-by-resident metadata, and approval audit
-- columns. Also re-runs the facility/tier seed (idempotent) so
-- environments that missed the previous migration get a populated
-- catalog without manual intervention.
--
-- Apply once to existing prod databases. Fresh installs get the
-- same content via supabase/schema.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Re-seed the facility catalog (idempotent). Safe to re-run
--    so the Book modal stops saying "No bookable facilities
--    available" after this migration is applied.
-- ------------------------------------------------------------
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

-- Also re-seed tiers so a missed previous migration doesn't leave
-- the resident "Subscribe" UI with an empty tier dropdown.
insert into public.clubhouse_tiers (
  name, description, monthly_price, yearly_price,
  included_facilities, pass_quota_per_month, max_pass_duration_hours, display_order
)
values
  ('Basic',    'Pool + party hall access',         500,  5000,  array['swimming_pool','party_hall'],                                                                           20,   24,  10),
  ('Premium',  'Pool, gym, yoga, party hall',      1000, 10000, array['swimming_pool','gym','yoga_room','party_hall'],                                                         40,   24,  20),
  ('Platinum', 'All facilities, unlimited passes', 1500, 15000, array['swimming_pool','gym','yoga_room','party_hall','tennis_court','badminton_court','clubhouse','conference_room'], null, 168, 30)
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 2. Extend clubhouse_subscriptions with the approval workflow.
--    A pending row stores what the resident *asked for* (tier,
--    months); on approval the admin fills in start_date /
--    end_date and flips status='active'. On reject the admin
--    fills rejected_reason and flips status='rejected'.
-- ------------------------------------------------------------

-- requested_months: 1, 3, 6, or 12. Captured at request time and
-- preserved through approval so analytics can attribute revenue
-- correctly even after the dates change.
alter table public.clubhouse_subscriptions
  add column if not exists requested_months integer
    check (requested_months is null or requested_months in (1, 3, 6, 12));

-- requested_at: when the resident hit "Subscribe". Differs from
-- created_at only conceptually, but we store both so that admin
-- backfills (status='active' inserted by an admin without a prior
-- request) leave requested_at NULL as a flag.
alter table public.clubhouse_subscriptions
  add column if not exists requested_at timestamptz;

alter table public.clubhouse_subscriptions
  add column if not exists request_notes text;

-- approved_by + approved_at: filled when an admin approves a
-- pending request. Always NULL for admin-created subscriptions.
alter table public.clubhouse_subscriptions
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

alter table public.clubhouse_subscriptions
  add column if not exists approved_at timestamptz;

-- rejected_reason: free-text reason shown to the resident when
-- their request is rejected. NULL for any non-rejected row.
alter table public.clubhouse_subscriptions
  add column if not exists rejected_reason text;

-- Widen the status check to include the two new states. The DB
-- doesn't let us "alter check", so we drop and re-add. Existing
-- rows are unaffected because all current statuses remain valid.
alter table public.clubhouse_subscriptions
  drop constraint if exists clubhouse_subscriptions_status_check;
alter table public.clubhouse_subscriptions
  add constraint clubhouse_subscriptions_status_check
  check (status in ('pending_approval', 'active', 'expiring', 'expired', 'cancelled', 'rejected'));

-- The end_date >= start_date check breaks for pending requests
-- (where start_date defaults to the request date but end_date
-- isn't computed yet). Drop the inline check; we re-add it as a
-- conditional constraint that only fires for active/expiring/
-- expired rows where the dates have real meaning.
alter table public.clubhouse_subscriptions
  drop constraint if exists clubhouse_subscriptions_check;
alter table public.clubhouse_subscriptions
  add constraint clubhouse_subscriptions_active_dates_check
  check (
    status in ('pending_approval', 'rejected', 'cancelled')
    or end_date >= start_date
  );

-- One pending request per flat at a time. Mirrors the existing
-- one-active-per-flat partial unique index so a resident can't
-- spam-create requests by mashing the Subscribe button.
create unique index if not exists clubhouse_subscriptions_one_pending_per_flat
  on public.clubhouse_subscriptions (flat_number)
  where status = 'pending_approval';

-- ------------------------------------------------------------
-- 3. RLS: residents may now INSERT a pending row for their own
--    flat (the request). All other writes remain admin-only.
--    Reads already cover own-flat so no change there.
-- ------------------------------------------------------------
drop policy if exists "Residents request own subscription" on public.clubhouse_subscriptions;
create policy "Residents request own subscription"
  on public.clubhouse_subscriptions for insert
  to authenticated
  with check (
    -- Resident can only insert a request for THEIR own flat,
    -- with status pending_approval, naming themselves as the
    -- primary user. Approval-only fields must be NULL.
    primary_user_id = auth.uid()
    and status = 'pending_approval'
    and approved_by is null
    and approved_at is null
    and rejected_reason is null
    and flat_number in (select flat_number from public.profiles where id = auth.uid())
  );

-- ------------------------------------------------------------
-- 4. Trigger tweaks: set approved_at automatically on transition
--    to 'active' (so the API only has to set status), and set
--    cancelled_at on cancel/reject. The existing event-ledger
--    behavior is preserved.
-- ------------------------------------------------------------
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

-- Trigger doesn't need re-attaching (BEFORE INSERT OR UPDATE on
-- clubhouse_subscriptions still points at this same function).

-- ------------------------------------------------------------
-- 5. Refresh PostgREST schema cache so the new columns appear
--    immediately.
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
