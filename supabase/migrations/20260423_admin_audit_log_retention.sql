-- ============================================================
-- 2026-04-23 - Admin audit log retention + keyset index.

-- Composite index that lets the /admin/audit page paginate by
-- (created_at desc, id desc) without a sequential scan. Replaces
-- the single-column index from 20260422 because Postgres can use
-- this one for both "newest first" listing AND the keyset cursor
-- comparison.
create index if not exists admin_audit_log_keyset_idx
  on public.admin_audit_log (created_at desc, id desc);
drop index if exists public.admin_audit_log_created_idx;

--
-- Bounds the size of admin_audit_log so it doesn't grow forever
-- and slowly eat the Supabase project's storage quota. Keeps
-- the most recent 365 days of activity (more than enough for
-- "who deleted that booking last quarter?" investigations) and
-- aggressively drops anything older.
--
-- We schedule the prune via pg_cron when available. If your
-- Supabase project doesn't have pg_cron enabled, the function
-- still exists and you can call it manually from the SQL editor:
--
--     select public.prune_admin_audit_log();
--
-- The function reports how many rows it removed.
-- ============================================================

-- Retention window function. Returning bigint so callers can log
-- the number of pruned rows.
create or replace function public.prune_admin_audit_log(
  retention_days integer default 365
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pruned bigint;
begin
  if retention_days is null or retention_days < 1 then
    raise exception 'retention_days must be >= 1';
  end if;

  delete from public.admin_audit_log
   where created_at < now() - (retention_days || ' days')::interval;

  get diagnostics pruned = row_count;
  return pruned;
end;
$$;

-- Lock the function down. Even though it's `security definer`, only
-- the service role / postgres should be able to invoke it - we don't
-- want a regular admin nuking history through the REST surface.
revoke all on function public.prune_admin_audit_log(integer) from public;
revoke all on function public.prune_admin_audit_log(integer) from authenticated;
revoke all on function public.prune_admin_audit_log(integer) from anon;

-- Schedule daily at 03:30 UTC if pg_cron is installed in this
-- project. The DO block makes the migration safe to run on
-- environments where pg_cron is unavailable (Supabase Free has it
-- but it needs to be enabled in Database -> Extensions).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Replace the schedule if it already exists so re-running the
    -- migration is idempotent.
    perform cron.unschedule('admin-audit-log-prune')
      where exists (
        select 1 from cron.job where jobname = 'admin-audit-log-prune'
      );
    perform cron.schedule(
      'admin-audit-log-prune',
      '30 3 * * *',
      $cron$ select public.prune_admin_audit_log(365); $cron$
    );
  else
    raise notice
      'pg_cron extension not found. To auto-prune admin_audit_log, enable pg_cron '
      'in Supabase Dashboard -> Database -> Extensions and re-run this migration. '
      'Until then, run "select public.prune_admin_audit_log();" manually as needed.';
  end if;
end
$$;

notify pgrst, 'reload schema';
