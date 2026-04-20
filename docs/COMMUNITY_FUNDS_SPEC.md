# Community Internal Funds — Transparent Balance Sheet

A complete specification for tracking **informal, voluntary community collections** — the "kitty" money the community gathers for things like water softener AMC, Diwali decorations, Holi celebration, common chairs, RO maintenance, festival pujas, etc.

**This is NOT** the formal monthly maintenance bill, sinking fund, or society corpus. It's the **informal community fund** that's collected separately and where every resident can see, in real time, who paid what and where it went.

**The philosophy:** *Radical transparency.* Every resident — not just the committee — can see the entire ledger at any time. This builds trust and eliminates the perennial "where did our money go?" complaints in society WhatsApp groups.

**Cost commitment:** ₹0/month forever. No payment gateway, no paid services.

**Effort estimate:** 4–5 days for a single developer.

**Status:** ✅ **Implemented (v1)** — see "Implementation status" below.

---

## ✅ Implementation status (v1 shipped)

The first version of this system is live in the codebase. What's done and what's deferred:

### Shipped

**Database** (`supabase/migrations/20260424_community_funds.sql`)
- 7 tables: `fund_categories`, `community_funds`, `fund_contributions`, `fund_spends`, `fund_refunds`, `fund_comments`, `fund_attachments`
- 12 seeded categories (softener AMC, Diwali, RO, common assets, etc.)
- Full RLS — residents read everything visible, only admins write; self-reported contributions are gated to `auth.uid()`
- Auto-recalc triggers keep `total_collected`, `total_spent`, `total_refunded`, `contributor_count` in sync after every change
- 3 reporting views: `v_fund_summary`, `v_category_totals`, `v_community_balance_overall`
- New public Storage bucket `funds` (covers, screenshots, receipts) with permissive read + uploader/admin delete policies

**Resident UI** (under `src/app/dashboard/funds/`)
- `/funds` — list with active/all/closed filter, headline balance card, category breakdown
- `/funds/[id]` — fund detail with stats card, in/out/discussion tabs, comments
- `/funds/[id]/contribute` — contribution self-report flow with screenshot upload, anonymous + in-kind support
- `/funds/[id]/flats` — flat-wise grid grouped by tower with paid/partial/pending chips
- `/funds/by-flat/[flat]` — full per-flat history across all funds
- `/funds/balance-sheet` — community-wide ledger with category bars, top contributors leaderboard, closed funds list

**Admin UI** (under `src/app/admin/funds/`)
- `/admin/funds` — fund list + quick links
- `/admin/funds/new` — create fund with category, target, deadline, visibility, push-on-create
- `/admin/funds/[id]` — manage page with pending verification queue, verify/reject inline, quick-add cash modal, record-spend modal, close-fund modal (4 surplus strategies)
- `/admin/funds/[id]/edit` — edit fund metadata
- `/admin/funds/verify` — cross-fund verification queue with bulk verify/reject and select-all

**APIs**
- Resident reads: `GET /api/funds`, `/api/funds/categories`, `/api/funds/[id]`, `/api/funds/[id]/contributions`, `/api/funds/[id]/spends`, `/api/funds/[id]/comments`, `/api/funds/[id]/flats`, `/api/funds/by-flat/[flat]`, `/api/funds/balance-sheet`
- Resident writes: `POST /api/funds/[id]/contributions`, `POST /api/funds/[id]/comments`
- Admin writes: full CRUD under `/api/admin/funds/*` including bulk verify/reject and the close-with-surplus flow

**Push notifications** (best-effort, never block API responses)
- Fund created → all residents (when admin opts in)
- Contribution verified → that resident
- Contribution rejected with reason → that resident
- Fund closed with summary → all residents

**Navigation**
- Sidebar (desktop): "Funds" added to resident nav, "Funds" added to admin nav
- MoreSheet (mobile): "Community Funds" added to resident section, "Manage Funds" added to admin section
- Admin landing tile added

**Money handling** (`src/lib/money.ts`)
- All amounts stored in PAISE; `formatINR`, `formatINRCompact`, `paiseToRupees`, `rupeesToPaise` helpers used everywhere

### Deferred to v2

- Attachments gallery on the fund page (table + RLS exist; no UI yet)
- Pinned/threaded comment moderation (column exists; admin can edit/delete via DB but no UI)
- Recurring fund auto-rollover cron (column exists; not wired to a cron route yet)
- CSV export of contributions/spends
- Quick-add bank statement import (planned for the formal-bills system, where it has more value)

---

## 1. Why a separate system from formal bills (C1)

| Aspect | Formal bills (C1) | Community funds (this spec) |
|---|---|---|
| **Mandatory?** | Yes — every flat must pay | No — voluntary contribution |
| **Frequency** | Monthly, always same categories | Ad-hoc, per event/purpose |
| **Authority** | Committee/society legal entity | Informal — any resident can propose |
| **Visibility of contributors** | Private — only admin sees defaulters | **Public — everyone sees who paid** |
| **Visibility of expenses** | Admin → AGM → residents | **Live — every rupee visible to all** |
| **Examples** | Maintenance, water, sinking fund | Diwali sweets, water softener AMC, common chairs, Holi colors, ganpati visarjan |
| **Refunds?** | Rare | Common (event surplus returned) |
| **Legal/audit?** | Yes — society books | Optional — informal ledger |

**Why both should exist:** Formal bills handle the "must-pay" recurring stuff. Community funds handle the "we-all-chip-in-for-this" ad-hoc stuff that makes a community feel like a community. Mixing them confuses everyone.

---

## 2. Core concepts

### 2.1 Three primary entities

```
                ┌────────────────────┐
                │   FUND               │
                │  ─────────           │
                │  e.g., "Water        │
                │  Softener AMC 2026"  │
                │  Target: ₹50,000     │
                │  Status: collecting  │
                └────────────────────┘
                         │
              ┌─────────┴─────────┐
              ▼                     ▼
   ┌────────────────┐   ┌────────────────┐
   │  CONTRIBUTIONS  │   │     SPENDS       │
   │  ────────────── │   │  ─────────────── │
   │  Money IN        │   │  Money OUT        │
   │  Per flat        │   │  Per item/vendor  │
   │  With proof       │   │  With invoice     │
   └────────────────┘   └────────────────┘
```

A **Fund** is a named bucket of money for a specific purpose. Money flows IN (contributions from flats) and OUT (spends on the purpose).

### 2.2 Examples of community funds

| Fund | Type | Frequency | Target |
|---|---|---|---|
| Water Softener AMC 2026 | Recurring (annual) | Once/year | ₹50,000 |
| RO Filter Replacement | Recurring (6-monthly) | Twice/year | ₹15,000 |
| Diwali Decoration 2026 | Event | One-time | ₹25,000 |
| Holi Celebration 2026 | Event | One-time | ₹15,000 |
| Common Plastic Chairs (40 nos) | Asset purchase | One-time | ₹40,000 |
| Children's Day Picnic | Event | One-time | ₹30,000 |
| Ganpati Mandap | Event | One-time | ₹20,000 |
| Cricket Tournament Trophies | Event | One-time | ₹8,000 |
| Garden Tools | Asset purchase | One-time | ₹12,000 |
| New Year Party 2027 | Event | One-time | ₹50,000 |
| **General Community Pool** | Standing | Always-on | unlimited |

### 2.3 Three roles

- **Admin** — creates funds, edits funds, records spends, marks contributions as received, closes funds
- **Resident (any community member)** — views all funds, all contributions, all spends. Can self-report a contribution. **Cannot edit anything.**
- **System** — keeps the running balance per fund, generates reports

### 2.4 What residents see (this is the magic)

Every community member can browse to a **public-internal balance sheet** showing:

- **Overall:** Total collected to date, total spent, current balance, by fund
- **By fund:** A specific fund's contributors, spends, balance, target progress
- **By flat:** "Has flat A-204 contributed?" — a flat-wise grid for every active fund
- **By category:** "How much have we spent on events this year?" "On softener maintenance?"

This is the **single biggest trust-building feature** of the entire app. No more "did Mr. Sharma pay for Diwali?" arguments in WhatsApp.

---

## 3. Database schema

### Migration file: `20260502_community_funds.sql`

```sql
-- ============================================================
-- COMMUNITY INTERNAL FUNDS — Balance Sheet
-- ============================================================
-- Informal, voluntary community collections (NOT formal bills).
-- All amounts in paise (integer) to avoid float bugs.
-- All ledger data is publicly visible to all authenticated residents.

-- ────────────────────────────────────────────────────────────
-- FUND CATEGORIES
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  icon text,                            -- emoji or icon key (UI hint)
  color text,                           -- hex color for charts
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
create type fund_status as enum (
  'collecting',         -- accepting contributions
  'spending',           -- collection closed, spending in progress
  'closed',             -- fully reconciled, archived
  'cancelled'           -- abandoned, refunds in progress
);

create type fund_visibility as enum (
  'all_residents',      -- visible to all (default for community funds)
  'committee_only'      -- restricted (for sensitive items)
);

create table if not exists public.community_funds (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.fund_categories(id),

  name text not null,                   -- "Diwali 2026 Decoration"
  description text,                     -- markdown supported
  purpose text,                         -- short purpose statement

  -- Targets & timing
  target_amount integer,                -- in paise (null = open-ended)
  suggested_per_flat integer,           -- e.g., ₹250/flat suggestion
  start_date date,                      -- when collection started
  collection_deadline date,             -- last date to contribute
  event_date date,                      -- date of the event/usage

  status fund_status not null default 'collecting',
  visibility fund_visibility not null default 'all_residents',

  -- Computed (denormalized for speed; trigger keeps in sync)
  total_collected integer not null default 0,
  total_spent integer not null default 0,
  total_refunded integer not null default 0,
  contributor_count integer not null default 0,

  -- Recurring fund support
  is_recurring boolean not null default false,
  recurring_period text check (recurring_period in (
    'monthly', 'quarterly', 'half_yearly', 'yearly', null
  )),
  parent_fund_id uuid references public.community_funds(id),  -- previous cycle

  -- Closure
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  closure_notes text,                   -- "Returned ₹2,300 surplus to contributors"
  cover_image_url text,                 -- supabase storage (event poster, asset photo)

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_funds_status_idx on public.community_funds(status, created_at desc);
create index community_funds_category_idx on public.community_funds(category_id, status);
create index community_funds_visibility_idx on public.community_funds(visibility);

-- ────────────────────────────────────────────────────────────
-- CONTRIBUTIONS (money IN, per flat)
-- ────────────────────────────────────────────────────────────
create type contribution_method as enum (
  'upi', 'cash', 'cheque', 'neft', 'imps', 'in_kind', 'other'
);

create type contribution_status as enum (
  'reported',           -- self-reported by resident
  'received',           -- admin confirmed receipt
  'rejected'            -- admin couldn't verify
);

create table if not exists public.fund_contributions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete restrict,
  flat_number text not null,
  resident_id uuid references public.profiles(id),
  contributor_name text not null,       -- snapshot — survives if profile changes

  amount integer not null,              -- paise
  method contribution_method not null,
  reference_number text,                -- UTR / cheque #
  contribution_date date not null,
  notes text,                           -- "₹100 cash given to Mr. Verma" / "via PhonePe"

  -- Proof (optional but encouraged)
  screenshot_url text,                  -- supabase storage

  status contribution_status not null default 'reported',

  -- For in-kind contributions (e.g., "donated 20 plastic chairs")
  is_in_kind boolean not null default false,
  in_kind_description text,             -- "Donated 5kg sweets worth ~₹2,000"

  -- Anonymity (some donors prefer not to be named publicly)
  is_anonymous boolean not null default false,

  -- Audit
  reported_by uuid references public.profiles(id),
  reported_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  received_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fund_contributions_fund_idx on public.fund_contributions(fund_id, status);
create index fund_contributions_flat_idx on public.fund_contributions(flat_number, contribution_date desc);
create index fund_contributions_resident_idx on public.fund_contributions(resident_id, contribution_date desc);
create index fund_contributions_status_idx on public.fund_contributions(status, reported_at desc);

-- ────────────────────────────────────────────────────────────
-- FUND SPENDS (money OUT)
-- ────────────────────────────────────────────────────────────
create type spend_method as enum (
  'cash', 'upi', 'cheque', 'bank_transfer', 'credit_card', 'other'
);

create table if not exists public.fund_spends (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete restrict,

  amount integer not null,              -- paise (positive = expense)
  spend_date date not null,
  description text not null,            -- "40 plastic chairs from Sundaram Stores"
  vendor_name text,                     -- "Sundaram Stores" (free text — informal)
  vendor_phone text,

  category_hint text,                   -- "venue", "food", "decoration", "transport"
  payment_method spend_method not null,
  payment_reference text,               -- UTR/cheque/receipt #
  paid_by_name text,                    -- "Mr. Sharma paid out of pocket, to be reimbursed"
  paid_by_user_id uuid references public.profiles(id),

  -- Reimbursement tracking (when a resident pays out of pocket)
  is_reimbursement boolean not null default false,
  reimbursed_at timestamptz,

  -- Proof (mandatory for spends > ₹500 — configurable)
  receipt_url text,                     -- supabase storage
  invoice_url text,                     -- supabase storage

  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fund_spends_fund_idx on public.fund_spends(fund_id, spend_date desc);
create index fund_spends_date_idx on public.fund_spends(spend_date desc);

-- ────────────────────────────────────────────────────────────
-- FUND REFUNDS (surplus returned to contributors)
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_refunds (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete restrict,
  contribution_id uuid references public.fund_contributions(id),
  flat_number text not null,
  resident_id uuid references public.profiles(id),

  amount integer not null,              -- paise
  refund_date date not null,
  method spend_method not null,
  reference_number text,
  notes text,

  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now()
);

create index fund_refunds_fund_idx on public.fund_refunds(fund_id);
create index fund_refunds_flat_idx on public.fund_refunds(flat_number);

-- ────────────────────────────────────────────────────────────
-- FUND COMMENTS / DISCUSSION (transparency Q&A)
-- ────────────────────────────────────────────────────────────
-- Residents can ask questions on a fund (e.g., "Why did chairs cost ₹1000 each?")
-- Admin/anyone can reply. Builds public accountability.
create table if not exists public.fund_comments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete cascade,
  parent_comment_id uuid references public.fund_comments(id),
  author_id uuid not null references public.profiles(id),
  author_name text not null,            -- snapshot
  author_flat text,                     -- snapshot
  body text not null,
  is_admin_reply boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fund_comments_fund_idx on public.fund_comments(fund_id, created_at desc);

-- ────────────────────────────────────────────────────────────
-- FUND ATTACHMENTS (event photos, receipts gallery)
-- ────────────────────────────────────────────────────────────
create table if not exists public.fund_attachments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.community_funds(id) on delete cascade,
  url text not null,                    -- supabase storage path
  filename text,
  caption text,
  attachment_type text check (attachment_type in (
    'receipt', 'invoice', 'photo', 'document', 'other'
  )),
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create index fund_attachments_fund_idx on public.fund_attachments(fund_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.fund_categories enable row level security;
alter table public.community_funds enable row level security;
alter table public.fund_contributions enable row level security;
alter table public.fund_spends enable row level security;
alter table public.fund_refunds enable row level security;
alter table public.fund_comments enable row level security;
alter table public.fund_attachments enable row level security;

-- Categories: read by all authenticated, manage by admin
create policy "fund_categories_authenticated_read"
  on public.fund_categories for select to authenticated using (true);
create policy "fund_categories_admin_write"
  on public.fund_categories for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- FUNDS: residents READ visible funds; admin manages everything
create policy "community_funds_read_visible"
  on public.community_funds for select to authenticated
  using (
    visibility = 'all_residents'
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'committee'))
  );
create policy "community_funds_admin_write"
  on public.community_funds for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- CONTRIBUTIONS: residents read all (radical transparency); insert own; admin manages all
create policy "fund_contributions_read_all"
  on public.fund_contributions for select to authenticated
  using (
    exists (
      select 1 from public.community_funds f
      where f.id = fund_contributions.fund_id
        and (f.visibility = 'all_residents'
             or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'committee')))
    )
  );
create policy "fund_contributions_resident_insert"
  on public.fund_contributions for insert to authenticated
  with check (resident_id = auth.uid() and reported_by = auth.uid());
create policy "fund_contributions_admin_write"
  on public.fund_contributions for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- SPENDS: residents read all (transparency); admin only writes
create policy "fund_spends_read_all"
  on public.fund_spends for select to authenticated
  using (
    exists (
      select 1 from public.community_funds f
      where f.id = fund_spends.fund_id
        and (f.visibility = 'all_residents'
             or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'committee')))
    )
  );
create policy "fund_spends_admin_write"
  on public.fund_spends for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- REFUNDS: residents read all; admin only writes
create policy "fund_refunds_read_all"
  on public.fund_refunds for select to authenticated using (true);
create policy "fund_refunds_admin_write"
  on public.fund_refunds for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- COMMENTS: any authenticated read & insert; author/admin can edit/delete
create policy "fund_comments_authenticated_read"
  on public.fund_comments for select to authenticated using (true);
create policy "fund_comments_authenticated_insert"
  on public.fund_comments for insert to authenticated with check (author_id = auth.uid());
create policy "fund_comments_author_or_admin_update"
  on public.fund_comments for update to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "fund_comments_author_or_admin_delete"
  on public.fund_comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ATTACHMENTS: read by all; admin or uploader writes
create policy "fund_attachments_authenticated_read"
  on public.fund_attachments for select to authenticated using (true);
create policy "fund_attachments_authenticated_insert"
  on public.fund_attachments for insert to authenticated with check (uploaded_by = auth.uid());
create policy "fund_attachments_admin_or_uploader_delete"
  on public.fund_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- TRIGGERS — keep fund totals fresh
-- ============================================================

create or replace function recalc_fund_totals(p_fund_id uuid)
returns void language plpgsql as $$
begin
  update public.community_funds f
  set
    total_collected = (
      select coalesce(sum(amount), 0)
      from public.fund_contributions
      where fund_id = p_fund_id and status = 'received'
    ),
    total_spent = (
      select coalesce(sum(amount), 0) from public.fund_spends where fund_id = p_fund_id
    ),
    total_refunded = (
      select coalesce(sum(amount), 0) from public.fund_refunds where fund_id = p_fund_id
    ),
    contributor_count = (
      select count(distinct flat_number)
      from public.fund_contributions
      where fund_id = p_fund_id and status = 'received'
    ),
    updated_at = now()
  where f.id = p_fund_id;
end $$;

create or replace function trg_recalc_on_contribution()
returns trigger language plpgsql as $$
begin
  perform recalc_fund_totals(coalesce(new.fund_id, old.fund_id));
  return coalesce(new, old);
end $$;

create trigger contributions_recalc
  after insert or update or delete on public.fund_contributions
  for each row execute function trg_recalc_on_contribution();

create or replace function trg_recalc_on_spend()
returns trigger language plpgsql as $$
begin
  perform recalc_fund_totals(coalesce(new.fund_id, old.fund_id));
  return coalesce(new, old);
end $$;

create trigger spends_recalc
  after insert or update or delete on public.fund_spends
  for each row execute function trg_recalc_on_spend();

create trigger refunds_recalc
  after insert or update or delete on public.fund_refunds
  for each row execute function trg_recalc_on_spend();

-- ============================================================
-- VIEWS — for the public balance sheet
-- ============================================================

-- Per-fund summary (with progress %)
create or replace view public.v_fund_summary as
select
  f.id, f.name, f.status, f.target_amount, f.suggested_per_flat,
  f.start_date, f.collection_deadline, f.event_date,
  f.total_collected, f.total_spent, f.total_refunded,
  (f.total_collected - f.total_spent - f.total_refunded) as current_balance,
  f.contributor_count,
  case when f.target_amount > 0
       then round((f.total_collected::numeric / f.target_amount) * 100, 1)
       else null end as collection_progress_pct,
  c.name as category_name, c.icon as category_icon, c.color as category_color
from public.community_funds f
left join public.fund_categories c on c.id = f.category_id;

-- Flat-wise contribution matrix (per fund)
-- Useful for "who paid / who hasn't" view
create or replace view public.v_flat_contribution_matrix as
select
  f.id as fund_id,
  f.name as fund_name,
  f.suggested_per_flat,
  p.flat_number,
  p.full_name as resident_name,
  coalesce(sum(c.amount) filter (where c.status = 'received'), 0) as contributed,
  count(c.id) filter (where c.status = 'received') as contribution_count,
  max(c.contribution_date) filter (where c.status = 'received') as last_contributed_on,
  case
    when coalesce(sum(c.amount) filter (where c.status = 'received'), 0) >= coalesce(f.suggested_per_flat, 0)
      then 'paid'
    when coalesce(sum(c.amount) filter (where c.status = 'received'), 0) > 0
      then 'partial'
    else 'pending'
  end as flat_status
from public.community_funds f
cross join (
  select distinct flat_number, full_name, id
  from public.profiles
  where flat_number is not null
) p
left join public.fund_contributions c
  on c.fund_id = f.id and c.flat_number = p.flat_number
where f.status in ('collecting', 'spending')
group by f.id, f.name, f.suggested_per_flat, p.flat_number, p.full_name;

-- Category-wise totals (for charts)
create or replace view public.v_category_totals as
select
  cat.id as category_id, cat.name as category_name, cat.icon, cat.color,
  count(distinct f.id) as fund_count,
  coalesce(sum(f.total_collected), 0) as total_collected,
  coalesce(sum(f.total_spent), 0) as total_spent,
  coalesce(sum(f.total_collected - f.total_spent - f.total_refunded), 0) as current_balance
from public.fund_categories cat
left join public.community_funds f on f.category_id = cat.id
group by cat.id, cat.name, cat.icon, cat.color
order by cat.display_order;

-- Overall community balance (single row)
create or replace view public.v_community_balance_overall as
select
  coalesce(sum(total_collected), 0) as total_ever_collected,
  coalesce(sum(total_spent), 0) as total_ever_spent,
  coalesce(sum(total_refunded), 0) as total_ever_refunded,
  coalesce(sum(total_collected - total_spent - total_refunded), 0) as net_current_balance,
  count(*) filter (where status = 'collecting') as active_collecting,
  count(*) filter (where status = 'spending') as active_spending,
  count(*) filter (where status = 'closed') as completed_funds
from public.community_funds;
```

---

## 4. Resident UX — the public balance sheet

This is what every community member sees. Mobile-first, clean, no jargon.

### 4.1 Funds home — `/dashboard/funds`

```
┌────────────────────────────────────┐
│  Community Funds              💰     │
│                                       │
│  ┌─────────────────────────────────┐│
│  │  OVERALL BALANCE                  ││
│  │                                   ││
│  │  ₹47,350                          ││
│  │  available across all funds       ││
│  │                                   ││
│  │  Collected: ₹3,80,000              ││
│  │  Spent:     ₹3,32,650              ││
│  │  3 funds active • 12 closed        ││
│  └─────────────────────────────────┘│
│                                       │
│  [ All ] [ Active ] [ Closed ] [+]   │
│                                       │
│  ─── ACTIVE FUNDS ───                 │
│  ┌─────────────────────────────────┐│
│  │ 💧 Water Softener AMC 2026         ││
│  │   ₹38,500 of ₹50,000 (77%)        ││
│  │   ▓▓▓▓▓▓▓▓░░ 154/200 flats         ││
│  │   Deadline: Apr 30                 ││
│  │   [ Contribute ]                   ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🪔 Diwali Decoration 2026         ││
│  │   ₹12,300 of ₹25,000 (49%)        ││
│  │   ▓▓▓▓░░░░░░ 51/200 flats          ││
│  │   Event: Nov 12                    ││
│  │   [ Contribute ]                   ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🪑 Common Plastic Chairs (40)     ││
│  │   ₹40,000 of ₹40,000 ✅ FULL      ││
│  │   Now in: 🛒 Spending phase        ││
│  │   ₹38,200 spent, ₹1,800 left       ││
│  │   [ View ledger ]                  ││
│  └─────────────────────────────────┘│
│                                       │
│  ─── BY CATEGORY ───                  │
│  💧 Water/RO        ₹4,500            │
│  🪔 Festivals      ₹17,800            │
│  🪑 Common Assets   ₹1,800            │
│  🎉 Social Events   ₹8,200            │
│  [ See full breakdown ]              │
│                                       │
│  [ 📊 OPEN BALANCE SHEET ]            │
└────────────────────────────────────┘
```

### 4.2 Fund detail — `/dashboard/funds/[id]`

```
┌────────────────────────────────────┐
│  ← Back                                │
│                                       │
│  💧 Water Softener AMC 2026           │
│  Annual maintenance contract for      │
│  the rooftop softener system.         │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ ₹38,500 / ₹50,000 (77%)           ││
│  │ ▓▓▓▓▓▓▓▓▓▓░░░                     ││
│  │                                   ││
│  │ 154 of 200 flats contributed      ││
│  │ Suggested per flat: ₹250          ││
│  │ Deadline: April 30, 2026          ││
│  └─────────────────────────────────┘│
│                                       │
│  [ ✓ I'VE CONTRIBUTED — REPORT ]     │
│                                       │
│  ─── MONEY IN (₹38,500) ───           │
│  [ Sort: Latest ▼ ] [ Search 🔍 ]    │
│  ┌─────────────────────────────────┐│
│  │ A-204 Sharma — ₹250                ││
│  │ Apr 12 • UPI • UTR shown ✓        ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ B-101 Verma — ₹500 (extra)        ││
│  │ Apr 11 • UPI ✓                    ││
│  └─────────────────────────────────┘│
│  ...152 more...                       │
│  [ Show all contributors ]           │
│                                       │
│  ─── MONEY OUT (₹0) ───               │
│  No spends yet — collection ongoing  │
│                                       │
│  ─── WHO HASN'T PAID YET (46) ───    │
│  [ Show flat list ]                   │
│                                       │
│  ─── DISCUSSION (3) ───               │
│  💬 Mr. Reddy (B-203): "Will we get   │
│      a copy of the AMC contract?"    │
│      ↳ Admin: "Yes, will share once   │
│        we sign it."                   │
│  [ Add comment ]                      │
└────────────────────────────────────┘
```

### 4.3 Contribute — `/dashboard/funds/[id]/contribute`

```
┌────────────────────────────────────┐
│  Contribute to:                       │
│  💧 Water Softener AMC 2026           │
│                                       │
│  Suggested: ₹250                      │
│                                       │
│  STEP 1 — Pay                         │
│  ─────────                            │
│  📲 UPI to: aaditri@hdfcbank          │
│       [QR CODE]                       │
│  💵 Or pay cash to Mr. Verma (B-101) │
│                                       │
│  STEP 2 — Report it                   │
│  ───────────────                      │
│                                       │
│  Amount paid *                        │
│  [₹250________]                       │
│                                       │
│  Payment method *                     │
│  ( ) UPI  ( ) Cash  ( ) Cheque       │
│                                       │
│  Reference (UTR if UPI) *             │
│  [232145679876_____]                 │
│                                       │
│  Date *                               │
│  [Apr 12, 2026]                      │
│                                       │
│  Screenshot                           │
│  [ 📷 UPLOAD ]                        │
│                                       │
│  ☐ Hide my name publicly (anonymous)  │
│                                       │
│  Notes (optional)                     │
│  [Paid via PhonePe___________]      │
│                                       │
│  [ SUBMIT ]                           │
└────────────────────────────────────┘
```

### 4.4 Flat-wise grid — `/dashboard/funds/[id]/flats`

The "who paid, who didn't" view. **This is the social-pressure feature.**

```
┌────────────────────────────────────┐
│  Diwali 2026 — Flat-wise Status      │
│  Suggested ₹250 per flat              │
│                                       │
│  ✅ Paid: 154   🟡 Partial: 12        │
│  ⚪ Pending: 34                       │
│                                       │
│  [ All ▼ ]   [ Search flat 🔍 ]      │
│                                       │
│  TOWER A                              │
│  ┌────┬────┬────┬────┐               │
│  │A101│A102│A103│A104│               │
│  │ ✅ │ ✅ │ ⚪ │ ✅ │               │
│  ├────┼────┼────┼────┤               │
│  │A201│A202│A203│A204│               │
│  │ ✅ │ 🟡 │ ✅ │ ✅ │               │
│  └────┴────┴────┴────┘               │
│  ...                                  │
│                                       │
│  TOWER B                              │
│  ...                                  │
│                                       │
│  Tap any flat for details             │
└────────────────────────────────────┘
```

Tap a flat → modal showing all that flat's contributions across this fund (and a button to view all funds for that flat).

### 4.5 Overall balance sheet — `/dashboard/funds/balance-sheet`

The big-picture view, opens to all residents.

```
┌────────────────────────────────────┐
│  Community Balance Sheet              │
│  As of April 12, 2026                 │
│                                       │
│  [Period: Last 12 months ▼]          │
│  [ 📥 Download PDF ]                  │
│                                       │
│  ─── SUMMARY ───                      │
│  Total Collected      ₹3,80,000      │
│  Total Spent          ₹3,32,650      │
│  Total Refunded         ₹0            │
│  ─────────────────                    │
│  Net Balance          ₹47,350 ✅     │
│                                       │
│  ─── BY CATEGORY ───                  │
│  ┌─────────────────────────────────┐│
│  │ [Pie chart: spend by category]    ││
│  └─────────────────────────────────┘│
│                                       │
│  Category         In       Out    Bal│
│  ─────────       ────     ───     ───│
│  💧 Softener   ₹50K  →  ₹47K   ₹3K  │
│  🪔 Festivals  ₹85K  →  ₹78K   ₹7K  │
│  🪑 Assets     ₹40K  →  ₹38K   ₹2K  │
│  🎉 Events     ₹95K  →  ₹89K   ₹6K  │
│  🚰 RO         ₹30K  →  ₹30K   ₹0   │
│  🔧 Repairs    ₹40K  →  ₹38K   ₹2K  │
│  💰 Pool       ₹40K  →  ₹13K   ₹27K │
│  ────────────  ────  →  ────   ────  │
│  TOTAL        ₹3.8L  →  ₹3.3L  ₹47K │
│                                       │
│  ─── BY FUND (closed) ───             │
│  ✅ Holi 2026         ₹15K → ₹14.5K  │
│  ✅ Republic Day '26  ₹5K  → ₹4.8K   │
│  ✅ Cricket Trophies  ₹8K  → ₹7.6K   │
│  ✅ Garden Tools      ₹12K → ₹11.8K  │
│  ...8 more closed                    │
│                                       │
│  ─── BY FLAT (top contributors) ───  │
│  🥇 B-101 Verma      ₹4,500           │
│  🥈 A-204 Sharma     ₹3,800           │
│  🥉 C-302 Patel      ₹3,500           │
│  [ See all 200 flats ]               │
│                                       │
│  ─── MONTHLY TREND ───                │
│  [Bar chart: in vs out per month]    │
└────────────────────────────────────┘
```

### 4.6 Per-flat history — `/dashboard/funds/by-flat/[flat]`

Anyone can view any flat's contribution history (transparency).

```
┌────────────────────────────────────┐
│  Flat B-101 — Contribution History    │
│                                       │
│  Total contributed: ₹4,500            │
│  Across 11 funds                      │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ ₹500 — Diwali 2026 (Apr 10)       ││
│  │ ₹250 — Softener AMC (Apr 11)      ││
│  │ ₹500 — Common Chairs (Mar 18)     ││
│  │ ₹300 — Holi 2026 (Mar 5)          ││
│  │ ₹500 — Children's Picnic (Feb 12) ││
│  │ ...6 more                         ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

---

## 5. Admin UX

### 5.1 Admin home — `/admin/funds`

```
┌────────────────────────────────────┐
│  Manage Community Funds               │
│                                       │
│  [ + CREATE NEW FUND ]                │
│                                       │
│  ⚠ Pending actions:                  │
│  • 7 contributions to verify         │
│  • 2 funds past collection deadline  │
│                                       │
│  [Active] [Drafts] [Closed]          │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ 💧 Softener AMC 2026 ▶            ││
│  │ ₹38,500/₹50K • 154 contribs       ││
│  │ [ Manage ]                         ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🪔 Diwali 2026 ▶                  ││
│  │ ₹12,300/₹25K • 51 contribs        ││
│  │ [ Manage ]                         ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

### 5.2 Create fund — `/admin/funds/new`

```
┌────────────────────────────────────┐
│  Create Community Fund                │
│                                       │
│  Name *                               │
│  [Diwali Decoration 2026__________]  │
│                                       │
│  Category *                           │
│  [🪔 Festivals & Celebrations ▼]    │
│                                       │
│  Description                          │
│  [Decorations, lighting, sweets____] │
│  [for Diwali night party 2026._____] │
│                                       │
│  Target amount                        │
│  ₹[25,000_______]                    │
│  ☐ Open-ended (no target)            │
│                                       │
│  Suggested per flat                  │
│  ₹[250_________]                     │
│                                       │
│  Collection deadline                  │
│  [Nov 5, 2026]                       │
│                                       │
│  Event date                           │
│  [Nov 12, 2026]                      │
│                                       │
│  ☐ Recurring (yearly)                 │
│                                       │
│  Visibility                           │
│  ◉ All residents (recommended)       │
│  ○ Committee only                    │
│                                       │
│  Cover image                          │
│  [ 📷 UPLOAD ]                        │
│                                       │
│  [ Save as draft ] [ Publish & notify]│
└────────────────────────────────────┘
```

When published → push notification to all residents:
> 🪔 *New community fund: Diwali Decoration 2026 — suggested ₹250/flat. Tap to contribute.*

### 5.3 Verify contributions — `/admin/funds/[id]/contributions`

```
┌────────────────────────────────────┐
│  Diwali 2026 — Contributions          │
│                                       │
│  [ All ] [ To verify (7) ] [ Verified]│
│                                       │
│  ┌─────────────────────────────────┐│
│  │ 🟡 A-204 Sharma — ₹250            ││
│  │ Apr 12 • UPI • UTR 232145..       ││
│  │ [ View screenshot ]                ││
│  │ [ ✓ Confirm ]  [ ✗ Reject ]        ││
│  └─────────────────────────────────┘│
│  ...6 more...                         │
│                                       │
│  [ Bulk verify ✓ ]                    │
│  [ Export CSV ]                       │
│                                       │
│  💡 Quick add (cash):                 │
│  [Flat ▼] [₹___] [Cash ▼] [+ ADD]    │
└────────────────────────────────────┘
```

The **quick-add row** is critical — many small society collections happen in cash, with a committee member walking door-to-door collecting. Admin needs to add 50 cash entries fast. One row, no modal.

### 5.4 Record spend — `/admin/funds/[id]/spends/new`

```
┌────────────────────────────────────┐
│  Record Spend                         │
│  Fund: Diwali 2026                    │
│  Available: ₹12,300                   │
│                                       │
│  Amount *                             │
│  ₹[3,500_______]                     │
│                                       │
│  Date *                               │
│  [Nov 8, 2026]                       │
│                                       │
│  Description *                        │
│  [Marigold flowers and toran from_]  │
│  [Lakshmi Florist____________]       │
│                                       │
│  Vendor name                          │
│  [Lakshmi Florist____________]       │
│  Phone (optional)                     │
│  [98xxxx xxxx________________]       │
│                                       │
│  Sub-category                         │
│  [Decoration ▼]                      │
│                                       │
│  Payment method *                     │
│  ( ) Cash  ( ) UPI  ( ) Cheque       │
│  ( ) Bank transfer                   │
│                                       │
│  Payment reference                    │
│  [UTR/cheque #___________]           │
│                                       │
│  Paid by *                            │
│  ◉ Society fund (direct)             │
│  ○ I paid out of pocket — reimburse me│
│  ○ Another resident paid → [Pick ▼]  │
│                                       │
│  Receipt photo *                      │
│  [ 📷 PHOTO ]                         │
│                                       │
│  [ SAVE & POST ]                      │
└────────────────────────────────────┘
```

After save → optionally posts to fund timeline as: *"Admin recorded spend: ₹3,500 to Lakshmi Florist for marigolds. Receipt attached."*

### 5.5 Close fund — `/admin/funds/[id]/close`

```
┌────────────────────────────────────┐
│  Close fund: Diwali 2026              │
│                                       │
│  Collected: ₹25,400                   │
│  Spent:     ₹23,100                   │
│  Surplus:   ₹2,300                    │
│                                       │
│  What to do with surplus?             │
│  ◉ Roll into General Pool             │
│  ○ Refund to contributors (pro-rata)  │
│  ○ Roll to next year's Diwali fund   │
│  ○ Specify per-flat refunds          │
│                                       │
│  Closure note (visible publicly) *   │
│  [Event was a great success. ₹2,300_]│
│  [surplus moved to General Pool.____]│
│                                       │
│  ☐ Send summary push to all residents │
│                                       │
│  [ CLOSE FUND ]                       │
└────────────────────────────────────┘
```

If "refund pro-rata" chosen, system computes each contributor's refund share automatically and shows for confirmation.

---

## 6. The unique features (my best recommendations)

These are the features I'd push hard for, because they make this **dramatically better** than ad-hoc WhatsApp + Excel that everyone currently uses.

### 6.1 ⭐ Flat-wise contribution grid — *kills WhatsApp arguments*

Show a tower-grid of all flats with a colored dot showing paid/partial/pending status for the current fund. Tap a flat = see what they've paid. This single screen ends the "did Mr. X pay?" debates.

### 6.2 ⭐ Anonymous contributions — *some donors prefer privacy*

A toggle when reporting: "Hide my name publicly." Internally still tracked (admin sees it), but in the public list shows as "Anonymous from B-tower" (without flat number). Encourages bigger contributions from privacy-conscious residents.

### 6.3 ⭐ In-kind contributions — *not everything is cash*

Some residents donate items: 5kg sweets, 20 chairs, decoration material, food for an event. Track these separately with a value estimate, attribute properly, give same recognition.

### 6.4 ⭐ Reimbursement workflow — *committee members shouldn't be out of pocket*

When a committee member runs out and pays vendors out of pocket, mark it as "to be reimbursed." Shows up in admin queue: "₹4,200 to be reimbursed to Mr. Verma (B-101)." When society pays back, click "mark reimbursed."

### 6.5 ⭐ Discussion threads per fund — *public Q&A*

Comments under each fund. "Why did chairs cost ₹1000 each?" "Got 5 quotes, this was lowest with delivery + 2-yr warranty." Documented forever, no more "who decided this?" disputes.

### 6.6 ⭐ Recurring fund auto-rollover

When closing the 2026 fund, one-click "Create 2027 version" — copies category, target, suggested-per-flat, description. Saves admin work for annual things like Diwali and softener AMC.

### 6.7 ⭐ Surplus handling rules

When closing: roll to general pool, refund pro-rata, roll to next year, or per-flat refund. Pro-rata calculator does the math. Refunds become first-class entries in the ledger (not just a note).

### 6.8 ⭐ Public PDF balance sheet — for AGM, WhatsApp share

One-click PDF: branded, dated, all closed funds with totals + open-fund snapshot + month-wise charts. Designed to be sharable in WhatsApp groups so non-app residents can see too.

### 6.9 ⭐ Fund cover image + photo gallery

Every fund can have a cover image (event poster, vendor quote, item photo). After event, residents upload photos to the fund — becomes a memory/proof album. Made: ₹15,000 spent on Holi → here are the 40 photos of the event we hosted.

### 6.10 ⭐ Trust-building features

Three small things that hugely build trust:
- **Late-paid badge** — "Joined fund late" tag for people who chip in after deadline (shows positive recognition, not shame)
- **Top contributor leaderboard** — privacy-respecting, voluntary opt-out, fun gamification
- **Auto-thank-you** — when a contribution is verified, push to that resident: "Thank you for ₹250 to Diwali 2026 ❤"

### 6.11 ⭐ "Without payment gateway" smart cash workflow

Since this is a cash-heavy informal system, give the **collector** (not just admin) a quick interface: "I'm collecting for Diwali, mark these flats as paid." Mobile-first, one-tap-per-flat, syncs in real time. So when Mr. Verma walks door-to-door collecting cash, he updates the app live, no spreadsheet, no late entry.

### 6.12 ⭐ Suggested-amount nudge

If suggested is ₹250, when resident contributes show:
- "You contributed ₹250 — same as suggested 👍" or
- "You contributed ₹500 — extra ₹250 thank you 🙏" or
- "You contributed ₹100 — appreciate it; suggested was ₹250"

Soft, not shaming. Makes the social norm visible.

### 6.13 ⭐ Two-tier visibility (committee-only funds)

Sometimes committee discusses sensitive stuff — e.g., emergency repair quotes, legal fund. `visibility = committee_only` hides from regular residents. Default is `all_residents` — switch must be deliberate.

### 6.14 ⭐ Excel/CSV export everywhere

Many treasurers maintain their own books. Every list (contributions, spends, balance sheet, flat matrix) has CSV export. No vendor lock-in.

### 6.15 ⭐ Search & deep-link

"Show me all spends to 'Lakshmi Florist'" across all funds. "Show me everything Flat B-101 has contributed since 2024." Fast, indexed.

### 6.16 ⭐ Voice/photo expense entry (future polish)

Admin takes photo of receipt → OCR pre-fills amount + vendor + date → admin reviews + posts. Saves 90% of typing for receipt-heavy events. (Future tier — not for v1, but design for it.)

---

## 7. Notifications (all free push)

| Event | Notify | Channel |
|---|---|---|
| New fund published | All residents | Push + bot inbox |
| Contribution verified | The contributor | Push (auto-thank-you) |
| Contribution rejected | The contributor | Push with reason |
| Big spend posted (>₹5K) | All residents (transparency) | Push |
| Fund 90% target reached | All residents | Push |
| Fund deadline in 3 days, you haven't contributed | That resident only | Push |
| Fund closed with summary | All residents | Push |
| Refund issued to you | That resident | Push |
| New comment on a fund you contributed to | Other contributors | Push (digest, daily) |
| Reimbursement to you marked done | The person | Push |

Configurable per-resident in notification preferences (already in Phase 2.6).

---

## 8. API endpoints

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /api/funds` | Any resident | List visible funds |
| `GET /api/funds/[id]` | Any resident | Fund detail with computed totals |
| `GET /api/funds/[id]/contributions` | Any resident | All contributions (received only) |
| `GET /api/funds/[id]/spends` | Any resident | All spends |
| `GET /api/funds/[id]/flats` | Any resident | Flat-wise grid |
| `GET /api/funds/[id]/comments` | Any resident | Discussion thread |
| `POST /api/funds/[id]/comments` | Any resident | Add comment |
| `POST /api/funds/[id]/contributions` | Any resident | Self-report contribution |
| `GET /api/funds/by-flat/[flat]` | Any resident | A flat's history |
| `GET /api/funds/balance-sheet` | Any resident | Overall balance sheet |
| `GET /api/funds/balance-sheet/pdf` | Any resident | PDF download |
| `GET /api/admin/funds` | Admin | All funds incl. drafts/restricted |
| `POST /api/admin/funds` | Admin | Create fund |
| `PATCH /api/admin/funds/[id]` | Admin | Edit fund |
| `POST /api/admin/funds/[id]/publish` | Admin | Publish + notify |
| `POST /api/admin/funds/[id]/close` | Admin | Close fund (with surplus handling) |
| `GET /api/admin/funds/[id]/contributions/pending` | Admin | Verification queue |
| `POST /api/admin/funds/[id]/contributions` | Admin | Quick-add cash contribution |
| `POST /api/admin/funds/contributions/[id]/verify` | Admin | Mark received |
| `POST /api/admin/funds/contributions/[id]/reject` | Admin | Reject |
| `POST /api/admin/funds/contributions/bulk-verify` | Admin | Bulk verify |
| `POST /api/admin/funds/[id]/spends` | Admin | Record spend |
| `POST /api/admin/funds/[id]/refunds` | Admin | Issue refund |
| `POST /api/admin/funds/[id]/spends/[sid]/reimburse` | Admin | Mark reimbursed |
| `POST /api/admin/funds/categories` | Admin | Manage categories |

---

## 9. Effort breakdown

| Task | Effort |
|---|---|
| Database migration (7 tables, RLS, triggers, views) | 0.5 day |
| Resident funds list + detail UI | 1 day |
| Resident contribute flow | 0.5 day |
| Flat-wise grid + per-flat history | 0.5 day |
| Admin: create/edit/publish/close fund | 1 day |
| Admin: verify contributions + quick-add cash | 0.5 day |
| Admin: record spends + refunds + reimbursements | 0.5 day |
| Balance sheet view + category charts + PDF export | 0.5 day |
| Comments + attachments | 0.25 day |
| Notifications integration | 0.25 day |
| Polish + testing + edge cases | 0.5 day |
| **Total** | **~5 days** |

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Resident reports fake UPI UTR | Admin verifies against bank statement before marking received. Status stays "reported" until verified — never adds to total. |
| Cash contributions not tracked properly | Admin/collector enters via quick-add immediately. Per-flat grid makes gaps obvious — peer pressure self-corrects. |
| Disputes over spend amounts | Receipt mandatory >₹500 (configurable). Public ledger means anyone can flag in comments. |
| Privacy concerns ("everyone sees what I paid") | Per-contribution anonymous toggle. Per-flat history visibility opt-out (resident setting). |
| Admin enters wrong amount | Edit history kept (audit trail in `updated_at`). Future: `fund_audit_log` table for full event log. |
| Fund left "open" forever after event | Cron sends weekly nudge to admin: "Diwali 2026 has been at 95% target since 30 days. Close it?" |
| Surplus disappears | Closing requires explicit surplus handling decision — UI won't let admin skip it. All refund/rollover entries are first-class ledger rows. |
| Recurring funds duplicated | "Create 2027 version" button auto-links via `parent_fund_id` so users see history. |
| Categories explode in number | Categories are admin-managed; soft-deletable; suggest staying under 15. |
| What if someone wants to contribute cash but isn't tech-savvy? | Any committee member with admin role can quick-add on their behalf. Pure cash flow doesn't require resident to use app. |
| Resident contributes but never marks it | Bank reconciliation feature (future): admin matches bank credits to flats by amount + date. |
| In-kind contribution valuation disputes | Always mark `is_in_kind=true` and store `in_kind_description` separately from cash totals. Don't add to monetary total — show in a separate "In-kind contributions" section. |

---

## 11. Open decisions before building

1. **Who can create funds — only admin, or any committee member?** *Recommend: admin role only for v1; add `committee` sub-role later.*
2. **Show full contributor name or just "Flat A-204"?** *Recommend: show name + flat by default; per-contribution anonymous toggle for opt-out.*
3. **Should top-contributor leaderboard exist?** *Recommend: yes, but opt-out by default (avoids guilt-tripping).*
4. **Mandatory receipt threshold?** *Recommend: ₹500. Configurable in admin settings.*
5. **Should comments be moderated or freely posted?** *Recommend: freely posted, admin can pin or delete inappropriate ones.*
6. **Default fund visibility — `all_residents` or `committee_only`?** *Recommend: `all_residents`. Switching to committee-only must be deliberate.*
7. **Allow residents to propose funds (admin approves) or admin-only creation?** *Recommend: admin-only for v1; "Suggest a fund" feature later.*
8. **Cash collection by a specific person — track collector identity?** *Recommend: yes, store `received_by` so we know "Mr. Verma collected ₹6,250 in cash from 25 flats on Apr 5".*
9. **Auto-flag to admin if the same UTR is reported twice (fraud check)?** *Recommend: yes — unique UTR enforced at DB level.*
10. **Show "since join date" only for contributions, or full history visible to new residents?** *Recommend: full history visible — that's the point of transparency.*

---

## 12. How this fits in the product backlog

This is a **new feature** that didn't exist in the original backlog. Here's how it slots in:

- **Distinct from C1** (formal monthly maintenance bills with payment gateway question) — this is informal, voluntary, transparent
- **Standalone** — has zero dependencies on gate management
- **Sequence:** Build alongside or right after C1 (formal bills). Both share concepts (UPI receiver UI, payment-report flow, treasurer verification UX) so building back-to-back has 30%+ code reuse opportunities.
- **Phase suggestion:** Phase 6.5 (between gate management v1 and full finance system)
- **Effort:** **~5 days** (smaller than C1 because no bill-cycle generation, no late-fee logic, no bank-statement import-required flow)
- **Cost:** ₹0/month forever

### Updated backlog snapshot

| Feature | Effort | Cost |
|---|---|---|
| C1 Finance tracking (formal bills) | 6–8 days | ₹0/mo |
| **C9 Community internal funds (new)** | **~5 days** | **₹0/mo** |
| **Combined finance suite** | **~11–13 days** | **₹0/mo** |

Together, these two features give Aaditri Emerland a complete, ₹0/month finance & transparency system that rivals (and arguably exceeds) what paid platforms like ApnaComplex / NoBrokerHood charge ₹15K-30K/year for.

---

## 13. Why this is a winning feature

1. **Trust above all.** Public ledger = ends every "where did the money go" complaint forever
2. **Easier than WhatsApp + Excel** that committees use today (and miscalculations cause AGM fights)
3. **₹0/month.** No fees, no gateway, just a ledger
4. **Inclusive.** In-kind, anonymous, cash, reimbursement workflows match how real societies operate
5. **Single source of truth** for all small "we chip in for this" collections — currently scattered across WhatsApp screenshots, paper notebooks, Mr. Verma's memory
6. **Encourages contribution.** The flat-wise grid creates positive social pressure without naming/shaming
7. **AGM-ready.** Closes the year with auto-generated PDF, top contributors, full breakdown
8. **Pairs perfectly with C1.** Together they cover 95% of all society money flow

---

## 14. Recommended build sequence

**Day 1:** Migration + RLS + triggers + categories seed
**Day 2:** Resident UI — list, detail, contribute flow
**Day 3:** Admin UI — create/edit/publish, verify queue, quick-add cash
**Day 4:** Spends, refunds, reimbursements, close-fund flow
**Day 5:** Balance sheet view + flat-wise grid + PDF export + polish

---

*Last updated: April 2026*
*Status: Specification, ready for implementation*
*Effort: ~5 days*
*Operating cost: ₹0/month*
