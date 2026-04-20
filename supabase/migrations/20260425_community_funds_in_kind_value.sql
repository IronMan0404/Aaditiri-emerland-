-- ============================================================
-- 20260425_community_funds_in_kind_value.sql
-- Track the estimated value of in-kind contributions separately.
--
-- Background: the original migration intentionally excluded in-kind
-- contributions from `total_collected` (so cash + UPI totals stay
-- "real money in the bank"). But the UI then had no way to show
-- the value of an in-kind contribution at all, leading to verified
-- rows that look amount-less.
--
-- This migration:
--   1. Adds `total_in_kind_value` (paise) on community_funds
--   2. Updates the recalc trigger to aggregate it
--   3. Updates v_fund_summary + v_community_balance_overall to expose it
--
-- Behaviour the app should follow after this migration:
--   * Resident enters an estimated rupee value when reporting an in-kind
--     contribution; that value is stored in `fund_contributions.amount`
--     just like a cash contribution.
--   * `total_collected` STILL excludes in-kind (cash-only).
--   * `total_in_kind_value` gives the in-kind sum alongside.
--   * `current_balance = total_collected - total_spent - total_refunded`
--     remains cash-only on purpose.
-- ============================================================

alter table public.community_funds
  add column if not exists total_in_kind_value integer not null default 0;

-- Backfill from existing rows so currently-verified in-kind contributions
-- get reflected immediately (their amount column already holds whatever
-- value was reported — typically 1 paise from the legacy form).
update public.community_funds f
set total_in_kind_value = coalesce((
  select sum(amount) from public.fund_contributions
  where fund_id = f.id and status = 'received' and is_in_kind = true
), 0);

-- Replace recalc to also maintain total_in_kind_value
create or replace function recalc_fund_totals(p_fund_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.community_funds f
  set
    total_collected = coalesce((
      select sum(amount) from public.fund_contributions
      where fund_id = p_fund_id and status = 'received' and not is_in_kind
    ), 0),
    total_in_kind_value = coalesce((
      select sum(amount) from public.fund_contributions
      where fund_id = p_fund_id and status = 'received' and is_in_kind = true
    ), 0),
    total_spent = coalesce((
      select sum(amount) from public.fund_spends where fund_id = p_fund_id
    ), 0),
    total_refunded = coalesce((
      select sum(amount) from public.fund_refunds where fund_id = p_fund_id
    ), 0),
    contributor_count = coalesce((
      select count(distinct flat_number) from public.fund_contributions
      where fund_id = p_fund_id and status = 'received'
    ), 0),
    updated_at = now()
  where f.id = p_fund_id;
end $$;

-- Refresh views to expose the new column
create or replace view public.v_fund_summary as
select
  f.id, f.name, f.status, f.target_amount, f.suggested_per_flat,
  f.start_date, f.collection_deadline, f.event_date,
  f.total_collected, f.total_spent, f.total_refunded,
  f.total_in_kind_value,
  (f.total_collected - f.total_spent - f.total_refunded) as current_balance,
  f.contributor_count, f.cover_image_url, f.visibility,
  case when f.target_amount is not null and f.target_amount > 0
       then round((f.total_collected::numeric / f.target_amount) * 100, 1)
       else null end as collection_progress_pct,
  c.name as category_name, c.icon as category_icon, c.color as category_color, c.code as category_code
from public.community_funds f
left join public.fund_categories c on c.id = f.category_id;

create or replace view public.v_category_totals as
select
  cat.id as category_id, cat.code as category_code, cat.name as category_name,
  cat.icon, cat.color,
  count(distinct f.id) as fund_count,
  coalesce(sum(f.total_collected), 0) as total_collected,
  coalesce(sum(f.total_in_kind_value), 0) as total_in_kind_value,
  coalesce(sum(f.total_spent), 0) as total_spent,
  coalesce(sum(f.total_collected - f.total_spent - f.total_refunded), 0) as current_balance
from public.fund_categories cat
left join public.community_funds f on f.category_id = cat.id and f.visibility = 'all_residents'
group by cat.id, cat.code, cat.name, cat.icon, cat.color, cat.display_order
order by cat.display_order;

create or replace view public.v_community_balance_overall as
select
  coalesce(sum(total_collected), 0) as total_ever_collected,
  coalesce(sum(total_in_kind_value), 0) as total_ever_in_kind_value,
  coalesce(sum(total_spent), 0) as total_ever_spent,
  coalesce(sum(total_refunded), 0) as total_ever_refunded,
  coalesce(sum(total_collected - total_spent - total_refunded), 0) as net_current_balance,
  count(*) filter (where status = 'collecting') as active_collecting,
  count(*) filter (where status = 'spending') as active_spending,
  count(*) filter (where status = 'closed') as completed_funds
from public.community_funds
where visibility = 'all_residents';

-- Re-run recalc for every fund so the new column is filled correctly
do $$
declare r record;
begin
  for r in select id from public.community_funds loop
    perform recalc_fund_totals(r.id);
  end loop;
end $$;
