# Aaditri Emerland — Complete Deployment Guide

## Overview

| Layer    | Tech |
|----------|------|
| Frontend | **Next.js 16.2.4** (App Router, Turbopack dev) + **React 19.2.4** + **TypeScript 5** + **Tailwind CSS 4** |
| Backend  | **Supabase** (free tier) — Auth, Postgres, Storage, Row Level Security, Realtime |
| Supabase clients | `@supabase/ssr@^0.10.2`, `@supabase/supabase-js@^2.103.3` |
| PWA      | `next-pwa@^5.6.0`, manifest + icons |
| Hosting  | **Vercel** (free tier) |
| Icons    | `lucide-react@^1.8.0` |
| Toasts   | `react-hot-toast@^2.6.0` |
| Dates    | `date-fns@^4.1.0` |

---

## STEP 1 — Create Supabase Project (Free)

1. Go to https://supabase.com → **Start your project** → sign up (free).
2. Click **New project**:
   - Name: `aaditri-emerland`
   - Database Password: choose a strong password (save it)
   - Region: `South Asia (Mumbai)` (ap-south-1) — closest to India
3. Wait ~2 minutes for the project to be ready.

### 1a. Get Your API Keys

Dashboard → **Project Settings** → **API**:
- Copy **Project URL** (e.g. `https://abcdefgh.supabase.co`)
- Copy either:
  - **anon / public** key (legacy, starts with `eyJ...`), OR
  - **Publishable key** (new scheme, starts with `sb_publishable_...`)

The app accepts either — it reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` first, then falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 1b. Run the Database Schema

- Dashboard → **SQL Editor** → **New Query**
- Paste the full contents of `supabase/schema.sql`
- Click **Run** — you should see "Success. No rows returned".

This creates tables (`profiles`, `announcements`, `events`, `event_rsvps`, `bookings`, `broadcasts`, `photos`, `updates`), RLS policies, and storage buckets.

### 1c. Promote Your First Admin

After your admin user registers through the app, in **SQL Editor** run:
```sql
UPDATE public.profiles
SET role = 'admin', is_approved = true
WHERE email = 'your-admin@email.com';
```
Sign out and sign back in so the new role takes effect.

### 1d. Configure Auth URLs

Dashboard → **Authentication** → **URL Configuration**:
- **Site URL**: your Vercel URL (set this after Step 2)
- **Redirect URLs**: `https://your-app.vercel.app/**`

### 1e. (Optional) Disable Email Confirmation

Dashboard → **Authentication** → **Settings** → toggle off "Enable email confirmations" for easier onboarding.

---

## STEP 2 — Deploy to Vercel (Free)

### 2a. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit — Aaditri Emerland community app"
```

1. github.com → **New repository** → name it `aaditri-emerland-web` (private recommended)
2. Run the `git remote add` + `git push -u origin main` commands GitHub shows you.

### 2b. Deploy on Vercel

1. https://vercel.com → sign up with GitHub (free).
2. **Add New Project** → import your GitHub repo.
3. Framework: **Next.js** (auto-detected).
4. **Environment Variables** — add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` *(preferred)* | `sb_publishable_...` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` *(legacy, optional fallback)* | `eyJ...` |

5. **Deploy** → wait ~2 minutes. You get `https://aaditri-emerland-web.vercel.app`.

### 2b-optional. MSG91 WhatsApp delivery (for the Bot Messages feature)

The admin "Bot Messages" feature sends to every resident's in-app inbox by default. If you *also* want each message delivered to their WhatsApp, configure MSG91.

**One-time setup on MSG91's side:**

1. Sign up at https://msg91.com.
2. Go to **WhatsApp** → connect a **WhatsApp Business number**. MSG91 walks you through Meta Business verification (1–3 days).
3. In **WhatsApp → Templates**, create and submit one template named exactly `society_broadcast` (or whatever you set `MSG91_WHATSAPP_TEMPLATE_NAME` to):
   - Category: **UTILITY**
   - Language: **English (en)**
   - Body:
     ```
     Hello {{1}},

     A message from Aaditri Emerland management:

     {{2}}

     — Aaditri Bot
     ```
   - Meta usually approves utility templates within minutes.
4. Copy your **Auth Key** from **Panel → API**.

**Vercel env vars (server-side, do NOT prefix with `NEXT_PUBLIC_`):**

| Variable | Example | Notes |
|----------|---------|-------|
| `MSG91_AUTH_KEY` | `464...xyz` | Secret. From MSG91 API panel. |
| `MSG91_WHATSAPP_INTEGRATED_NUMBER` | `919999999999` | Digits only, E.164 without `+`. Your MSG91-connected WhatsApp Business number. |
| `MSG91_WHATSAPP_TEMPLATE_NAME` | `society_broadcast` | Must match the approved template name exactly. |
| `MSG91_WHATSAPP_LANGUAGE` *(optional)* | `en` | Default `en`. |
| `MSG91_WHATSAPP_DEFAULT_COUNTRY_CODE` *(optional)* | `91` | Prepended to 10-digit phone numbers stored without a country code. Default `91` (India). |

**If these are missing the feature safely degrades**: the admin can still send bot messages, they just land in the in-app inbox only. Each recipient row gets `whatsapp_status = 'skipped_disabled'` so you can see at a glance that WhatsApp was off.

**Resident opt-in**: every resident has a `whatsapp_opt_in` toggle on their Profile page (defaults ON). If they switch it off, they stop receiving WhatsApp copies but still see messages in the in-app inbox. Each skipped row is recorded as `skipped_opt_out`.

**Cost awareness**: MSG91 WhatsApp utility templates in India are ~₹0.10–0.40 per message at typical volumes. A full-community broadcast to 100 residents is therefore ~₹10–40.

### 2c-optional. Calendar-invite emails via Brevo

The app can email every resident a calendar invite when:

- an **admin creates an event** → all approved residents receive an `.ics` attachment + "Add to Google / Add to Outlook" web-link buttons.
- an **admin approves a booking** → just the booker receives the same kind of invite for their slot.

If this isn't configured, event/booking creation still works — the invite emails are silently skipped (the API route returns `{ skipped: true, reason: 'Email provider not configured' }`).

**One-time setup (Brevo free tier: 300 emails/day, no domain required):**

1. Sign up at https://www.brevo.com → choose the **Free** plan (no card).
2. Dashboard → **Settings** → **SMTP & API** → **API Keys** → **Generate a new API key**. Keys start with `xkeysib-`.
3. Dashboard → **Senders & IP** → **Senders** → **Add a sender**. Use your personal Gmail (or any email you control). Brevo sends a verification email — click the link. Without this step, the API will reject sends because Brevo requires the sender to be a verified address.
4. *(Optional, for production)* Go to **Senders & IP** → **Domains** → add your domain and follow their DNS steps. Emails will then look like `noreply@your-domain.com` instead of `yourname@gmail.com`. Not required for the free tier to work.

**Vercel env vars (server-side only; no `NEXT_PUBLIC_` prefix):**

| Variable | Example | Notes |
|----------|---------|-------|
| `BREVO_API_KEY` | `xkeysib-abcd...` | Secret. From Brevo API Keys dashboard. |
| `EMAIL_FROM_ADDRESS` | `yourname@gmail.com` | Must be a verified sender in Brevo. Otherwise sends fail. |
| `EMAIL_FROM_NAME` *(optional)* | `Aaditri Emerland Community` | Display name on the From line. Default: `Aaditri Emerland Community`. |

**Verify the configuration without sending anything:**

While the dev server is running, hit `/api/_debug/email-status` as an admin. It returns `{ configured: true, from: "Aaditri Emerland Community <you@gmail.com>", keyFingerprint: "xkey…12", hints: {...} }` without leaking the key itself. `configured: false` means the env vars didn't load — restart `npm run dev` after any `.env.local` change.

**Calendar-invite behaviour notes:**

- Events store `date` + free-text `time` (e.g. `"10:00 AM"` or `"18:30"`). We parse the time, assume **IST** (Asia/Kolkata), and default the event duration to 2 hours. If parsing fails the email still goes out — just without an attached `.ics`.
- Bookings' `time_slot` is parsed as "start - end" (e.g. `"6:00 PM - 8:00 PM"`).
- Each invite includes an `.ics` attachment *and* deep-link buttons to Google Calendar / Outlook Web so the user can one-click from any device.
- Nothing per-user opts in or out yet — if a resident has an email in their profile, they receive event invites. If you need an opt-out toggle, ask and I'll add one (mirrors the WhatsApp opt-in toggle already on the Profile page).
- **Free-tier limit: 300 emails/day.** A broadcast to 100 residents is 100 emails. Event creation can therefore burn through the quota fast if you have >3 big announcements in a day. Brevo's paid tier ($9/month) lifts this to 20k/month.

### 2c. Update Supabase Auth URLs

Go back to Supabase → Authentication → URL Configuration:
- **Site URL**: `https://aaditri-emerland-web.vercel.app`
- **Redirect URLs**: `https://aaditri-emerland-web.vercel.app/**`

---

## STEP 3 — Local Development

### Prerequisites
- **Node.js 18+**
- **npm** (or yarn/pnpm)

### Setup

```bash
cd aaditri-emerland-web
npm install
cp .env.local.example .env.local
# edit .env.local with your Supabase URL + key
npm run dev
```

Open http://localhost:3000.

### `.env.local` file

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# OR
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### IMPORTANT: Windows + WSL

**Do not run `next dev` from inside WSL if the repo lives on `C:\` / `/mnt/c/`.**
Turbopack's cache and WSL's inode/path semantics fight each other and you will get:
- `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`
- "Another next dev server is already running" on port 3000
- stale hydration mismatches that survive cache clears

Pick one environment and stick to it:
- **Windows native** (recommended here): use PowerShell / CMD / Cursor terminal on `C:\work\...`
- **WSL native**: `git clone` into `~/code/...` inside WSL, run dev there

If you ever see the errors above, run:
```powershell
wsl -d Ubuntu -u root -- ps -ef | Select-String next
```
If it returns anything, that's a stray WSL `next dev` holding port 3000.

---

## STEP 4 — PWA Icons

Add these to `public/`:
- `public/icon-192.png` (192×192)
- `public/icon-512.png` (512×512)

Use Canva / Adobe Express with brand color `#1B5E20`. The manifest at `public/manifest.json` references these filenames.

---

## STEP 5 — Install as App on Mobile

### iPhone (iOS)
1. Open the app URL in **Safari** (must be Safari)
2. Tap **Share** → scroll → **Add to Home Screen** → **Add**

### Android
1. Open the app URL in **Chrome**
2. 3-dot menu → **Add to Home screen** / **Install app** → **Add**

---

## Admin Setup

### Create the first admin
1. Register through the app UI.
2. Supabase → SQL Editor:
   ```sql
   UPDATE public.profiles
   SET role = 'admin', is_approved = true
   WHERE email = 'your-admin@email.com';
   ```
3. Sign out and sign in via `/auth/admin-login`.

### Permission matrix

| Feature                          | Admin | Resident         |
|----------------------------------|-------|------------------|
| Post announcements               | ✅    | read-only        |
| Create events                    | ✅    | RSVP only        |
| Approve/reject bookings          | ✅    | book only        |
| Send broadcasts                  | ✅    | read-only        |
| Manage users / grant admin       | ✅    | ❌               |
| Post community updates           | ✅    | ❌               |
| Upload photos to gallery         | ✅    | ✅               |
| Access `/admin/*` routes         | ✅    | redirected to `/dashboard` |

Enforcement lives in `src/proxy.ts` (auth + role gate) and Supabase RLS policies (row-level).

---

## Supabase Free Tier Limits

| Resource | Free Limit | Approx. headroom |
|----------|-----------|------------------|
| Database | 500 MB | ~100k rows |
| Storage | 1 GB | ~1000 photos |
| Monthly Active Users | 50,000 | Large community |
| API requests | 500k/month | Very active usage |

Plenty for a residential community under ~500 flats.

---

## Custom Domain (Optional, Free)

1. Vercel → project → **Settings** → **Domains** → add `app.aaditriemeralnd.com`.
2. Update DNS at your registrar with the records Vercel shows.
3. Back in Supabase → Authentication → URL Configuration: update Site URL and Redirect URLs to the new domain.

---

## Security Notes

1. `.env.local` is in `.gitignore` — never commit it.
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are safe to ship to the browser — Row Level Security enforces per-row access rules.
3. The **service role key** is NOT used anywhere in this codebase. Do not add it to `.env.local` or Vercel.
4. All database access is governed by RLS policies in `supabase/schema.sql`.
5. Admin routes are gated twice: once in `src/proxy.ts` (redirects non-admins) and again at the DB level by RLS.
6. `middleware.ts` has been renamed to **`proxy.ts`** as of Next.js 16. The exported function is `proxy`, not `middleware`.

---

## CI / CD

The repo ships with **two GitHub Actions workflows** and a `vercel.json`.

### `.github/workflows/ci.yml` — always runs
Runs on every PR and every push to `main`:
1. `npm ci` (deterministic install)
2. `npm run lint`
3. `npm run type-check` (`tsc --noEmit`)
4. `npm run build` (Next.js production build)

These are **CI gates**. If any step fails, the PR can't merge (once branch protection is enabled). The `build` step uses placeholder Supabase env vars so it doesn't need your real secrets — it only verifies the code compiles.

### `.github/workflows/vercel-deploy.yml` — dormant by default
Only activates if you set these GitHub repository secrets:
- `VERCEL_TOKEN` — from https://vercel.com/account/tokens
- `VERCEL_ORG_ID` — from `.vercel/project.json` after running `npx vercel link` locally
- `VERCEL_PROJECT_ID` — same file

When all three are set:
- Every PR → preview deploy + sticky comment with the preview URL
- Every push to `main` → production deploy
- Missing any secret → the workflow logs a notice and skips deployment (Vercel's Git integration handles it instead)

### Which deploy path should you use?

| Approach | Setup | When to pick it |
|----------|-------|-----------------|
| **Vercel Git integration** (default) | Just click "Import Git Repository" in Vercel — no secrets needed | Almost always. Simplest, fastest, battle-tested. |
| **GitHub Actions + Vercel CLI** | Add the three secrets above | You want deploys gated by Actions, or you need custom pre-deploy steps (migrations, smoke tests, etc.) |

You can run **both at the same time** — the Git integration will deploy from Vercel's side, and Actions will deploy from its side. Whichever completes first "wins" (Vercel deduplicates). That's wasteful; pick one.

### Recommended branch protection (once CI is green)
- Settings → Branches → Add rule for `main`
- Require status checks to pass before merging → select `CI / Lint, Type-check & Build`
- Require PRs → at least 1 approval

### Setting up secrets locally for Vercel CLI
```bash
npx vercel link        # creates .vercel/project.json (git-ignored)
cat .vercel/project.json
# copy "orgId" → VERCEL_ORG_ID
# copy "projectId" → VERCEL_PROJECT_ID
```

Then in GitHub: Settings → Secrets and variables → Actions → New repository secret (one per value).

### `vercel.json`
Committed to the repo. It:
- Pins the build region to `bom1` (Mumbai) so cold starts are faster for Indian users
- Declares the framework (`nextjs`) explicitly
- Sets the install and build commands
- Adds security response headers (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) that Next.js doesn't ship by default

### `.nvmrc`
Pins Node 20 for both CI (`setup-node` reads it automatically) and local dev (`nvm use` picks it up).

---

## Updating the App

```bash
git add .
git commit -m "describe your changes"
git push
```
Vercel auto-deploys on push to `main` (~1 minute). The GitHub Actions CI runs in parallel.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Could not find the 'X' column of 'Y' in the schema cache` | The DB is missing that column (or PostgREST hasn't reloaded). Re-run `supabase/schema.sql` in the SQL Editor — it's idempotent and ends with `notify pgrst, 'reload schema'`. If the error persists >60s, manually run `notify pgrst, 'reload schema';` in SQL Editor |
| `Invalid API key` | Check `.env.local` has the right Supabase URL + key |
| User can't log in | Supabase → Authentication → Users — confirm account exists |
| User stuck on `/auth/pending` | Set `is_approved = true` via SQL, or approve from admin users page |
| Photos won't upload | Re-run `supabase/schema.sql` so storage buckets + policies are recreated |
| Admin can't see admin section | Run the `UPDATE profiles SET role='admin'` SQL and sign back in |
| 404 on deploy | Check Vercel build logs — missing env vars are the usual culprit |
| Redirect loop | Ensure Supabase Site URL matches your Vercel domain exactly |
| `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` | Stray `next dev` elsewhere (often WSL). See Step 3 Windows + WSL section. Kill the stray, delete `.next`, restart |
| `"AdminLayout" cannot have a negative time stamp` | An async Server Component layout is calling `redirect()`. Move auth gating to `src/proxy.ts` and keep layouts synchronous |
| `middleware file convention is deprecated` warning | File must be `src/proxy.ts` exporting a `proxy` function (not `middleware`) |
| Hydration mismatch on dashboard | Gate dynamic values on the `mounted` flag from `useAuth()`; add `suppressHydrationWarning` on the single affected element |
