-- ============================================================
-- 2026-04-26 — Admin association tags (President, VP, Secretary, ...).
--
-- Purpose: let admins display an "office bearer" badge next to their
-- name across the app (contributions, comments, fund pages, contacts).
-- Tags are PURELY decorative — they do NOT grant or restrict any
-- permissions. The only authorisation gate remains profiles.role.
--
-- Constraint enforced by a CHECK + trigger pair: only profiles whose
-- role = 'admin' can be tagged. Demoting an admin to resident
-- automatically removes their tags.
-- ============================================================

-- 1) Lookup table -----------------------------------------------
create table if not exists public.admin_tags (
  id uuid primary key default gen_random_uuid(),
  -- short stable code used internally / in URLs (lowercase, snake_case)
  code text not null unique,
  -- human label shown on badges
  label text not null,
  -- short description for the manage-tags admin UI
  description text,
  -- hex colour used to colour the badge in the UI
  -- (defaults to a neutral charcoal so a missing colour still looks fine)
  color text not null default '#374151',
  -- emoji or short unicode glyph shown on the badge (optional)
  icon text,
  -- ordering on dropdowns / lists
  display_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists admin_tags_active_idx on public.admin_tags (is_active, display_order);

-- 2) Join table -------------------------------------------------
-- profile_admin_tags links a profile to one or more tags. The
-- composite PK prevents accidentally double-assigning the same tag.
create table if not exists public.profile_admin_tags (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tag_id uuid not null references public.admin_tags(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (profile_id, tag_id)
);

create index if not exists profile_admin_tags_profile_idx on public.profile_admin_tags (profile_id);
create index if not exists profile_admin_tags_tag_idx on public.profile_admin_tags (tag_id);

-- 3) Constraint trigger: only admins can be tagged --------------
-- A row in profile_admin_tags must reference a profile whose role is
-- 'admin'. We enforce this in a BEFORE INSERT/UPDATE trigger because
-- a CHECK on the join table can't see profiles.role.
create or replace function public.assert_profile_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  -- Validate by COUNT instead of SELECT INTO. SELECT INTO inside plpgsql
  -- can be ambiguous with the SQL-level SELECT INTO (which creates a
  -- table) when the function body is parsed in some Supabase contexts;
  -- using a perform / count-based check sidesteps the ambiguity entirely.
  if not exists (
    select 1 from public.profiles
    where id = new.profile_id and role = 'admin'
  ) then
    raise exception 'Association tags can only be assigned to profiles with role = admin (profile_id: %)', new.profile_id
      using errcode = '23514';
  end if;
  return new;
end;
$func$;

drop trigger if exists profile_admin_tags_only_admin on public.profile_admin_tags;
create trigger profile_admin_tags_only_admin
  before insert or update on public.profile_admin_tags
  for each row execute function public.assert_profile_is_admin();

-- 4) Cascade trigger: demoting an admin clears their tags -------
-- When profiles.role flips away from 'admin', wipe all their tag
-- assignments. Otherwise they'd silently keep a "Treasurer" badge
-- after losing admin powers, which would mislead other residents.
create or replace function public.clear_tags_on_admin_demote()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if old.role = 'admin' and new.role <> 'admin' then
    delete from public.profile_admin_tags where profile_id = new.id;
  end if;
  return new;
end;
$func$;

drop trigger if exists profiles_clear_tags_on_demote on public.profiles;
create trigger profiles_clear_tags_on_demote
  after update of role on public.profiles
  for each row execute function public.clear_tags_on_admin_demote();

-- 5) RLS --------------------------------------------------------
-- admin_tags: everyone (authenticated) reads, only admins write.
-- profile_admin_tags: everyone reads (so badges can render anywhere
-- in the app), only admins write.
alter table public.admin_tags enable row level security;
alter table public.profile_admin_tags enable row level security;

drop policy if exists admin_tags_select on public.admin_tags;
create policy admin_tags_select on public.admin_tags
  for select to authenticated using (true);

drop policy if exists admin_tags_admin_write on public.admin_tags;
create policy admin_tags_admin_write on public.admin_tags
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists profile_admin_tags_select on public.profile_admin_tags;
create policy profile_admin_tags_select on public.profile_admin_tags
  for select to authenticated using (true);

drop policy if exists profile_admin_tags_admin_write on public.profile_admin_tags;
create policy profile_admin_tags_admin_write on public.profile_admin_tags
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 6) Convenience view: profile_id -> aggregated tag list --------
-- Lets the app render badges with a single SELECT per page rather
-- than N+1 queries. Aggregated as JSON so we can ship the label,
-- colour, icon and code together.
-- security_invoker = true: Postgres 15+ / Supabase recommendation. Forces
-- the view to apply RLS using the CALLING user's permissions instead of
-- the view owner's. We *want* every authenticated user to read this
-- view (so badges render anywhere) and the underlying RLS policies on
-- profile_admin_tags / admin_tags already grant SELECT to authenticated,
-- so this is a no-op behaviourally but silences the Supabase linter
-- "view is defined with security definer" warning.
create or replace view public.v_admin_tags_by_profile
with (security_invoker = true) as
select
  pat.profile_id,
  jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'code', t.code,
      'label', t.label,
      'color', t.color,
      'icon', t.icon
    )
    order by t.display_order, t.label
  ) as tags
from public.profile_admin_tags pat
join public.admin_tags t on t.id = pat.tag_id and t.is_active = true
group by pat.profile_id;

grant select on public.v_admin_tags_by_profile to authenticated;

-- 7) Seed the default office-bearer tags ------------------------
insert into public.admin_tags (code, label, description, color, icon, display_order)
values
  ('president',      'President',      'Society President',      '#7C2D12', '👑', 10),
  ('vice_president', 'Vice President', 'Society Vice President', '#9A3412', '🥈', 20),
  ('secretary',      'Secretary',      'Society Secretary',      '#1E3A8A', '📝', 30),
  ('treasurer',      'Treasurer',      'Society Treasurer',      '#065F46', '💰', 40)
on conflict (code) do nothing;
