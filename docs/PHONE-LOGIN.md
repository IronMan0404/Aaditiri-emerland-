# Phone Login (no OTP)

Aaditri Emerland accepts **either an email or a phone number** as the login identifier. Both work the same way: identifier + password. No OTP, no SMS gateway, no Supabase Phone provider needed.

## Why no OTP

Identity is verified by **admin approval**. New residents land in `is_approved = false` until an admin reviews their registration in `/admin/users` (or the Telegram inline approve/reject button). At that point the admin has already confirmed who the person is — an SMS OTP would just add cost (~₹0.20–₹0.50/sms) and DLT-registration friction without strengthening the trust model. Same reasoning we already use for not requiring email verification.

## How it works

| Layer | File |
|---|---|
| Login form | `src/app/auth/login/page.tsx` — single "Email or phone number" field + password |
| Register form | `src/app/auth/register/page.tsx` — email and phone are both shown, at least one is required |
| Server (signup) | `src/app/api/auth/register/route.ts` — accepts either or both, uses service-role admin API to create the user pre-confirmed (no Supabase mailer / SMS), inserts `profiles` with `is_approved=false` |
| Helpers | `src/lib/phone.ts` (E.164 normalization) |
| DB | `profiles_phone_unique_idx` partial unique index (applied by `supabase/migrations/20260508_phone_login.sql` and `supabase/schema.sql`) |
| Auth gating | `src/proxy.ts` (unchanged — keys off `auth.users.id`) |

### Login

1. Resident types either their email *or* phone number, plus password.
2. Client classifies the input (contains `@` → email, otherwise normalize to E.164).
3. Calls `supabase.auth.signInWithPassword({ email | phone, password })` — Supabase looks up the auth user by either identifier and verifies the password.
4. Proxy lets them in if `is_approved=true`, otherwise redirects to `/auth/pending`.

### Signup

1. Resident provides full name + flat + resident type + password + at least one of email/phone.
2. `/api/auth/register` validates everything, then calls `admin.auth.admin.createUser` with whichever identifiers were supplied. Both `email_confirm: true` and `phone_confirm: true` are set so the resident can sign in once an admin approves them — Supabase's own verification step is bypassed because admin approval is our gate.
3. We insert their `profiles` row with `is_approved=false` and synthesize a placeholder `email` if they only gave a phone (the column is NOT NULL; the resident can update it later from their profile page).
4. Welcome email goes out via Brevo only if a real email was provided. Phone-only signups don't get an automated welcome (we'd need an SMS gateway to do it well, and we deliberately said no to that).
5. Admin approval flow runs the same way it always has (push + Telegram inline approve/reject).

## Apply the migration

`supabase/migrations/20260508_phone_login.sql` adds a partial unique index on `profiles.phone` so two residents can't claim the same number. Run it once on production. Fresh installs from `supabase/schema.sql` already include it.

## Cost

Zero. No SMS, no DLT registration, no extra Supabase add-ons.

## Trade-offs we deliberately accepted

- **Phone numbers aren't SMS-verified.** Someone could register with a neighbour's number. They still can't reach `/dashboard` without admin approval, and a duplicate flat or fake name will get rejected at that step. This is the same trust model that's been working fine for email signups since day 1.
- **No "I forgot my phone-only password"** path yet. Forgot-password is still email-only because Supabase's `resetPasswordForEmail` requires an email. Phone-only residents can use the email-add flow on `/dashboard/profile` after admin reaches out, or admins can reset them directly from `/admin/users`.
- **One account per resident.** Email and phone both point at the same `auth.users` row. We don't support having a separate "phone-only" account in addition to an "email-only" account for the same person. If a resident registered with email only, they can add their phone from the profile page later (and vice versa). Until that profile-page wiring is done, an admin can update the missing identifier from Supabase Dashboard → Authentication → Users.
