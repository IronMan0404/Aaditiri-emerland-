-- ============================================================
-- Phone-based login (additive)
--
-- Goal: allow residents to sign up / sign in by phone number using
-- Supabase's built-in Phone provider, without breaking the existing
-- email-based flow.
--
-- This migration is purely DB-side. The actual Phone provider
-- (and SMS gateway / DLT credentials) is configured in:
--   Supabase Dashboard -> Authentication -> Providers -> Phone
--
-- Until that's enabled, the new login UI degrades gracefully — it
-- shows a "Phone login is not yet configured" notice and the email
-- form continues to work as before.
-- ============================================================

-- 1) profiles.phone is currently `text` with no constraint. To use it
-- as a login identifier we need it to be globally unique (so two
-- residents can't both register with the same number). Approved
-- residents almost always already have a phone number; older legacy
-- rows may have NULL or duplicates from before this rule existed.
-- A *partial* unique index that ignores NULLs lets us turn this on
-- without breaking those legacy rows.
--
-- We don't enforce E.164 format at the DB layer because the
-- application code (src/lib/phone.ts) already normalizes before
-- write, and a CHECK constraint here would make data import scripts
-- needlessly painful. The unique index is the only invariant we
-- actually need.

create unique index if not exists profiles_phone_unique_idx
  on public.profiles (phone)
  where phone is not null;

-- 2) Idempotent backfill: populate auth.users.phone from profiles.phone
-- for every row where the profile has a phone but the auth.users
-- record doesn't. This way an existing email-only user can still log
-- in via phone OTP (Supabase looks up by either identifier).
--
-- We can't run this from a migration because auth.users is owned by
-- Supabase's auth schema and writes there must go through
-- supabase.auth.admin.updateUserById. The application has a
-- one-shot endpoint (POST /api/auth/phone/backfill) admins can run
-- after enabling the Phone provider. See that file for details.

comment on index public.profiles_phone_unique_idx is
  'Phone-as-login-identifier: must be globally unique. Partial index ignores legacy NULLs.';
