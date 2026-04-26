-- ============================================================
-- 2026-05-07 — Community services directory
--
-- Read-only "yellow pages" of services residents commonly need:
-- watchman duties, ironing rates (per-shirt, per-saree, single
-- path / both paths), car cleaning, car+bike combo, bottled water,
-- carpentry, plumbing, etc.
--
-- Modelled as two tables:
--
--   services       — one row per service (name, category, vendor
--                    contact, optional photo, is_active flag, sort
--                    order). The "card" the resident sees.
--
--   service_rates  — variable-shape rate lines (label + amount +
--                    optional unit/note). One service can have many.
--                    Why a child table instead of fixed columns:
--                    pricing varies wildly (₹10/shirt vs ₹250/visit
--                    vs ₹500/month), and a flat columnset would
--                    either be too narrow (single-rate-only) or too
--                    permissive (mostly-null columns). A list of
--                    {label, paise, unit_label} matches how rates
--                    are actually quoted on a vendor's flyer.
--
-- Visibility: any approved resident can read. Only admins can
-- write. Deleting a service cascades to its rate lines.
--
-- Notes for future iterations:
--   - We don't model a "request a service" flow yet — residents tap
--     the vendor's phone/WhatsApp link and arrange directly. This
--     keeps the MVP shippable in one PR.
--   - We don't model vendor accounts. Vendor is a contact stub
--     (name/phone/whatsapp). Adding accounts later is additive.
--   - rate_paise is stored as integer paise to avoid float drift,
--     matching the rest of the funds/clubhouse pricing model.
-- ============================================================

create table if not exists public.services (
    id uuid primary key default gen_random_uuid(),

    -- Display.
    name        text not null check (length(trim(name)) between 1 and 80),
    -- Free-form category to group cards on the resident page (e.g.
    -- 'Cleaning', 'Laundry', 'Security', 'Repairs'). We deliberately
    -- don't constrain via enum so admins can add categories without
    -- a migration.
    category    text not null check (length(trim(category)) between 1 and 40),
    description text check (description is null or length(description) <= 500),

    -- Vendor contact. All optional individually (a service might
    -- only have a phone, or only a WhatsApp link), but the resident
    -- UI hides the action button for whichever channel is missing.
    vendor_name      text check (vendor_name is null or length(trim(vendor_name)) between 1 and 80),
    vendor_phone     text check (vendor_phone is null or vendor_phone ~ '^[0-9+\-\s()]{6,20}$'),
    vendor_whatsapp  text check (vendor_whatsapp is null or vendor_whatsapp ~ '^[0-9+\-\s()]{6,20}$'),
    vendor_email     text check (vendor_email is null or vendor_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

    -- Optional photo URL (stored in Supabase Storage or external CDN).
    image_url   text,

    -- Lifecycle.
    is_active   boolean not null default true,
    -- Manual sort. Lower = appears first. Admins can drag-reorder
    -- in the future; for now they edit the number directly.
    display_order integer not null default 100,

    -- Audit.
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists services_active_order_idx
    on public.services (is_active, display_order, name);
create index if not exists services_category_idx
    on public.services (category);

create or replace function public.touch_services_updated_at()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists services_touch_updated_at on public.services;
create trigger services_touch_updated_at
    before update on public.services
    for each row execute function public.touch_services_updated_at();

-- ----------------------------------------------------------------
-- service_rates: variable rate lines per service.
-- ----------------------------------------------------------------

create table if not exists public.service_rates (
    id uuid primary key default gen_random_uuid(),
    service_id uuid not null references public.services(id) on delete cascade,

    -- e.g. "Shirt", "Saree", "Single path", "Double path",
    --      "Per visit", "Per car", "Watchman duty (12h)"
    label       text not null check (length(trim(label)) between 1 and 60),

    -- Stored as integer paise to match the funds module. UI converts
    -- to ₹ for display and back to paise on submit. A null value is
    -- allowed for "rate on request" / "negotiable" entries — the UI
    -- shows them as "—" or the note field.
    rate_paise  integer check (rate_paise is null or (rate_paise >= 0 and rate_paise <= 100000000)),

    -- Optional unit qualifier shown after the amount: "/shirt",
    -- "/visit", "/month". Free text so we don't have to enumerate.
    unit_label  text check (unit_label is null or length(unit_label) <= 30),

    -- Optional inline note appended to the line: "(both paths)",
    -- "(min 10 garments)", "(weekly)". Free text.
    note        text check (note is null or length(note) <= 100),

    display_order integer not null default 100,
    created_at  timestamptz not null default now()
);

create index if not exists service_rates_service_idx
    on public.service_rates (service_id, display_order);

-- ----------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------

alter table public.services      enable row level security;
alter table public.service_rates enable row level security;

-- Resident read: any approved resident sees active services.
-- Admins see active + inactive (so they can re-enable).

drop policy if exists "Anyone approved can read active services" on public.services;
create policy "Anyone approved can read active services"
    on public.services for select
    to authenticated
    using (
        is_active = true
        or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin'
        )
    );

drop policy if exists "Anyone approved can read service rates" on public.service_rates;
create policy "Anyone approved can read service rates"
    on public.service_rates for select
    to authenticated
    using (
        -- Match the parent's read policy: visible if the parent
        -- service is itself visible to the caller.
        exists (
            select 1 from public.services s
            where s.id = service_id
              and (
                  s.is_active = true
                  or exists (
                      select 1 from public.profiles p
                      where p.id = auth.uid() and p.role = 'admin'
                  )
              )
        )
    );

-- Admin write: standard "exists profiles where role=admin" pattern,
-- mirroring scheduled_reminders, services-style tables.

drop policy if exists "Admins can manage services" on public.services;
create policy "Admins can manage services"
    on public.services for all
    to authenticated
    using (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
    with check (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    );

drop policy if exists "Admins can manage service rates" on public.service_rates;
create policy "Admins can manage service rates"
    on public.service_rates for all
    to authenticated
    using (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
    with check (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    );

comment on table public.services is
    'Community services directory. Admin-curated cards with vendor contact + variable-shape rate lines (see service_rates).';
comment on table public.service_rates is
    'Per-service rate lines. Each row is one priced item (e.g. "Shirt — ₹10", "Single path — ₹5/garment"). Free-form to accommodate ironing/cleaning/watchman/etc.';

notify pgrst, 'reload schema';
