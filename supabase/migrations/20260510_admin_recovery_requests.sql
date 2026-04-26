-- ============================================================
-- Admin-mediated password recovery
--
-- Closes the gap for residents who signed up phone-only and have
-- neither a working email nor a paired Telegram chat. Without this
-- they hit a "contact admin" dead-end on /auth/forgot-password.
--
-- Flow (also documented in src/app/api/auth/forgot-password/admin-recover/):
--   1. Resident submits a request from /auth/forgot-password ->
--      a row lands here with status='pending', a fingerprint of
--      the request (UA + accept-language hash), and an optional
--      contact_note typed by the resident.
--   2. notify('admin_recovery_requested', ...) fans out to all
--      admins (push + Telegram).
--   3. Admin opens /admin/users, sees the "Recovery requests"
--      panel, taps "Verify & reset". The admin verifies the
--      person out-of-band (call, see in person — small society)
--      and clicks Confirm.
--   4. The /resolve endpoint:
--        - generates a strong temp password,
--        - calls auth.admin.updateUserById to set it,
--        - flips this row to status='resolved',
--        - writes an admin_audit_log row,
--        - returns the temp password to the admin's screen
--          ONCE so they can read it to the resident.
--   5. notify('admin_recovery_resolved', ...) DMs/pushes the
--      resident: "Your password has been reset by admin <name>.
--      Sign in and change it from your profile."
--
-- Why "one pending request per profile":
--   A resident who taps Submit twice should not generate two
--   admin DMs. The partial unique index below collapses
--   duplicates while still allowing fresh requests AFTER the
--   previous one is resolved/cancelled/expired.
--
-- Why a separate table instead of reusing password_reset_otps:
--   That table assumes the resident has SOME side channel
--   (Telegram or email) and stores hashed proofs of "the right
--   person typed the right code". This table is exactly the
--   opposite: the resident has NO side channel; admin acts as
--   the human OTP. Mixing them would muddy the security model
--   and make audit queries harder.
-- ============================================================

create table if not exists public.admin_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- 'pending'  - awaiting an admin
  -- 'resolved' - admin reset password (one-shot terminal state)
  -- 'cancelled' - admin dismissed the request without reset
  -- 'expired' - auto-expired after 7 days (cron-tidied)
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'cancelled', 'expired')),

  -- Free-form note from the resident: "I'm at flat 413, call 9876…
  -- after 7pm". Bounded so a hostile client can't post a novel.
  contact_note text check (contact_note is null or length(contact_note) <= 500),

  -- UA + accept-language hash captured server-side. Useful for
  -- forensics ("the same device that submitted this is the one
  -- that's now logging in") without storing the raw IP.
  request_fingerprint text,

  -- Captured at submit so the panel can show "submitted from
  -- 122.171.x.y" for the admin's eyeball check before resetting.
  -- Stored as text not inet so we can store the truncated
  -- "122.171.x.x" form. Kept separate from request_fingerprint
  -- on purpose: admins occasionally need to see the IP in
  -- isolation, and we don't want the fingerprint to be a
  -- decodable proxy for it.
  request_ip text,

  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  -- Free-form note from the admin: "Verified by phone, 6:30pm".
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Status index — the admin panel filters to status='pending'
-- nearly all the time, and the cron sweep wants to find rows
-- older than 7 days that are still pending.
create index if not exists admin_recovery_requests_status_created_idx
  on public.admin_recovery_requests (status, created_at desc);

-- One pending request per profile. We deliberately scope the
-- partial index to status='pending' so once it's resolved or
-- cancelled, the resident can request again later. The PK is
-- still the row id, so audit queries see every historical row.
create unique index if not exists admin_recovery_requests_one_pending_per_profile
  on public.admin_recovery_requests (profile_id)
  where status = 'pending';

-- updated_at maintenance.
create or replace function public.admin_recovery_requests_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_admin_recovery_requests_updated_at on public.admin_recovery_requests;
create trigger trg_admin_recovery_requests_updated_at
  before update on public.admin_recovery_requests
  for each row execute function public.admin_recovery_requests_touch_updated_at();

-- ============================================================
-- RLS
--
-- Strategy: identical to password_reset_otps — deny everything
-- via PostgREST. The only writers/readers are server routes
-- holding the service-role key:
--   * /api/auth/forgot-password/admin-recover (insert)
--   * /api/admin/recovery-requests (select, list)
--   * /api/admin/recovery-requests/[id]/resolve (update)
-- Residents have no business reading this table directly — the
-- one piece of state they care about ("did anyone reset me yet?")
-- is communicated via the notify() dispatcher when the admin
-- resolves the request. Admins, similarly, see this table only
-- through their server-validated admin route.
-- ============================================================
alter table public.admin_recovery_requests enable row level security;

-- Defensive drop in case a partial migration ran before. Keeps
-- the migration idempotent for ad-hoc reruns.
drop policy if exists "deny all reads on admin_recovery_requests" on public.admin_recovery_requests;
drop policy if exists "deny all writes on admin_recovery_requests" on public.admin_recovery_requests;

create policy "deny all reads on admin_recovery_requests"
  on public.admin_recovery_requests for select
  using (false);

create policy "deny all writes on admin_recovery_requests"
  on public.admin_recovery_requests for all
  using (false)
  with check (false);
