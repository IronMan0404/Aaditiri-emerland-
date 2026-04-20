# Finance Tracking — Bills, Payments & Expenses

A complete specification for tracking maintenance bills, resident payments, and society expenses **without any payment gateway**. Residents pay through their own UPI/bank transfer (PhonePe, GPay, BHIM, NEFT, IMPS) directly to the society bank account. The app **records and tracks** payments — it does not process them.

**Cost commitment:** **₹0/month forever** — no Razorpay, no PayU, no transaction fees.

**Status:** Specification — ready to implement after v1 gate management ships.

**Effort estimate:** **6–8 days** for a single developer working full-time (vs. 7–10 days for the full payment-gateway version).

---

## 1. Why "track only" is the right choice for Aaditri Emerland

| Concern | Payment gateway (Razorpay) | Track-only (this spec) |
|---|---|---|
| **Cost** | ~2% per transaction (~₹20K/mo at ₹10L collected) | **₹0/month** |
| **Setup** | Business KYC, GST, settlement account, 2-week onboarding | None — start tomorrow |
| **Ongoing compliance** | Razorpay reports, GST on convenience fee, refunds workflow | None |
| **Resident familiarity** | Pay via card/netbanking inside an app | Pay via UPI like they already do every day |
| **Settlement delay** | 2–3 days T+2 to society bank | Instant — already in the bank |
| **Failed payments / disputes** | Resident files chargeback, society loses | Bank statement is the source of truth — no disputes |
| **Fraud risk** | Card fraud, chargebacks | Zero — UPI is push-only |
| **What you lose** | Auto-mark-paid, instant receipt | Treasurer needs to verify payment manually |

**Verdict:** For a 200-flat society in India, the savings (~₹2.5L/year) and zero compliance burden vastly outweigh the small inconvenience of manual payment verification.

The only friction is "treasurer must mark the payment as received" — which takes ~5 seconds per payment when reviewing the bank statement at end of month. Or the resident self-reports the UTR and the treasurer just clicks "Verify" in bulk.

---

## 2. What this system tracks

### 2.1 Three core entities

```
┌────────────────────────────────────────────────────┐
│  BILLS (what residents owe)                          │
│  ─────────────────────                               │
│  Issued monthly per flat                              │
│  Itemized: maintenance + water + sinking + clubhouse  │
│  Due date + late fee policy                           │
└────────────────────────────────────────────────────┘
                       │
                       │ has many
                       ▼
┌────────────────────────────────────────────────────┐
│  PAYMENTS (what residents have paid)                 │
│  ─────────────────────────                            │
│  One bill can have multiple payments (partial)       │
│  Each payment: amount + UTR + screenshot + status    │
│  Status: reported → verified → reconciled            │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  EXPENSES (what the society spends)                  │
│  ──────────────────────────                           │
│  Logged by treasurer with bill/invoice attached      │
│  Categorized (electricity, water, security, etc.)    │
│  Optionally tied to a vendor                          │
└────────────────────────────────────────────────────┘
```

### 2.2 What residents see

- Their **current dues** with itemized breakdown
- **Payment history** — what they've paid, when, status
- **Society bank details + UPI QR code** for paying
- **One-click "Report payment"** — enter UTR or upload screenshot
- **Receipt** for verified payments (PDF download)
- **Late fee** auto-calculated if past due date

### 2.3 What treasurer/admin sees

- **Dues dashboard** — total billed, total collected, total outstanding
- **Defaulter list** — flats with overdue bills
- **Reported payments queue** — verify each (1 click)
- **Expense ledger** — all society expenses by category and month
- **Monthly P&L** — collected vs. spent
- **Bank reconciliation** — match bank statement entries to payments
- **Reports** for AGM (annual collection summary, expense breakdown, balance sheet basics)

### 2.4 What the system does NOT do

❌ Process payments (no card/UPI charging through the app)
❌ Send money to vendors (treasurer pays vendors via their own bank)
❌ Tax filing (treasurer exports CSV, accountant files)
❌ Auto-reconcile from bank API (manual or CSV import only)
❌ Refunds (handled outside the system)

---

## 3. Database schema

### 3.1 Migration file: `20260501_finance_tracking.sql`

```sql
-- ============================================================
-- FINANCE TRACKING — Bills, Payments, Expenses
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- BILL CATEGORIES (configurable line-items)
-- ────────────────────────────────────────────────────────────
create table if not exists public.bill_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,            -- e.g. 'maintenance', 'water', 'sinking_fund'
  name text not null,                   -- e.g. 'Monthly Maintenance'
  description text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.bill_categories (code, name, display_order) values
  ('maintenance', 'Monthly Maintenance', 10),
  ('water', 'Water Charges', 20),
  ('electricity_common', 'Common Area Electricity', 30),
  ('sinking_fund', 'Sinking Fund Contribution', 40),
  ('clubhouse', 'Clubhouse Subscription', 50),
  ('parking', 'Parking Charges', 60),
  ('late_fee', 'Late Payment Fee', 70),
  ('other', 'Other Charges', 80)
on conflict (code) do nothing;

-- ────────────────────────────────────────────────────────────
-- BILL CYCLES (e.g., "April 2026", "Q2 2026")
-- ────────────────────────────────────────────────────────────
create table if not exists public.bill_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,                   -- e.g., "April 2026"
  period_start date not null,           -- 2026-04-01
  period_end date not null,             -- 2026-04-30
  due_date date not null,               -- 2026-04-15
  late_fee_grace_days integer not null default 5,
  late_fee_amount integer not null default 0,           -- flat fee in paise
  late_fee_percent_per_month numeric(5,2) default 0,    -- e.g., 1.50% per month
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (period_start, period_end)
);

create index bill_cycles_status_idx on public.bill_cycles(status);

-- ────────────────────────────────────────────────────────────
-- BILLS (one row per flat per cycle)
-- ────────────────────────────────────────────────────────────
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.bill_cycles(id) on delete restrict,
  flat_number text not null,
  resident_id uuid references public.profiles(id),

  -- Amounts (all in paise — INR * 100, to avoid floating-point bugs)
  total_amount integer not null,        -- sum of all line items
  paid_amount integer not null default 0,
  outstanding_amount integer generated always as (total_amount - paid_amount) stored,

  status text not null default 'pending' check (status in (
    'pending',          -- bill issued, no payment yet
    'partial',          -- some payment received, balance remains
    'paid',             -- fully paid
    'overdue',          -- past due_date + grace, unpaid
    'waived'            -- admin waived (with reason)
  )),

  bill_number text unique not null,     -- e.g., "AE-2026-04-A204"
  due_date date not null,               -- copied from cycle for snapshot
  notes text,                           -- admin can add per-flat notes
  waived_by uuid references public.profiles(id),
  waived_at timestamptz,
  waiver_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, flat_number)
);

create index bills_flat_idx on public.bills(flat_number, cycle_id);
create index bills_resident_idx on public.bills(resident_id, status);
create index bills_status_idx on public.bills(status, due_date);
create index bills_outstanding_idx on public.bills(outstanding_amount) where outstanding_amount > 0;

-- ────────────────────────────────────────────────────────────
-- BILL LINE ITEMS (what makes up the bill)
-- ────────────────────────────────────────────────────────────
create table if not exists public.bill_line_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  category_id uuid not null references public.bill_categories(id),
  description text,                     -- e.g., "30 days @ ₹150/day"
  amount integer not null,              -- paise
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index bill_line_items_bill_idx on public.bill_line_items(bill_id);

-- ────────────────────────────────────────────────────────────
-- PAYMENTS (one row per payment received)
-- ────────────────────────────────────────────────────────────
create type payment_method as enum (
  'upi',                -- PhonePe, GPay, BHIM, etc.
  'neft',
  'imps',
  'rtgs',
  'cheque',
  'cash',
  'bank_transfer',      -- generic
  'auto_adjust',        -- e.g., refund applied to next bill
  'other'
);

create type payment_status as enum (
  'reported',           -- resident submitted, treasurer hasn't verified
  'verified',           -- treasurer confirmed in bank statement
  'rejected',           -- treasurer couldn't find the payment
  'reconciled'          -- matched against bank statement import
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid references public.bills(id) on delete restrict,
  resident_id uuid not null references public.profiles(id),
  flat_number text not null,

  amount integer not null,              -- paise
  payment_date date not null,           -- when resident paid (per their record)
  method payment_method not null,
  reference_number text,                -- UTR for UPI/NEFT, cheque number, etc.

  -- Proof
  screenshot_url text,                  -- supabase storage path
  notes text,                           -- resident's note ("paid via PhonePe to society UPI")

  status payment_status not null default 'reported',

  -- Verification trail
  reported_by uuid not null references public.profiles(id),
  reported_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  rejection_reason text,                -- if treasurer can't find the payment

  -- For bank-statement reconciliation (future)
  bank_statement_row_id uuid,           -- reference to imported bank row

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_bill_idx on public.payments(bill_id);
create index payments_resident_idx on public.payments(resident_id, payment_date desc);
create index payments_status_idx on public.payments(status, reported_at desc);
create index payments_utr_idx on public.payments(reference_number) where reference_number is not null;

-- Enforce uniqueness on UTR to prevent duplicate reporting
create unique index payments_utr_unique on public.payments(reference_number)
  where reference_number is not null and status != 'rejected';

-- ────────────────────────────────────────────────────────────
-- EXPENSE CATEGORIES
-- ────────────────────────────────────────────────────────────
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.expense_categories (code, name, display_order) values
  ('security', 'Security Services', 10),
  ('housekeeping', 'Housekeeping & Cleaning', 20),
  ('garden', 'Garden & Landscaping', 30),
  ('electricity', 'Electricity (Common)', 40),
  ('water', 'Water Supply', 50),
  ('plumbing', 'Plumbing Repairs', 60),
  ('lift_amc', 'Lift Maintenance (AMC)', 70),
  ('pest_control', 'Pest Control', 80),
  ('legal', 'Legal & Compliance', 90),
  ('audit', 'Audit Fees', 100),
  ('insurance', 'Society Insurance', 110),
  ('repairs', 'General Repairs', 120),
  ('events', 'Community Events', 130),
  ('miscellaneous', 'Miscellaneous', 140)
on conflict (code) do nothing;

-- ────────────────────────────────────────────────────────────
-- VENDORS (people/companies the society pays)
-- ────────────────────────────────────────────────────────────
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,                   -- "ABC Security Services Pvt Ltd"
  contact_person text,
  phone text,
  email text,
  gstin text,                           -- optional GST number
  pan text,                             -- optional PAN
  bank_account_number text,             -- masked in UI (last 4 digits)
  bank_ifsc text,
  default_category_id uuid references public.expense_categories(id),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index vendors_active_idx on public.vendors(is_active, name) where is_active = true;

-- ────────────────────────────────────────────────────────────
-- EXPENSES (what the society spent)
-- ────────────────────────────────────────────────────────────
create type expense_payment_method as enum (
  'bank_transfer',
  'cheque',
  'cash',
  'upi',
  'auto_debit',
  'other'
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id),
  vendor_id uuid references public.vendors(id),

  amount integer not null,              -- paise
  expense_date date not null,
  description text not null,            -- "April security guard salary"

  -- Payment tracking
  payment_method expense_payment_method not null,
  payment_reference text,               -- cheque number, UTR, etc.
  paid_from_account text,               -- which society bank account

  -- Documentation (mandatory for amounts above a threshold)
  invoice_number text,
  invoice_url text,                     -- supabase storage
  receipt_url text,                     -- supabase storage

  -- Approval workflow (configurable)
  requires_approval boolean not null default false,
  approval_status text default 'approved' check (approval_status in (
    'pending', 'approved', 'rejected'
  )),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejection_reason text,

  -- Audit
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_date_idx on public.expenses(expense_date desc);
create index expenses_category_idx on public.expenses(category_id, expense_date desc);
create index expenses_vendor_idx on public.expenses(vendor_id, expense_date desc);
create index expenses_pending_approval_idx on public.expenses(approval_status)
  where approval_status = 'pending';

-- ────────────────────────────────────────────────────────────
-- SOCIETY BANK ACCOUNTS (for payment instructions to residents)
-- ────────────────────────────────────────────────────────────
create table if not exists public.society_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,           -- "Aaditri Emerland CHS Ltd"
  bank_name text not null,
  account_number text not null,
  ifsc text not null,
  branch text,
  account_type text not null default 'current' check (account_type in (
    'current', 'savings', 'maintenance', 'sinking_fund'
  )),
  upi_id text,                          -- e.g., "aaditri@hdfcbank"
  upi_qr_url text,                      -- supabase storage of QR image
  is_primary boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index society_bank_accounts_primary_unique on public.society_bank_accounts(is_primary)
  where is_primary = true and is_active = true;

-- ────────────────────────────────────────────────────────────
-- BANK STATEMENT IMPORTS (for reconciliation)
-- ────────────────────────────────────────────────────────────
create table if not exists public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.society_bank_accounts(id),
  period_start date not null,
  period_end date not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  filename text,
  total_credits integer not null default 0,
  total_debits integer not null default 0,
  rows_imported integer not null default 0,
  notes text
);

create table if not exists public.bank_statement_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_statement_imports(id) on delete cascade,
  txn_date date not null,
  description text,
  reference_number text,                -- UTR / cheque number
  credit integer not null default 0,
  debit integer not null default 0,
  balance integer,
  matched_payment_id uuid references public.payments(id),
  matched_expense_id uuid references public.expenses(id),
  match_status text not null default 'unmatched' check (match_status in (
    'unmatched', 'matched_payment', 'matched_expense', 'ignored'
  ))
);

create index bank_statement_rows_import_idx on public.bank_statement_rows(import_id);
create index bank_statement_rows_unmatched_idx on public.bank_statement_rows(match_status)
  where match_status = 'unmatched';

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.bill_categories enable row level security;
alter table public.bill_cycles enable row level security;
alter table public.bills enable row level security;
alter table public.bill_line_items enable row level security;
alter table public.payments enable row level security;
alter table public.expense_categories enable row level security;
alter table public.vendors enable row level security;
alter table public.expenses enable row level security;
alter table public.society_bank_accounts enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_rows enable row level security;

-- Bills: residents see their own; admin sees all
create policy "bills_resident_view_own"
  on public.bills for select to authenticated
  using (resident_id = auth.uid());

create policy "bills_admin_all"
  on public.bills for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Bill line items: same pattern
create policy "bill_line_items_resident_view_own"
  on public.bill_line_items for select to authenticated
  using (exists (
    select 1 from public.bills b
    where b.id = bill_line_items.bill_id and b.resident_id = auth.uid()
  ));

create policy "bill_line_items_admin_all"
  on public.bill_line_items for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Payments: residents see/insert their own; admin updates verification
create policy "payments_resident_view_own"
  on public.payments for select to authenticated
  using (resident_id = auth.uid());

create policy "payments_resident_insert_own"
  on public.payments for insert to authenticated
  with check (resident_id = auth.uid() and reported_by = auth.uid());

create policy "payments_admin_all"
  on public.payments for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Expenses, vendors, categories, bank accounts, imports: admin only
create policy "expenses_admin_all"
  on public.expenses for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "vendors_admin_all"
  on public.vendors for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Bank accounts: residents READ only (to know where to pay), admin write
create policy "society_bank_accounts_authenticated_read"
  on public.society_bank_accounts for select to authenticated
  using (is_active = true);

create policy "society_bank_accounts_admin_write"
  on public.society_bank_accounts for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Categories: read by all authenticated, write by admin
create policy "bill_categories_authenticated_read"
  on public.bill_categories for select to authenticated
  using (is_active = true);

create policy "expense_categories_admin_only"
  on public.expense_categories for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "bank_statement_imports_admin_only"
  on public.bank_statement_imports for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "bank_statement_rows_admin_only"
  on public.bank_statement_rows for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update bills.paid_amount when a payment is verified
create or replace function update_bill_paid_amount()
returns trigger language plpgsql as $$
declare
  v_bill_id uuid;
begin
  v_bill_id := coalesce(new.bill_id, old.bill_id);
  if v_bill_id is null then return coalesce(new, old); end if;

  update public.bills b
  set
    paid_amount = (
      select coalesce(sum(amount), 0)
      from public.payments p
      where p.bill_id = v_bill_id and p.status in ('verified', 'reconciled')
    ),
    status = case
      when (
        select coalesce(sum(amount), 0)
        from public.payments p
        where p.bill_id = v_bill_id and p.status in ('verified', 'reconciled')
      ) >= b.total_amount then 'paid'
      when (
        select coalesce(sum(amount), 0)
        from public.payments p
        where p.bill_id = v_bill_id and p.status in ('verified', 'reconciled')
      ) > 0 then 'partial'
      when b.due_date + (
        select coalesce(late_fee_grace_days, 0) from public.bill_cycles where id = b.cycle_id
      ) < current_date then 'overdue'
      else 'pending'
    end,
    updated_at = now()
  where b.id = v_bill_id;

  return coalesce(new, old);
end $$;

create trigger payments_update_bill_after
  after insert or update or delete on public.payments
  for each row execute function update_bill_paid_amount();

-- Auto-update overdue status nightly via cron (or this trigger on read)
-- Recommendation: run a cron daily at midnight to flip status='pending' to 'overdue'

-- ============================================================
-- VIEWS for reporting
-- ============================================================

create or replace view public.v_dues_summary as
select
  b.flat_number,
  b.resident_id,
  p.full_name as resident_name,
  count(*) filter (where b.status in ('pending', 'partial', 'overdue')) as bills_due,
  count(*) filter (where b.status = 'overdue') as bills_overdue,
  coalesce(sum(b.outstanding_amount) filter (where b.status in ('pending', 'partial', 'overdue')), 0) as total_outstanding,
  max(b.due_date) filter (where b.status in ('pending', 'partial', 'overdue')) as latest_due_date,
  min(b.due_date) filter (where b.status = 'overdue') as oldest_overdue_date
from public.bills b
left join public.profiles p on p.id = b.resident_id
group by b.flat_number, b.resident_id, p.full_name;

create or replace view public.v_monthly_pl as
select
  to_char(d.month, 'YYYY-MM') as month,
  coalesce(c.collected, 0) as total_collected,
  coalesce(e.spent, 0) as total_spent,
  coalesce(c.collected, 0) - coalesce(e.spent, 0) as net_surplus
from (
  select date_trunc('month', generate_series(
    (current_date - interval '12 months')::date,
    current_date,
    '1 month'::interval
  ))::date as month
) d
left join (
  select date_trunc('month', payment_date)::date as month,
         sum(amount) as collected
  from public.payments
  where status in ('verified', 'reconciled')
  group by 1
) c on c.month = d.month
left join (
  select date_trunc('month', expense_date)::date as month,
         sum(amount) as spent
  from public.expenses
  where approval_status = 'approved'
  group by 1
) e on e.month = d.month
order by d.month desc;
```

---

## 4. Resident UX

### 4.1 Bills home — `/dashboard/bills`

```
┌────────────────────────────────────┐
│  My Bills                              │
│                                       │
│  📊 Outstanding: ₹4,500                │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ 🟡 April 2026 — Due Apr 15         ││
│  │   ₹4,500 outstanding              ││
│  │   4 days remaining                 ││
│  │   [ View ] [ Pay Now ]             ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🟢 March 2026 — Paid Mar 10       ││
│  │   ₹4,500 / ₹4,500                 ││
│  │   [ View receipt ]                 ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🔴 February 2026 — OVERDUE        ││
│  │   ₹150 late fee added              ││
│  │   ₹4,650 outstanding              ││
│  │   [ View ] [ Pay Now ]             ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

### 4.2 Bill detail — `/dashboard/bills/[id]`

```
┌────────────────────────────────────┐
│  Bill: AE-2026-04-A204                │
│  Period: April 2026                   │
│  Flat: A-204                          │
│  Issued to: Sharma family             │
│  Due date: April 15, 2026             │
│                                       │
│  ─────── BREAKDOWN ──────             │
│  Monthly Maintenance     ₹3,500       │
│  Water Charges             ₹400        │
│  Common Electricity        ₹200        │
│  Sinking Fund              ₹400        │
│  ─────────────────────────             │
│  TOTAL                   ₹4,500       │
│                                       │
│  Already paid: ₹0                     │
│  Outstanding:  ₹4,500                 │
│                                       │
│  [ 💳 PAY NOW ]   [ 📥 Download PDF ] │
└────────────────────────────────────┘
```

### 4.3 Pay now — `/dashboard/bills/[id]/pay`

```
┌────────────────────────────────────┐
│  Pay ₹4,500                            │
│                                       │
│  STEP 1 — Pay via UPI or bank         │
│  ────────────────────────────         │
│                                       │
│  📲 UPI (recommended — instant)       │
│  ┌─────────────────────────────────┐│
│  │      [QR CODE IMAGE]              ││
│  │                                   ││
│  │  Scan with PhonePe, GPay, BHIM   ││
│  │                                   ││
│  │  Or pay to UPI ID:                ││
│  │  aaditri@hdfcbank                 ││
│  │  [ Tap to copy ]                  ││
│  └─────────────────────────────────┘│
│                                       │
│  🏦 Or bank transfer (NEFT/IMPS)     │
│  Account: Aaditri Emerland CHS Ltd   │
│  A/c No:  50100123456789             │
│  IFSC:    HDFC0001234                │
│  [ Tap to copy ]                     │
│                                       │
│  STEP 2 — Report payment              │
│  ────────────────────────────         │
│  After paying, tap below to log it    │
│  so we can verify and mark it paid.   │
│                                       │
│  [ ✓ I'VE PAID — REPORT IT ]          │
└────────────────────────────────────┘
```

### 4.4 Report payment — `/dashboard/bills/[id]/report-payment`

```
┌────────────────────────────────────┐
│  Report Payment                       │
│                                       │
│  Bill: April 2026 (₹4,500)            │
│                                       │
│  Amount paid *                        │
│  [₹4,500_____________]               │
│  (Can be partial)                     │
│                                       │
│  Payment date *                       │
│  [Apr 12, 2026]                      │
│                                       │
│  Payment method *                     │
│  ( ) UPI (PhonePe/GPay/BHIM)        │
│  ( ) NEFT / IMPS                      │
│  ( ) Cheque                           │
│  ( ) Cash (drop at admin office)     │
│                                       │
│  Reference number *                   │
│  (UTR for UPI/NEFT, cheque number)   │
│  [232145678901________________]      │
│                                       │
│  Upload screenshot (recommended)     │
│  [ 📷 CHOOSE PHOTO ]                  │
│                                       │
│  Notes (optional)                     │
│  [Paid via PhonePe___________]      │
│                                       │
│  [ SUBMIT PAYMENT ]                   │
└────────────────────────────────────┘
```

After submit:

```
┌────────────────────────────────────┐
│  ✅ Payment Reported                  │
│                                       │
│  Your payment of ₹4,500 has been      │
│  reported. Treasurer will verify it    │
│  within 1–2 business days.            │
│                                       │
│  Status: 🟡 Awaiting verification    │
│                                       │
│  You'll get a notification when      │
│  verified.                            │
│                                       │
│  [ Back to bills ]                    │
└────────────────────────────────────┘
```

### 4.5 Payment history — `/dashboard/bills/payments`

```
┌────────────────────────────────────┐
│  My Payment History                   │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ ✅ ₹4,500 — Mar 10, 2026          ││
│  │   For: March 2026 bill             ││
│  │   UTR: 232145678901               ││
│  │   Verified by Treasurer           ││
│  │   [ Download receipt ]             ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🟡 ₹4,500 — Apr 12, 2026 (today) ││
│  │   For: April 2026 bill             ││
│  │   UTR: 232145679876               ││
│  │   Awaiting verification           ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

### 4.6 Receipt PDF (auto-generated for verified payments)

Standard format:
- Society logo + name + registration number
- Receipt number (auto-generated, sequential)
- Date, flat, resident name
- Bill period covered
- Amount in words and figures
- Payment method + reference
- Treasurer's name (digital)
- "This is a computer-generated receipt. No signature required."

---

## 5. Admin (treasurer) UX

### 5.1 Finance dashboard — `/admin/finance`

```
┌────────────────────────────────────┐
│  Finance Dashboard — April 2026       │
│                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────┐│
│  │ COLLECTED │ │   DUE    │ │SPENT ││
│  │ ₹6,75,000 │ │ ₹2,25,000│ │₹5.2L ││
│  └──────────┘ └──────────┘ └──────┘│
│                                       │
│  Collection rate: 75% ⬇ -3% vs Mar   │
│  Net surplus this month: ₹1.55L       │
│                                       │
│  ─── PENDING ACTIONS ───              │
│  • 12 reported payments to verify     │
│  • 3 expenses awaiting approval       │
│  • 18 flats with overdue bills        │
│                                       │
│  [ Issue April bills ]                │
│  [ Verify payments → 12 ]             │
│  [ Add expense ]                      │
│  [ View defaulters → 18 ]             │
│  [ Monthly P&L report ]               │
└────────────────────────────────────┘
```

### 5.2 Issue bills — `/admin/finance/cycles/new`

```
┌────────────────────────────────────┐
│  Create Bill Cycle                    │
│                                       │
│  Cycle name *                         │
│  [April 2026__________________]      │
│                                       │
│  Period *                             │
│  From: [Apr 1, 2026]                 │
│  To:   [Apr 30, 2026]                │
│                                       │
│  Due date *                           │
│  [Apr 15, 2026]                      │
│                                       │
│  Late fee policy                      │
│  Grace period: [5] days              │
│  Flat fee: ₹[100] OR                 │
│  Per month: [1.5]%                   │
│                                       │
│  ─── BILL AMOUNTS ───                 │
│  How to set per-flat amounts?         │
│  ( ) Use last cycle's amounts        │
│  ( ) Same for all flats              │
│  ( ) Upload CSV                       │
│  ( ) Set individually                │
│                                       │
│  Same-for-all amounts:                │
│  Maintenance: ₹[3,500]               │
│  Water: ₹[400]                       │
│  Sinking: ₹[400]                     │
│  Common Elec: ₹[200]                 │
│                                       │
│  [ Preview 200 bills ] [ Save draft ]│
└────────────────────────────────────┘
```

After preview, treasurer can adjust per-flat (e.g., higher water for big families) and then **Publish** which:
- Creates 200 `bills` rows + line items in a transaction
- Sends a push notification to every resident: *"Your April 2026 bill of ₹4,500 is now available. Due Apr 15."*
- Posts to bot inbox: same message + link

### 5.3 Verify payments — `/admin/finance/payments/pending`

```
┌────────────────────────────────────┐
│  Payments Awaiting Verification (12)  │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ A-204 Sharma — ₹4,500             ││
│  │ April 2026 bill                    ││
│  │ Reported Apr 12, paid Apr 12       ││
│  │ UTR: 232145679876                 ││
│  │ Method: UPI                        ││
│  │ [ View screenshot ]                ││
│  │                                   ││
│  │ ✅ Verify   ❌ Reject               ││
│  └─────────────────────────────────┘│
│  ...11 more...                        │
│                                       │
│  [ Verify all (bulk) ]                │
└────────────────────────────────────┘
```

For bulk verification: treasurer reviews bank statement, ticks checkboxes next to entries that match, clicks "Verify selected" — done.

### 5.4 Defaulter list — `/admin/finance/defaulters`

```
┌────────────────────────────────────┐
│  Defaulter List                       │
│                                       │
│  18 flats with overdue dues           │
│  Total outstanding: ₹81,000           │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ A-101 Verma — ₹13,500 (3 months)  ││
│  │   Oldest: Feb 2026                 ││
│  │   [ Send reminder ] [ Waive ]      ││
│  │   [ Add late fee ]                 ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ B-205 Reddy — ₹4,500 (1 month)    ││
│  │   Oldest: Apr 2026                 ││
│  │   [ Send reminder ]                ││
│  └─────────────────────────────────┘│
│                                       │
│  [ Send reminders to all (push) ]    │
│  [ Export as PDF ]                    │
└────────────────────────────────────┘
```

### 5.5 Expenses — `/admin/finance/expenses`

```
┌────────────────────────────────────┐
│  Expenses — April 2026                │
│                                       │
│  Total: ₹5,20,000                     │
│                                       │
│  By category:                         │
│  • Security: ₹1,80,000                │
│  • Housekeeping: ₹1,20,000            │
│  • Lift AMC: ₹50,000                  │
│  • Electricity: ₹80,000               │
│  • Garden: ₹30,000                    │
│  • Other: ₹60,000                     │
│                                       │
│  [ + ADD EXPENSE ]                    │
│                                       │
│  Recent:                              │
│  ┌─────────────────────────────────┐│
│  │ Apr 10 — ABC Security             ││
│  │   ₹1,80,000 (security)             ││
│  │   April salary, 6 guards           ││
│  │   Bank transfer • UTR shown        ││
│  │   📎 invoice.pdf 📎 receipt.pdf    ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

### 5.6 Add expense — `/admin/finance/expenses/new`

```
┌────────────────────────────────────┐
│  Add Expense                          │
│                                       │
│  Category *                           │
│  [Security ▼]                        │
│                                       │
│  Vendor                               │
│  [ABC Security Services Pvt Ltd ▼]   │
│  [ + Add new vendor ]                 │
│                                       │
│  Amount *                             │
│  ₹[1,80,000_____________]            │
│                                       │
│  Date *                               │
│  [Apr 10, 2026]                      │
│                                       │
│  Description *                        │
│  [April salary, 6 guards___________] │
│                                       │
│  Payment method *                     │
│  ( ) Bank transfer  ( ) Cheque       │
│  ( ) UPI  ( ) Cash                   │
│                                       │
│  Payment reference                    │
│  [UTR/Cheque #______________]        │
│                                       │
│  Paid from                            │
│  [HDFC Current Account ▼]            │
│                                       │
│  Invoice number                       │
│  [ABC-2026-04-001______]             │
│                                       │
│  Upload invoice * (mandatory >₹10k)  │
│  [ 📎 CHOOSE PDF ]                    │
│                                       │
│  Upload receipt                       │
│  [ 📎 CHOOSE PDF ]                    │
│                                       │
│  [ SAVE EXPENSE ]                     │
└────────────────────────────────────┘
```

### 5.7 Bank reconciliation — `/admin/finance/reconcile`

Treasurer downloads bank statement (CSV) from netbanking, uploads to app:

```
┌────────────────────────────────────┐
│  Bank Statement Reconciliation        │
│                                       │
│  Account: HDFC Current Account        │
│  [ Upload statement CSV ]             │
│                                       │
│  Period: Apr 1 – Apr 30, 2026        │
│  Imported: 142 rows                   │
│  Auto-matched: 78 rows                │
│                                       │
│  ─── UNMATCHED CREDITS (38) ───       │
│  ┌─────────────────────────────────┐│
│  │ ₹4,500 — Apr 12                   ││
│  │ "UPI/SHARMA/232145679876"        ││
│  │ Suggested: A-204 April bill       ││
│  │ [ ✓ Match ]  [ Skip ]              ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ ₹13,500 — Apr 15                  ││
│  │ "NEFT/VERMA/IRR202604..."        ││
│  │ Suggested: A-101 (3 bills)        ││
│  │ [ ✓ Match ]  [ Manually pick ]    ││
│  └─────────────────────────────────┘│
│                                       │
│  [ Auto-match remaining ]             │
└────────────────────────────────────┘
```

CSV import logic does fuzzy matching by:
- Amount + flat number in description
- UTR / reference number
- Date proximity to a reported payment

Whatever's left, treasurer matches manually.

---

## 6. Reports

### 6.1 Monthly P&L — `/admin/finance/reports/monthly-pl`

```
┌────────────────────────────────────┐
│  Monthly P&L — April 2026             │
│                                       │
│  COLLECTIONS                          │
│  ─────────────                        │
│  Maintenance        ₹6,75,000        │
│  Water                  ₹80,000      │
│  Sinking Fund          ₹80,000       │
│  Late fees              ₹2,500       │
│  Other                  ₹0            │
│  ─────────────────                    │
│  TOTAL              ₹8,37,500        │
│                                       │
│  EXPENSES                             │
│  ─────────                            │
│  Security           ₹1,80,000        │
│  Housekeeping       ₹1,20,000        │
│  Lift AMC             ₹50,000        │
│  Common Elec          ₹80,000        │
│  Garden               ₹30,000        │
│  Other                ₹60,000        │
│  ─────────────────                    │
│  TOTAL              ₹5,20,000        │
│                                       │
│  ───────────                          │
│  NET SURPLUS        ₹3,17,500 ✅     │
│                                       │
│  [ Export PDF ] [ Export Excel ]     │
└────────────────────────────────────┘
```

### 6.2 Annual report (for AGM)

- 12-month revenue trend chart
- 12-month expense trend chart
- Category-wise expense pie
- Collection rate per month
- Top 10 defaulters (anonymized for AGM)
- Beginning balance + collections − expenses = ending balance

### 6.3 Per-flat ledger

Resident or admin can view a flat's complete history:
- Every bill ever issued
- Every payment ever made
- Running balance
- PDF export for property-sale due-diligence

### 6.4 Vendor report

- Total paid to each vendor across all categories
- Last paid date, payment frequency
- Useful for vendor renegotiation

---

## 7. Notification triggers

All free, using your existing push system:

| Event | Notify | Channel |
|---|---|---|
| Bill cycle published | All residents | Push + bot inbox |
| Payment reported by resident | Treasurer | Push |
| Payment verified by treasurer | Resident | Push |
| Payment rejected by treasurer | Resident | Push (with reason) |
| Bill due in 3 days | Resident with outstanding | Push |
| Bill overdue (after grace) | Resident | Push + bot inbox |
| Expense added (>₹50k) | All admins | Push |
| Expense awaiting approval | Approver admins | Push |
| Bank statement import complete | Uploader | Push |

---

## 8. Backend endpoints

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /api/bills/mine` | Resident | List my bills |
| `GET /api/bills/[id]` | Resident/Admin | Bill detail |
| `GET /api/bills/[id]/pdf` | Resident/Admin | Download bill PDF |
| `POST /api/payments` | Resident | Report a payment |
| `GET /api/payments/mine` | Resident | My payment history |
| `GET /api/payments/[id]/receipt` | Resident/Admin | Receipt PDF (verified only) |
| `GET /api/admin/finance/dashboard` | Admin | Dashboard stats |
| `POST /api/admin/finance/cycles` | Admin | Create bill cycle (draft) |
| `POST /api/admin/finance/cycles/[id]/publish` | Admin | Publish cycle, generate bills |
| `GET /api/admin/finance/payments/pending` | Admin | Verification queue |
| `POST /api/admin/finance/payments/[id]/verify` | Admin | Mark as verified |
| `POST /api/admin/finance/payments/[id]/reject` | Admin | Reject with reason |
| `POST /api/admin/finance/payments/bulk-verify` | Admin | Verify multiple at once |
| `GET /api/admin/finance/defaulters` | Admin | Defaulter list |
| `POST /api/admin/finance/bills/[id]/waive` | Admin | Waive a bill with reason |
| `POST /api/admin/finance/bills/[id]/reminder` | Admin | Send reminder push |
| `GET/POST /api/admin/finance/expenses` | Admin | List/add expenses |
| `GET/POST /api/admin/finance/vendors` | Admin | Vendor CRUD |
| `GET/POST /api/admin/finance/bank-accounts` | Admin | Bank account CRUD |
| `POST /api/admin/finance/bank-statement/upload` | Admin | Upload CSV |
| `POST /api/admin/finance/bank-statement/match` | Admin | Match a bank row to a payment |
| `GET /api/admin/finance/reports/monthly-pl` | Admin | P&L data |
| `GET /api/admin/finance/reports/annual` | Admin | AGM report |
| `POST /api/cron/finance-overdue` | Vercel Cron | Daily — flip pending → overdue |

---

## 9. Effort breakdown

| Task | Effort |
|---|---|
| Database migration + RLS + triggers | 0.5 day |
| Bill cycles + bill generation engine | 1 day |
| Resident bills UI (list, detail, pay-now, report) | 1 day |
| Admin bills UI (issue, list, defaulters, waive) | 1 day |
| Payments — resident report, admin verify, bulk verify | 1 day |
| Expenses — admin CRUD, vendors, file uploads | 1 day |
| Bank statement CSV import + reconciliation UI | 1 day |
| Reports (monthly P&L, defaulter PDF, per-flat ledger) | 1 day |
| Receipt + bill PDF generation | 0.5 day |
| Notifications + cron job | 0.5 day |
| Testing + edge cases | 0.5 day |
| **Total** | **~6–8 days** |

---

## 10. Risks & gotchas

| Risk | Mitigation |
|---|---|
| Resident enters wrong UTR — payment can't be matched | Treasurer rejects with reason; resident re-submits; bank statement is source of truth |
| Resident pays partial, ambiguity which month | Resident picks the bill at report time; system supports partial payments natively |
| Resident pays before bill is issued (advance) | Allow `bill_id = null` payments; treasurer assigns later from queue |
| Treasurer forgets to verify for weeks | Push reminder to treasurer if payments older than 3 days awaiting verification |
| Money paid but resident never reports it | Bank statement reconciliation catches this — auto-match by UTR |
| Resident disputes bill amount | Admin can edit a bill before publish; after publish only via `waiver` (audit trail) |
| Late fee calculation errors | Calculated at bill-generation time, stored as a line item — not recomputed |
| Payment to wrong account (society has multiple) | Each bank account has its own UPI ID/QR; resident sees correct one per bill |
| Treasurer leaves committee mid-year | Audit trail keeps every action with `recorded_by`/`verified_by` |
| Currency precision bugs | All amounts stored in **paise** (integer), converted to ₹ at display time |
| GST handling | Society maintenance is GST-exempt below ₹7,500/month (Indian rule) — no GST logic needed for typical societies. Document this. |
| Bank statement format varies | Support generic CSV with column mapping; pre-built parsers for HDFC, ICICI, SBI |
| Storage cost for invoices/screenshots | Compress images < 200KB; auto-archive PDFs after 7 years (Indian audit retention) |

---

## 11. Decisions to make before building

1. **One bank account or multiple?** (society may have separate maintenance / sinking fund / clubhouse accounts)
2. **GST registration?** Society is exempt below ₹7,500/flat/month — most aren't required. Skip GST features unless needed.
3. **Cheque support priority?** Some old residents still pay by cheque. Recommend supporting it from day 1.
4. **Cash payments?** Recommend support but require treasurer to log them (residents can't self-report cash).
5. **Late fee policy:** Flat ₹100 or 1.5%/month? (1.5%/month is industry standard)
6. **Approval workflow for expenses?** Auto-approve below ₹10,000? Require committee approval above ₹50,000?
7. **Receipt numbering format?** `AE-RCP-2026-04-0001` or `AE/2026-27/0001`?
8. **PDF generation library?** Puppeteer (heavy, slow) vs `pdfmake` (lightweight, no Chromium). **Recommend pdfmake.**
9. **Bank statement format support?** Start with generic CSV; add HDFC/ICICI parsers later as needed.
10. **Show defaulter list publicly or only to admin?** Some societies post it on the notice board (peer pressure works). Recommend admin-only for v1.

---

## 12. Where this fits in the roadmap

This spec replaces the placeholder for **C1 (Maintenance bills & payments)** in `PRODUCT_BACKLOG.md`.

**Original C1 estimate:** 7–10 days + Razorpay setup + ~₹20K/mo fees
**Track-only version:** **6–8 days + ₹0/mo forever**

Suggested timing:
- Build it as **Phase 6** (committee features), 1–2 months after v1 gate management ships
- Or build it as **standalone Phase A** for a separate finance team to use, before/parallel to gate management

---

## 13. Why this is a winning approach

1. **Costs ₹0/month** — society doesn't lose 2% on every payment to Razorpay
2. **Familiar to residents** — they already pay via UPI/PhonePe daily
3. **Familiar to treasurers** — they already cross-check bank statements at month-end
4. **No KYC delays** — start using tomorrow
5. **No chargeback risk** — UPI is push-only
6. **Audit-grade trail** — every action logged with who + when + why
7. **Bank statement is source of truth** — no app/bank discrepancies
8. **Easy to upgrade later** — if society later wants Razorpay, the bill/payment schema already supports it; just add a new payment_method enum value

---

*Last updated: April 2026*
*Status: Specification, ready for implementation*
*Effort: 6–8 days*
*Operating cost: ₹0/month*
