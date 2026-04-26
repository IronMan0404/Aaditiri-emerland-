-- ============================================================
-- Password reset via Telegram OTP
--
-- Goal: let residents who paired the Telegram bot recover their
-- password by receiving a 6-digit code in their private DM with
-- the bot, instead of (or in addition to) the email reset link.
--
-- Why a separate table instead of reusing telegram_pairings:
--   - telegram_pairings is short-lived state for "wire up this
--     account to my chat", and is cleared the moment pairing
--     completes. Reset OTPs need a longer lifecycle (issued ->
--     verified -> consumed) and a hashed-only column so a leaked
--     DB snapshot can't be replayed against the reset endpoint.
--   - We also need to track verify-attempts per OTP to defeat
--     brute-force without globally locking the user out.
--
-- Security notes:
--   - We store ONLY a SHA-256 hash of (otp || pepper). The pepper
--     comes from TELEGRAM_BOT_TOKEN at runtime — it never leaves
--     the process. A DB dump alone is therefore not enough to
--     forge a code. (We can rotate to a dedicated env var later
--     if we ever add a non-Telegram OTP channel; the migration
--     doesn't have to change.)
--   - RLS is "deny everything from PostgREST". The only writers
--     and readers are server routes using the service-role key.
--     This is intentional: the issue / verify / consume flow has
--     to bypass RLS by design, and we don't want any client to
--     ever read from this table.
--   - No `user_id` UNIQUE here — a user might legitimately request
--     a second OTP if the first one didn't arrive. We instead cap
--     active OTPs per user via the API layer's rate limiter.
-- ============================================================

create table if not exists public.password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- Hash, never the plaintext OTP. SHA-256 hex (64 chars).
  otp_hash text not null,

  -- 'telegram' for now; leaving room for 'sms' or 'voice' later
  -- without another schema change.
  channel text not null default 'telegram',

  -- TTL anchor + book-keeping.
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,

  -- Counter for /verify attempts. We hard-cap at 5; the API
  -- short-circuits before incrementing past that.
  attempts smallint not null default 0,

  -- Bind the OTP to the request shape so it can't be replayed by
  -- a different IP halfway round the world. Stored hashed too so
  -- a DB dump doesn't reveal residents' IPs.
  request_fingerprint text,

  constraint password_reset_otps_channel_check
    check (channel in ('telegram', 'email')),
  constraint password_reset_otps_attempts_check
    check (attempts >= 0 and attempts <= 10)
);

create index if not exists idx_password_reset_otps_profile
  on public.password_reset_otps (profile_id, issued_at desc);

create index if not exists idx_password_reset_otps_active
  on public.password_reset_otps (expires_at)
  where consumed_at is null;

alter table public.password_reset_otps enable row level security;

-- Deny-all RLS: server routes use the service-role key, which
-- bypasses RLS. Clients can never read or write this table
-- directly even if their JWT leaks.
drop policy if exists "deny all client reads" on public.password_reset_otps;
create policy "deny all client reads"
  on public.password_reset_otps
  for select
  using (false);

drop policy if exists "deny all client writes" on public.password_reset_otps;
create policy "deny all client writes"
  on public.password_reset_otps
  for all
  using (false)
  with check (false);

comment on table public.password_reset_otps is
  'Server-only table holding hashed 6-digit codes for the Telegram-DM password reset flow. RLS is deny-all by design.';
