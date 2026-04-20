-- ============================================================
-- 20260424_community_funds.sql
-- Community Internal Funds — public balance sheet for informal,
-- voluntary collections (Diwali, water softener AMC, common chairs,
-- Holi, picnics, ganpati, etc.)
--
-- This is DISTINCT from formal monthly maintenance bills:
--   * Voluntary, ad-hoc, named "pots" of money for a purpose
--   * Public ledger — every authenticated resident can see the
--     full contributions/spends list (radical transparency)
--   * Admin-only writes; residents can self-report a contribution
--     for verification
--
-- All amounts stored in PAISE (integer, INR * 100) to avoid
-- floating-point drift. Display layer formats as ₹.
--
-- Spec: docs/COMMUNITY_FUNDS_SPEC.md
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FUND CATEGORIES
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  icon text,
  color text,
  description text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.fund_categories (code, name, icon, color, display_order) values
  ('softener_amc', 'Water Softener AMC', '💧', '#3B82F6', 10),
  ('ro_maintenance', 'RO / Water Purifier', '🚰', '#06B6D4', 20),
  ('events_festival', 'Festivals & Celebrations', '🪔', '#F59E0B', 30),
  ('events_social', 'Social Events & Picnics', '🎉', '#EC4899', 40),
  ('common_assets', 'Common Assets (chairs, tools)', '🪑', '#8B5CF6', 50),
  ('repairs_misc', 'Misc Repairs (community)', '🔧', '#6B7280', 60),
  ('sports', 'Sports & Tournaments', '🏏', '#10B981', 70),
  ('decoration', 'Decoration & Beautification', '🌸', '#F472B6', 80),
  ('puja_religious', 'Puja & Religious Events', '🛕', '#EAB308', 90),
  ('children_activities', 'Children Activities', '🧒', '#A855F7', 100),
  ('general_pool', 'General Community Pool', '💰', '#059669', 110),
  ('other', 'Other', '📦', '#9CA3AF', 999)
on conflict (code) do nothing;

-- ────────────────────────────────────────────────────────────
-- FUNDS (a named pot of money for a purpose)
-- ────────────────────────────────────────────────────────────
do $$ begin
  create type fund_status as enum (
    'collecting', 'spending', 'closed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fund_visibility as enum (
    'all_residents', 'committee_only'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.community_funds (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.fund_categories(id),

  name text not null,
  description text,
  purpose text,

  -- Targets & timing
  target_amount integer,
  suggested_per_flat integer,
  start_date date,
  collection_deadline date,
  event_date date,

  status fund_status not null default 'collecting',
  visibility fund_visibility not null default 'all_residents',

  -- Denormalized totals — kept in sync via triggers
  total_collected integer not null default 0,
  total_spent integer not null default 0,
  total_refunded integer not null default 0,
  contributor_count integer not null default 0,

  is_recurring boolean not null default false,
  recurring_period text check (recurring_period in (
    'monthly', 'quarterly', 'half_yearly', 'yearly'
  )),
  parent_fund_id uuid references public.community_funds(id),

  -- Closure metadata
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  closure_notes text,
  cover_image_url text,

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_funds_status_idx on public.community_funds(status, created_at desc);
create index if not exists community_funds_category_idx on public.community_funds(category_id, status);
create index if not exists community_funds_visibility_idx on public.community_funds(visibility);

-- ────────────────────────────────────────────────────────────
-- CONTRIBUTIONS (money IN, per flat)
-- ────────────────────────────────────────────────────────────
do $$ begin
  create type contribution_method as enum (
    'upi', 'cash', 'cheque', 'neft', 'imps', 'in_kind', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type contribution_status as enum (
    'reported', 'received', 'rejected'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.fund_contributions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete restrict,
  flat_number text not null,
  resident_id uuid references public.profiles(id),
  contributor_name text not null,

  amount integer not null check (amount > 0),
  method contribution_method not null,
  reference_number text,
  contribution_date date not null,
  notes text,
  screenshot_url text,

  status contribution_status not null default 'reported',

  is_in_kind boolean not null default false,
  in_kind_description text,
  is_anonymous boolean not null default false,

  reported_by uuid references public.profiles(id),
  reported_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  received_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fund_contributions_fund_idx on public.fund_contributions(fund_id, status);
create index if not exists fund_contributions_flat_idx on public.fund_contributions(flat_number, contribution_date desc);
create index if not exists fund_contributions_resident_idx on public.fund_contributions(resident_id, contribution_date desc);
create index if not exists fund_contributions_status_idx on public.fund_contributions(status, reported_at desc);

-- ────────────────────────────────────────────────────────────
-- FUND SPENDS (money OUT)
-- ────────────────────────────────────────────────────────────
do $$ begin
  create type spend_method as enum (
    'cash', 'upi', 'cheque', 'bank_transfer', 'credit_card', 'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.fund_spends (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete restrict,

  amount integer not null check (amount > 0),
  spend_date date not null,
  description text not null,
  vendor_name text,
  vendor_phone text,

  category_hint text,
  payment_method spend_method not null,
  payment_reference text,
  paid_by_name text,
  paid_by_user_id uuid references public.profiles(id),

  is_reimbursement boolean not null default false,
  reimbursed_at timestamptz,

  receipt_url text,
  invoice_url text,

  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fund_spends_fund_idx on public.fund_spends(fund_id, spend_date desc);
create index if not exists fund_spends_date_idx on public.fund_spends(spend_date desc);

-- ────────────────────────────────────────────────────────────
-- FUND REFUNDS (surplus returned to contributors)
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_refunds (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete restrict,
  contribution_id uuid references public.fund_contributions(id),
  flat_number text not null,
  resident_id uuid references public.profiles(id),

  amount integer not null check (amount > 0),
  refund_date date not null,
  method spend_method not null,
  reference_number text,
  notes text,

  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now()
);

create index if not exists fund_refunds_fund_idx on public.fund_refunds(fund_id);
create index if not exists fund_refunds_flat_idx on public.fund_refunds(flat_number);

-- ────────────────────────────────────────────────────────────
-- FUND COMMENTS (public Q&A under each fund)
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_comments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete cascade,
  parent_comment_id uuid references public.fund_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  author_flat text,
  body text not null,
  is_admin_reply boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fund_comments_fund_idx on public.fund_comments(fund_id, created_at desc);

-- ────────────────────────────────────────────────────────────
-- FUND ATTACHMENTS (event photos, receipts gallery)
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_attachments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete cascade,
  url text not null,
  filename text,
  caption text,
  attachment_type text check (attachment_type in (
    'receipt', 'invoice', 'photo', 'document', 'other'
  )),
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists fund_attachments_fund_idx on public.fund_attachments(fund_id);

-- ============================================================
-- RLS POLICIES
-- ============================================================

alter table public.fund_categories enable row level security;
alter table public.community_funds enable row level security;
alter table public.fund_contributions enable row level security;
alter table public.fund_spends enable row level security;
alter table public.fund_refunds enable row level security;
alter table public.fund_comments enable row level security;
alter table public.fund_attachments enable row level security;

-- Drop and recreate is safest for idempotent re-runs
drop policy if exists fund_categories_read on public.fund_categories;
drop policy if exists fund_categories_admin_write on public.fund_categories;
drop policy if exists community_funds_read_visible on public.community_funds;
drop policy if exists community_funds_admin_write on public.community_funds;
drop policy if exists fund_contributions_read_all on public.fund_contributions;
drop policy if exists fund_contributions_resident_insert on public.fund_contributions;
drop policy if exists fund_contributions_admin_write on public.fund_contributions;
drop policy if exists fund_spends_read_all on public.fund_spends;
drop policy if exists fund_spends_admin_write on public.fund_spends;
drop policy if exists fund_refunds_read_all on public.fund_refunds;
drop policy if exists fund_refunds_admin_write on public.fund_refunds;
drop policy if exists fund_comments_read on public.fund_comments;
drop policy if exists fund_comments_insert on public.fund_comments;
drop policy if exists fund_comments_update on public.fund_comments;
drop policy if exists fund_comments_delete on public.fund_comments;
drop policy if exists fund_attachments_read on public.fund_attachments;
drop policy if exists fund_attachments_insert on public.fund_attachments;
drop policy if exists fund_attachments_delete on public.fund_attachments;

-- Categories: read by all authenticated, admin manages
create policy fund_categories_read
  on public.fund_categories for select to authenticated using (true);
create policy fund_categories_admin_write
  on public.fund_categories for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Funds: residents read visible funds; admin manages everything
create policy community_funds_read_visible
  on public.community_funds for select to authenticated
  using (
    visibility = 'all_residents'
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy community_funds_admin_write
  on public.community_funds for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Contributions: residents read all (transparency); insert own; admin manages all
create policy fund_contributions_read_all
  on public.fund_contributions for select to authenticated
  using (
    exists (
      select 1 from public.community_funds f
      where f.id = fund_contributions.fund_id
        and (
          f.visibility = 'all_residents'
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
        )
    )
  );
create policy fund_contributions_resident_insert
  on public.fund_contributions for insert to authenticated
  with check (
    resident_id = auth.uid()
    and reported_by = auth.uid()
    and status = 'reported'
  );
create policy fund_contributions_admin_write
  on public.fund_contributions for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Spends: residents read; admin writes
create policy fund_spends_read_all
  on public.fund_spends for select to authenticated
  using (
    exists (
      select 1 from public.community_funds f
      where f.id = fund_spends.fund_id
        and (
          f.visibility = 'all_residents'
          or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
        )
    )
  );
create policy fund_spends_admin_write
  on public.fund_spends for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Refunds: residents read; admin writes
create policy fund_refunds_read_all
  on public.fund_refunds for select to authenticated using (true);
create policy fund_refunds_admin_write
  on public.fund_refunds for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Comments: anyone reads/inserts; author or admin updates/deletes
create policy fund_comments_read
  on public.fund_comments for select to authenticated using (true);
create policy fund_comments_insert
  on public.fund_comments for insert to authenticated
  with check (author_id = auth.uid());
create policy fund_comments_update
  on public.fund_comments for update to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy fund_comments_delete
  on public.fund_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Attachments: read by all; uploader inserts; uploader/admin deletes
create policy fund_attachments_read
  on public.fund_attachments for select to authenticated using (true);
create policy fund_attachments_insert
  on public.fund_attachments for insert to authenticated
  with check (uploaded_by = auth.uid());
create policy fund_attachments_delete
  on public.fund_attachments for delete to authenticated
  using (
    uploaded_by = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- TRIGGERS — keep fund totals in sync
-- ============================================================

create or replace function recalc_fund_totals(p_fund_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.community_funds f
  set
    total_collected = coalesce((
      select sum(amount) from public.fund_contributions
      where fund_id = p_fund_id and status = 'received' and not is_in_kind
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

create or replace function trg_recalc_on_contribution()
returns trigger language plpgsql as $$
begin
  perform recalc_fund_totals(coalesce(new.fund_id, old.fund_id));
  return coalesce(new, old);
end $$;

create or replace function trg_recalc_on_spend()
returns trigger language plpgsql as $$
begin
  perform recalc_fund_totals(coalesce(new.fund_id, old.fund_id));
  return coalesce(new, old);
end $$;

create or replace function trg_recalc_on_refund()
returns trigger language plpgsql as $$
begin
  perform recalc_fund_totals(coalesce(new.fund_id, old.fund_id));
  return coalesce(new, old);
end $$;

drop trigger if exists contributions_recalc on public.fund_contributions;
create trigger contributions_recalc
  after insert or update or delete on public.fund_contributions
  for each row execute function trg_recalc_on_contribution();

drop trigger if exists spends_recalc on public.fund_spends;
create trigger spends_recalc
  after insert or update or delete on public.fund_spends
  for each row execute function trg_recalc_on_spend();

drop trigger if exists refunds_recalc on public.fund_refunds;
create trigger refunds_recalc
  after insert or update or delete on public.fund_refunds
  for each row execute function trg_recalc_on_refund();

-- updated_at maintenance
create or replace function trg_funds_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists community_funds_updated_at on public.community_funds;
create trigger community_funds_updated_at
  before update on public.community_funds
  for each row execute function trg_funds_set_updated_at();

drop trigger if exists fund_contributions_updated_at on public.fund_contributions;
create trigger fund_contributions_updated_at
  before update on public.fund_contributions
  for each row execute function trg_funds_set_updated_at();

drop trigger if exists fund_spends_updated_at on public.fund_spends;
create trigger fund_spends_updated_at
  before update on public.fund_spends
  for each row execute function trg_funds_set_updated_at();

-- ============================================================
-- VIEWS — for the public balance sheet
-- ============================================================

create or replace view public.v_fund_summary as
select
  f.id, f.name, f.status, f.target_amount, f.suggested_per_flat,
  f.start_date, f.collection_deadline, f.event_date,
  f.total_collected, f.total_spent, f.total_refunded,
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
  coalesce(sum(f.total_spent), 0) as total_spent,
  coalesce(sum(f.total_collected - f.total_spent - f.total_refunded), 0) as current_balance
from public.fund_categories cat
left join public.community_funds f on f.category_id = cat.id and f.visibility = 'all_residents'
group by cat.id, cat.code, cat.name, cat.icon, cat.color, cat.display_order
order by cat.display_order;

create or replace view public.v_community_balance_overall as
select
  coalesce(sum(total_collected), 0) as total_ever_collected,
  coalesce(sum(total_spent), 0) as total_ever_spent,
  coalesce(sum(total_refunded), 0) as total_ever_refunded,
  coalesce(sum(total_collected - total_spent - total_refunded), 0) as net_current_balance,
  count(*) filter (where status = 'collecting') as active_collecting,
  count(*) filter (where status = 'spending') as active_spending,
  count(*) filter (where status = 'closed') as completed_funds
from public.community_funds
where visibility = 'all_residents';

-- ============================================================
-- STORAGE BUCKET for fund-related uploads
-- ============================================================
-- Public bucket so anyone can view receipts/screenshots/event photos.
-- Privacy is enforced at row level (we never expose URLs of rejected
-- contributions on the resident-facing UI).
insert into storage.buckets (id, name, public)
values ('funds', 'funds', true)
on conflict (id) do nothing;

-- Storage policies: any authenticated user can upload; uploader or admin
-- can delete; everyone can read (bucket is public).
do $$ begin
  drop policy if exists "funds bucket authenticated upload" on storage.objects;
  drop policy if exists "funds bucket authenticated read" on storage.objects;
  drop policy if exists "funds bucket owner or admin delete" on storage.objects;
exception when others then null; end $$;

create policy "funds bucket authenticated upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'funds');

create policy "funds bucket authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'funds');

create policy "funds bucket owner or admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'funds'
    and (
      auth.uid() = owner
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    )
  );
