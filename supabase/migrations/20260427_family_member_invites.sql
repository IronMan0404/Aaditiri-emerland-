-- ============================================================
-- 2026-04-27 — Family member invitations.
--
-- Lets a flat owner / tenant invite their spouse, parents, kids, etc.
-- The invitee:
--   * receives a one-shot magic link by email
--   * sets their own password
--   * is pre-approved (no admin gate) because the inviter has already
--     vouched for them with their own approved account
--   * is mapped to the inviter's flat_number and inviter_id so admin
--     views can group + filter them
--   * gets near-full resident capabilities — can approve their own
--     gate entries, log fund payments, book amenities, comment, etc.
--   * does NOT count toward the "total approved residents" stat,
--     because each flat may have several family members but should
--     only count as ONE household.
--
-- Design choices:
--   1. Re-use public.profiles instead of a parallel table. Every
--      authenticated user in the app already has a profiles row;
--      a second table would force every existing query to UNION two
--      sources. We add three columns:
--        - resident_type text — extends the existing CHECK to allow
--          'family' alongside 'owner' / 'tenant'.
--        - inviter_id uuid   — points back to the profiles.id of
--          whoever invited this family member. NULL for owners /
--          tenants. ON DELETE SET NULL so we keep the family member
--          alive if their inviter is removed (admin can reassign).
--        - family_relation text — 'spouse' | 'son' | ... for display.
--   2. New table public.family_invitations holds pending invites
--      until the family member clicks the link. Token is opaque, never
--      reused. Hash stored in DB; raw token only in the email link.
--   3. RLS: an invitation can be created/listed/revoked by the inviter
--      (owner of inviter_id), or by any other approved owner/tenant of
--      the SAME flat (so spouses can manage each other's invites).
--      Admins can do anything.
-- ============================================================

-- 1) Extend resident_type CHECK to include 'family' --------------
-- Idempotent: drop the existing constraint (created in schema.sql) if
-- present, then re-add with the wider whitelist.
do $cs$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'profiles_resident_type_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles drop constraint profiles_resident_type_check;
  end if;
  alter table public.profiles
    add constraint profiles_resident_type_check
    check (resident_type is null or resident_type in ('owner', 'tenant', 'family'));
end
$cs$;

-- The public.profiles `resident_type` column already has the OLD
-- check baked in via schema.sql lines 15-16. Drop that one too if it
-- exists under a different name (Postgres often auto-names checks
-- with a numeric suffix).
do $cs$
declare
  cname text;
begin
  for cname in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%resident_type%'
      and conname <> 'profiles_resident_type_check'
  loop
    execute format('alter table public.profiles drop constraint %I', cname);
  end loop;
end
$cs$;

-- 2) Add inviter_id + family_relation to profiles ---------------
alter table public.profiles
  add column if not exists inviter_id uuid references public.profiles(id) on delete set null;

alter table public.profiles
  add column if not exists family_relation text;

-- Soft check for the relation column. NULL is fine (most rows will
-- have NULL; only family members carry a relation).
do $cs$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_family_relation_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_family_relation_check
      check (family_relation is null or family_relation in (
        'spouse', 'son', 'daughter', 'parent', 'sibling', 'in_law', 'other'
      ));
  end if;
end
$cs$;

create index if not exists profiles_inviter_idx on public.profiles (inviter_id) where inviter_id is not null;
create index if not exists profiles_family_idx on public.profiles (flat_number) where resident_type = 'family';

-- 3) family_invitations table -----------------------------------
create table if not exists public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  -- Who is doing the inviting (must be an approved owner / tenant).
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  -- Snapshotted at invite time so the invitee lands on the right flat
  -- even if the inviter later changes flats. Belt + braces.
  flat_number text not null,
  -- Email the invite was sent to. Lowercased + trimmed.
  invitee_email text not null,
  -- Display name typed by the inviter (e.g. "Priya Sharma").
  invitee_name text not null,
  -- Relationship — same whitelist as profiles.family_relation.
  relation text not null check (relation in (
    'spouse', 'son', 'daughter', 'parent', 'sibling', 'in_law', 'other'
  )),
  -- Optional message the inviter wants the invitee to see.
  message text,
  -- We store ONLY a SHA-256 hash of the token. The raw token is
  -- emailed once and then forgotten. This way a database leak doesn't
  -- expose live invite links.
  token_hash text not null unique,
  -- Lifecycle:
  --   pending  — link still valid
  --   accepted — invitee clicked link & set password (links to accepted_profile_id)
  --   revoked  — inviter cancelled before acceptance
  --   expired  — past expires_at, kept for audit
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_profile_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists family_invitations_inviter_idx on public.family_invitations (inviter_id);
create index if not exists family_invitations_flat_idx on public.family_invitations (flat_number);
create index if not exists family_invitations_status_idx on public.family_invitations (status, expires_at);
-- Partial unique: only one OUTSTANDING invite per (flat, email). Once
-- the invite is accepted/revoked/expired the constraint releases so
-- the same email can be re-invited if needed.
create unique index if not exists family_invitations_one_pending_per_email
  on public.family_invitations (flat_number, lower(invitee_email))
  where status = 'pending';

-- 4) Helper: same flat? -----------------------------------------
-- Used by RLS policies. Returns true when the requesting user shares
-- the flat with the target_user. Defined STABLE so the planner can
-- inline + cache it within a query.
create or replace function public.users_share_flat(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1
    from public.profiles me, public.profiles them
    where me.id = auth.uid()
      and them.id = target_user
      and me.flat_number is not null
      and me.flat_number = them.flat_number
  );
$func$;

-- 5) RLS for family_invitations ---------------------------------
alter table public.family_invitations enable row level security;

-- Read: inviter, anyone sharing the flat (so spouses can see each
-- other's pending invites), and admins. Family members do NOT need
-- read access — they only ever interact with the row through the
-- accept endpoint, which uses the service-role client.
drop policy if exists family_invitations_select on public.family_invitations;
create policy family_invitations_select on public.family_invitations
  for select to authenticated using (
    inviter_id = auth.uid()
    or public.users_share_flat(inviter_id)
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Insert: only an approved owner/tenant for THEIR own flat. We
-- enforce inviter_id = auth.uid() so a malicious resident cannot
-- create invites under someone else's name.
drop policy if exists family_invitations_insert on public.family_invitations;
create policy family_invitations_insert on public.family_invitations
  for insert to authenticated with check (
    inviter_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_approved = true
        and p.resident_type in ('owner', 'tenant')
        and p.flat_number = family_invitations.flat_number
    )
  );

-- Update (revoke): inviter, same-flat residents, or admins.
drop policy if exists family_invitations_update on public.family_invitations;
create policy family_invitations_update on public.family_invitations
  for update to authenticated using (
    inviter_id = auth.uid()
    or public.users_share_flat(inviter_id)
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Delete: kept admin-only. Day-to-day cancellation should set
-- status='revoked' (UPDATE) so the audit trail survives.
drop policy if exists family_invitations_delete on public.family_invitations;
create policy family_invitations_delete on public.family_invitations
  for delete to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- 6) View: residents_household ----------------------------------
-- Convenience aggregate: for each flat, list the primary resident(s)
-- AND the family members under them. Used by /admin/users to render
-- the "Family" section without N+1 queries.
create or replace view public.v_household_members
with (security_invoker = true) as
select
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.flat_number,
  p.resident_type,
  p.role,
  p.is_approved,
  p.created_at,
  p.inviter_id,
  p.family_relation,
  inv.full_name as inviter_name
from public.profiles p
left join public.profiles inv on inv.id = p.inviter_id;

grant select on public.v_household_members to authenticated;

-- 7) Backfill: nothing to do. New columns default to NULL on existing
--    rows; existing owners/tenants already have resident_type set.

-- 8) Tie family_invitations + family_members + profiles together ----
--
-- Background: the app already has public.family_members — a display-
-- only roster table populated during registration ("my wife, my son,
-- my parents"). It has NO auth account; it just powers the profile
-- page and the gate-entry "who lives in 413?" lookup.
--
-- The invitation flow we built above creates a SEPARATE profiles row
-- with resident_type='family'. To avoid two parallel sources of
-- truth, we link them:
--
--   * family_members.account_profile_id  → profiles.id of the linked
--     account once an invite is accepted. NULL = display-only.
--   * family_members.invitation_id       → family_invitations.id of
--     the most recent OUTSTANDING invite. Lets the UI render
--     "Pending invite" / "Resend" / "Revoke" inline on the existing
--     family editor row, without a join.
--   * family_members.email                → captured at invite time
--     (or earlier, if the resident wants to pre-fill it). Optional;
--     only required when an invite is being sent.
--
-- All three are nullable to keep existing rows untouched. We add ON
-- DELETE SET NULL on both FKs so deleting the linked profile or
-- invitation cleanly clears the pointer without dropping the display
-- row (residents still want to see "spouse: Priya" in the roster
-- after access is revoked).

alter table public.family_members
  add column if not exists account_profile_id uuid references public.profiles(id) on delete set null;

alter table public.family_members
  add column if not exists invitation_id uuid references public.family_invitations(id) on delete set null;

alter table public.family_members
  add column if not exists email text;

create index if not exists family_members_account_idx
  on public.family_members (account_profile_id) where account_profile_id is not null;
create index if not exists family_members_invitation_idx
  on public.family_members (invitation_id) where invitation_id is not null;

-- A given email can only be linked to one family_members row at a
-- time (across the whole table). Otherwise an invite acceptance might
-- attach to the wrong row. Lower-cased to dodge case mismatches.
create unique index if not exists family_members_email_unique
  on public.family_members (lower(email)) where email is not null;

-- 9) Tightened RLS for family_members ---------------------------
-- The existing RLS on family_members (created in schema.sql) is
-- "owner of user_id can do anything; nobody else can read". That's
-- fine for display-only rows but blocks the new flow where a tenant
-- spouse should be able to invite/manage family attached to the
-- OTHER primary resident on the same flat.
--
-- We replace SELECT/INSERT/UPDATE/DELETE policies with same-flat
-- aware versions. Admins keep blanket access for cleanup.
alter table public.family_members enable row level security;

-- Drop any existing policies (named or generated). We use a DO block
-- because schema.sql may have created them under conventional names.
do $cs$
declare r record;
begin
  for r in
    select polname from pg_policy
    where polrelid = 'public.family_members'::regclass
  loop
    execute format('drop policy %I on public.family_members', r.polname);
  end loop;
end
$cs$;

create policy family_members_select on public.family_members
  for select to authenticated using (
    user_id = auth.uid()
    or public.users_share_flat(user_id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy family_members_insert on public.family_members
  for insert to authenticated with check (
    -- The user_id field has to point to an approved owner/tenant on
    -- the SAME flat as the caller. Lets a spouse add family to the
    -- other primary resident's roster, but stops a stranger from
    -- attaching family rows to someone else's profile.
    exists (
      select 1 from public.profiles target, public.profiles me
      where target.id = family_members.user_id
        and me.id = auth.uid()
        and me.is_approved = true
        and me.resident_type in ('owner', 'tenant')
        and target.flat_number is not null
        and target.flat_number = me.flat_number
        and target.resident_type in ('owner', 'tenant')
    )
  );

create policy family_members_update on public.family_members
  for update to authenticated using (
    user_id = auth.uid()
    or public.users_share_flat(user_id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy family_members_delete on public.family_members
  for delete to authenticated using (
    user_id = auth.uid()
    or public.users_share_flat(user_id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
