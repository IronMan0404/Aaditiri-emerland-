-- ============================================================
-- 2026-04-22 - Admin audit log.
--
-- Append-only journal of every privileged write performed by an
-- admin (delete / modify of subscriptions, bookings, users,
-- issues, ...). The log is the source of truth for "who changed
-- what and when" reviews and helps reconstruct the prior value
-- of a row that has since been hard-deleted.
--
-- Design constraints:
--   * Append-only. Even admins cannot UPDATE or DELETE rows.
--     The table is wiped only by superuser SQL (e.g. retention
--     job run via Supabase service role outside of the app).
--   * Snapshot before/after as JSONB so we don't depend on the
--     target table's schema being stable over time.
--   * Actor is FK'd with ON DELETE SET NULL so removing an
--     admin user doesn't shred their historical audit trail.
--   * Target row id is plain text (UUIDs or composite keys both
--     fit) - we don't FK it because we want the log to survive
--     the row being deleted.
-- ============================================================

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Who acted. NULL only after the admin's profile is removed.
  actor_id uuid references public.profiles(id) on delete set null,
  -- Snapshot of the actor at time of action so the log is still
  -- readable after a profile is renamed / demoted / deleted.
  actor_email text,
  actor_name  text,
  -- Verb: 'delete' | 'update' | 'create'. Plain text instead of
  -- an enum so adding new verbs (e.g. 'restore') doesn't need a
  -- migration.
  action text not null check (action in ('create', 'update', 'delete')),
  -- The kind of row being changed: 'clubhouse_subscription',
  -- 'booking', 'profile', 'issue', etc.
  target_type text not null,
  -- The row's primary key, stringified. UUID for most tables.
  target_id text not null,
  -- Optional human-readable label so list views don't have to
  -- join back to the (possibly deleted) target row.
  target_label text,
  -- Optional reason supplied by the admin in the UI.
  reason text,
  -- Snapshots. `before` is NULL for creates, `after` is NULL for
  -- deletes. Using jsonb so we can index/query specific fields
  -- later if needed.
  before jsonb,
  after  jsonb,
  -- Best-effort request metadata for forensic correlation.
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id, created_at desc);
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

-- ------------------------------------------------------------
-- Row-level security: only admins may read, NO ONE may insert /
-- update / delete via the RLS path. Inserts happen exclusively
-- through the service-role client used by `logAdminAction()` so
-- a compromised admin session cannot forge or wipe entries.
-- ------------------------------------------------------------
alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_log_select on public.admin_audit_log;
create policy admin_audit_log_select on public.admin_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Deliberately no INSERT / UPDATE / DELETE policies. Without
-- a policy, RLS denies the operation for non-superuser roles.
-- Service-role bypasses RLS so `logAdminAction()` can still
-- write.
