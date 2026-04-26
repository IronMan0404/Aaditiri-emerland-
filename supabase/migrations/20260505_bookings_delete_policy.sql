-- ============================================================
-- 2026-05-05 — Bookings DELETE policy (admin-only hard-delete)
--
-- Why this exists
-- ---------------
-- public.bookings had RLS enabled with SELECT, INSERT, and UPDATE
-- policies but NO `for delete` policy. With RLS on, a missing
-- DELETE policy means every delete silently affects 0 rows AND
-- returns no error from PostgREST. The /api/admin/bookings/[id]/delete
-- route saw `error: null`, returned `{ ok: true }`, the UI showed
-- "Booking deleted", and the row stayed in the table. Admins ended
-- up writing audit-log entries for "deleted" rows that are still
-- there.
--
-- Policy
-- ------
-- Only admins can delete bookings. Residents must continue to use
-- the existing UPDATE-to-status='cancelled' path — that's the only
-- way they can "remove" a booking, and it preserves the audit trail.
--
-- Idempotent so re-running the file is safe.
-- ============================================================

drop policy if exists "Only admins can delete bookings" on public.bookings;

create policy "Only admins can delete bookings"
  on public.bookings for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

notify pgrst, 'reload schema';
