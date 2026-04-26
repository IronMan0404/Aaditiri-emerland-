-- ============================================================
-- 2026-04-29 — Community phone book / contact directory.
--
-- Curated Yellow-Pages for the society. Two complementary buckets
-- live in the same table, distinguished by `is_society_contact`:
--
--   1. SOCIETY contacts (is_society_contact = true)
--      Admin-curated, pinned: lift AMC, RWA officials, security
--      agency, gas-cylinder vendor, elections officer, etc.
--      Only admins can create / edit / delete these.
--
--   2. RECOMMENDED vendors (is_society_contact = false)
--      Resident-contributed: plumber, maid, milkman, driver, etc.
--      The submitter (and any admin) can edit / delete; everyone
--      else can only "vote helpful" or "report".
--
-- Privileged columns (`is_society_contact`, `is_verified`,
-- `is_archived`) are locked down by a BEFORE INSERT/UPDATE trigger
-- — same pattern we use on `profiles` (see migration
-- 20260428_security_hardening.sql). RLS handles the basic
-- read/write split; the trigger handles column-level enforcement
-- that RLS can't easily express.
-- ============================================================

-- 1) MAIN TABLE -------------------------------------------------
create table if not exists public.directory_contacts (
  id uuid primary key default gen_random_uuid(),

  -- Display fields ---------------------------------------------
  name text not null,
  category text not null check (category in (
    'plumbing', 'electrical', 'carpentry', 'painting', 'pest_control',
    'lift_amc', 'maid', 'cook', 'nanny', 'driver', 'milkman', 'newspaper',
    'gas_cylinder', 'laundry', 'tailor', 'cab_auto', 'doctor', 'hospital',
    'pharmacy', 'police', 'ambulance', 'fire', 'hardware', 'grocery',
    'rwa_official', 'society_office', 'security_agency', 'other'
  )),
  phone text not null,
  alt_phone text,
  whatsapp text,
  notes text,
  area_served text,         -- "Aaditri Emerland", "Tellapur", etc.
  hourly_rate numeric(10, 2), -- optional; nullable

  -- Provenance -------------------------------------------------
  is_society_contact boolean not null default false,
  is_verified boolean not null default false,
  is_archived boolean not null default false,
  submitted_by uuid references public.profiles(id) on delete set null,

  -- Denormalised counters kept in sync by trigger on
  -- public.directory_votes. Cheap to keep accurate, lets the
  -- list view sort by popularity without a per-row aggregate.
  vote_count int not null default 0,
  report_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists directory_contacts_category_idx
  on public.directory_contacts (category)
  where is_archived = false;

create index if not exists directory_contacts_society_idx
  on public.directory_contacts (is_society_contact, is_verified)
  where is_archived = false;

create index if not exists directory_contacts_submitted_by_idx
  on public.directory_contacts (submitted_by)
  where is_archived = false;

-- 2) VOTES TABLE ------------------------------------------------
-- One row per (contact, user, kind). Residents toggle by inserting
-- or deleting a row; the trigger keeps `vote_count` / `report_count`
-- on the parent in sync.
create table if not exists public.directory_votes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.directory_contacts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('helpful', 'reported')),
  created_at timestamptz not null default now(),
  unique(contact_id, user_id, kind)
);

create index if not exists directory_votes_contact_idx
  on public.directory_votes (contact_id);

-- 3) updated_at + counter triggers -----------------------------
create or replace function public.directory_contacts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_directory_contacts_updated_at on public.directory_contacts;
create trigger trg_directory_contacts_updated_at
  before update on public.directory_contacts
  for each row execute procedure public.directory_contacts_set_updated_at();

create or replace function public.directory_votes_sync_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact uuid;
  v_kind text;
  v_delta int;
begin
  if (tg_op = 'INSERT') then
    v_contact := new.contact_id;
    v_kind := new.kind;
    v_delta := 1;
  elsif (tg_op = 'DELETE') then
    v_contact := old.contact_id;
    v_kind := old.kind;
    v_delta := -1;
  else
    -- UPDATE shouldn't happen (we toggle by INSERT/DELETE) but be safe.
    return new;
  end if;

  if v_kind = 'helpful' then
    update public.directory_contacts
       set vote_count = greatest(0, vote_count + v_delta)
     where id = v_contact;
  elsif v_kind = 'reported' then
    update public.directory_contacts
       set report_count = greatest(0, report_count + v_delta)
     where id = v_contact;
  end if;

  if (tg_op = 'DELETE') then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_directory_votes_sync_counters on public.directory_votes;
create trigger trg_directory_votes_sync_counters
  after insert or delete on public.directory_votes
  for each row execute procedure public.directory_votes_sync_counters();

-- 4) Privileged-column lockdown --------------------------------
-- Same pattern as profiles_block_privileged_self_edit — non-admin
-- callers cannot toggle is_society_contact / is_verified /
-- is_archived. They also can't set is_society_contact = true on
-- INSERT (must remain false). Service-role bypasses (auth.uid()
-- is null).
create or replace function public.directory_contacts_block_privileged_self_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_caller_role text;
begin
  v_caller := auth.uid();

  -- Service role / cron path: trust unconditionally.
  if v_caller is null then return new; end if;

  select role into v_caller_role
    from public.profiles
   where id = v_caller;

  if v_caller_role = 'admin' then return new; end if;

  if (tg_op = 'INSERT') then
    if new.is_society_contact then
      raise exception 'permission denied: only admins can create society contacts'
        using errcode = '42501';
    end if;
    if new.is_verified then
      raise exception 'permission denied: only admins can mark contacts as verified'
        using errcode = '42501';
    end if;
    if new.is_archived then
      raise exception 'permission denied: cannot archive on insert'
        using errcode = '42501';
    end if;
    -- Force submitted_by to the caller. We can't trust the client.
    new.submitted_by := v_caller;
    return new;
  end if;

  -- UPDATE: privileged columns must remain unchanged.
  if (new.is_society_contact is distinct from old.is_society_contact) then
    raise exception 'permission denied: cannot change is_society_contact'
      using errcode = '42501';
  end if;
  if (new.is_verified is distinct from old.is_verified) then
    raise exception 'permission denied: cannot change is_verified'
      using errcode = '42501';
  end if;
  if (new.is_archived is distinct from old.is_archived) then
    raise exception 'permission denied: cannot archive contacts'
      using errcode = '42501';
  end if;
  if (new.submitted_by is distinct from old.submitted_by) then
    raise exception 'permission denied: cannot reassign submitted_by'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_directory_contacts_block_privileged_self_edit on public.directory_contacts;
create trigger trg_directory_contacts_block_privileged_self_edit
  before insert or update on public.directory_contacts
  for each row execute procedure public.directory_contacts_block_privileged_self_edit();

-- 5) RLS --------------------------------------------------------
alter table public.directory_contacts enable row level security;
alter table public.directory_votes    enable row level security;

-- SELECT: any approved resident can read non-archived contacts.
-- Admins can see archived ones too (for the reports queue).
drop policy if exists "Approved users can read contacts" on public.directory_contacts;
create policy "Approved users can read contacts"
  on public.directory_contacts for select
  to authenticated
  using (
    (is_archived = false and exists (
      select 1 from public.profiles
       where id = auth.uid() and is_approved = true
    ))
    or exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  );

-- INSERT: approved residents can submit; the trigger forces
-- submitted_by = caller and blocks privileged columns.
drop policy if exists "Approved users can submit contacts" on public.directory_contacts;
create policy "Approved users can submit contacts"
  on public.directory_contacts for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
       where id = auth.uid() and is_approved = true
    )
  );

-- UPDATE: submitter or admin. Trigger blocks privileged columns
-- for non-admins.
drop policy if exists "Submitter or admin can update contacts" on public.directory_contacts;
create policy "Submitter or admin can update contacts"
  on public.directory_contacts for update
  to authenticated
  using (
    auth.uid() = submitted_by
    or exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    auth.uid() = submitted_by
    or exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  );

-- DELETE: admin only. Residents soft-delete by archiving via the
-- admin queue (or just letting it sit).
drop policy if exists "Admin can delete contacts" on public.directory_contacts;
create policy "Admin can delete contacts"
  on public.directory_contacts for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  );

-- VOTES policies ------------------------------------------------
drop policy if exists "Users see their own votes" on public.directory_votes;
create policy "Users see their own votes"
  on public.directory_votes for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Users add their own votes" on public.directory_votes;
create policy "Users add their own votes"
  on public.directory_votes for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
       where id = auth.uid() and is_approved = true
    )
  );

drop policy if exists "Users remove their own votes" on public.directory_votes;
create policy "Users remove their own votes"
  on public.directory_votes for delete
  to authenticated
  using (auth.uid() = user_id);

-- 6) Schema cache reload ---------------------------------------
notify pgrst, 'reload schema';
