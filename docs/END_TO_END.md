# Aaditri Emerland — End-to-End Documentation

A single, clean reference for the Aaditri Emerland community PWA. It covers what the app is, how it's built, and how every screen behaves for both **Residents** and **Admins**.

---

## 1. What this app is

**Aaditri Emerland** is a mobile-first Progressive Web App (PWA) for residents of the Aaditri Emerland residential community.

It replaces the typical mix of WhatsApp groups, paper notices, and shared Excel sheets with one organised place to:

- Read announcements, broadcasts, and admin updates
- See and RSVP to community events
- Book community facilities (clubhouse, pool, gym, party hall, etc.)
- Raise and track maintenance issues (plumbing, lifts, security, …)
- Subscribe to clubhouse plans and self-issue QR-coded guest passes
- Browse a community photo gallery
- Read curated local news (weather, AQI, traffic, markets, panchang, …)
- Chat-style inbox for messages from "Aaditri Bot" (admin broadcasts)
- Manage personal profile — vehicles, family members, pets, WhatsApp opt-in

---

## 2. Tech stack at a glance

| Layer | Choice |
|---|---|
| Framework | **Next.js 16.2.4** (App Router, Turbopack dev) |
| UI | **React 19.2.4** + **TypeScript 5** + **Tailwind CSS 4** |
| Icons | `lucide-react` |
| Toasts | `react-hot-toast` |
| Dates | `date-fns` |
| Backend | **Supabase** — Auth, Postgres, Storage, Row Level Security, Realtime |
| Push | Web Push (VAPID) via `web-push`, custom service worker at `public/sw.js` |
| QR codes | `qrcode` (clubhouse passes) |
| Email (optional) | **Brevo** REST API — calendar invites |
| WhatsApp (optional) | **MSG91** templates — bot-message fan-out |
| PWA | `next-pwa` + `public/manifest.json` |
| Hosting | **Vercel** (Mumbai region) |

Auth + role gating runs in `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`). Layouts stay synchronous.

---

## 3. The two roles

The app has exactly two roles, decided by `profiles.role`:

| Role | What they can do |
|---|---|
| **Resident** (`role = 'user'`) | Use everything in `/dashboard/*` once they're approved. Cannot access `/admin/*`. |
| **Admin** (`role = 'admin'`) | Everything a resident can do, plus the entire `/admin/*` section: user management, issue board, clubhouse catalog, bot messages, updates, gallery moderation, pass validation. |

A third "state" — `is_approved = false` — gates a brand-new resident behind the `/auth/pending` screen until an admin marks them approved.

---

## 4. End-to-end flow — the big picture

```
┌──────────────────────────────────────────────────────────────────────┐
│                   PUBLIC                                             │
│   /             → Landing page                                       │
│   /auth/login                                                        │
│   /auth/register   ← creates Supabase user, profile, vehicles,       │
│                     family, pets — all in one step                   │
│   /auth/pending    ← shown until admin approves                      │
│   /auth/admin-login                                                  │
│   /auth/forgot-password / /auth/reset-password                       │
└──────────────────────────────────────────────────────────────────────┘
                       │
                       │ proxy.ts gates everything below
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   RESIDENT  (/dashboard/*)                           │
│   Home · News · Announcements · Messages · Community · Events ·      │
│   Bookings · Clubhouse · Issues · Gallery · Broadcasts · Profile     │
└──────────────────────────────────────────────────────────────────────┘
                       │
                       │ if role = 'admin'
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   ADMIN  (/admin/*)                                  │
│   Dashboard · Users · Issues Board · Clubhouse · Validate Pass ·     │
│   Bot Messages · Updates · Gallery                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Authentication & onboarding

### 5.1 Self-service registration

`/auth/register` — open to anyone. The form collects everything needed up front:

1. Full name, email, phone, flat number
2. Resident type: **Owner** or **Tenant**
3. Password + confirm
4. Vehicles (multiple, each tagged car/bike/other)
5. Family members (name, relation, gender, age, phone)
6. Pets (name, species, vaccinated)

On submit the browser POSTs to `/api/auth/register` (server-only). That route:

- Creates the user **pre-confirmed** via the Supabase service-role key — so Supabase's own mailer is never invoked (and we sidestep its 2-emails-per-hour free-tier rate limit).
- Inserts the `profiles` row with `is_approved = false`.
- Bulk-inserts `vehicles`, `family_members`, `pets`.
- Sends a "welcome — your account is pending approval" email through Brevo, if configured.

### 5.2 Pending approval

The newly registered user is signed in but their `is_approved` flag is still `false`. The proxy redirects them to `/auth/pending`, which:

- Explains they're waiting on an admin.
- Offers a Sign Out button.

### 5.3 Admin approval

An admin opens `/admin/users`, finds the new resident, and toggles **Approve**. Behind the scenes that flips `profiles.is_approved` to `true`. The resident's next visit to `/dashboard` succeeds.

### 5.4 Login

| Screen | Use |
|---|---|
| `/auth/login` | All residents (and admins) — standard email + password |
| `/auth/admin-login` | Same auth, but visually flagged for admins; non-admins are redirected to `/dashboard` after login |
| `/auth/forgot-password` | Sends Supabase reset link |
| `/auth/reset-password` | Captures the new password from the reset link |

### 5.5 How the proxy decides where you go

`src/proxy.ts` runs on every `/dashboard/*` and `/admin/*` request:

1. No session → redirect to `/auth/login`.
2. Session exists → check `profiles.role` + `is_approved` (cached for 30 min in the `ae-role` httpOnly cookie).
3. `/admin/*` and not admin → redirect to `/dashboard`.
4. `/dashboard/*` and not approved → redirect to `/auth/pending`.

Row Level Security on every Postgres table is the second layer of defence — the proxy is purely for routing UX.

---

## 6. Resident experience

The bottom navigation (mobile) and left sidebar (desktop) expose these areas. Every screen is mobile-first.

### 6.1 Home — `/dashboard`

- Community-photo hero with a green gradient overlay.
- Personalised greeting (Good Morning / Afternoon / Evening) + flat badge.
- "Admin Dashboard →" pill if the user is an admin.
- Three latest items each from Announcements, upcoming Events, and Broadcasts.
- Quick links to the main areas.

### 6.2 News — `/dashboard/news`

A 9-tab "today" dashboard. Auto-detects the city via browser geolocation (cached in `localStorage`), with Hyderabad fallback and a manual `<LocationPicker>` for searching any city.

| Tab | What it shows | Source |
|---|---|---|
| Weather | Current + 5-day, sunrise/sunset, alerts | Open-Meteo |
| Air Quality | US AQI dial + pollutants | Open-Meteo Air Quality |
| Traffic & Civic | Roads, transit, outages | Curated + Google News RSS |
| Local News | City-specific newspapers | Curated for major Indian cities |
| Markets | NIFTY, SENSEX, BANK NIFTY, USD/INR, EUR/INR, Gold | Yahoo Finance v8 |
| Cricket | India / IPL / international | Google News RSS |
| Panchang | Tithi, paksha, moon phase, sun times | Computed locally |
| Fuel News | Petrol/diesel headlines for the city | Google News RSS |
| AI / Tech | The Verge, MIT Tech Review, Hacker News | RSS |

Every external link and image goes through `safeUrl()` (http(s)-only). Free third-party APIs only — **no keys required**.

### 6.3 Announcements — `/dashboard/announcements`

- Read-only list of admin-posted announcements. Pinned items float to the top.
- Admins also see a "Post announcement" composer here (same screen, conditional UI).

### 6.4 Messages — `/dashboard/messages`

- Personal inbox of one-to-many messages sent by an admin as **Aaditri Bot**.
- Read receipts (`read_at`), unread badge in sidebar + bottom nav (polled every 30s).
- "Mark all read" bulk action.
- Admins compose at `/admin/messages`; the recipient row + (optional) WhatsApp template fan-out happens server-side.

### 6.5 Community — `/dashboard/community`

A directory of approved residents — name, flat, vehicles. Useful for "who lives in 4-204?" lookups.

### 6.6 Events — `/dashboard/events`

- Browse upcoming events (date, time, location, description, optional cover image, RSVP count).
- Tap **RSVP** to register. State persists in `event_rsvps`.
- If Brevo is configured, the resident receives a `.ics` calendar invite when an admin first creates the event.

Admins additionally see a **Create event** button on this same screen.

### 6.7 Bookings — `/dashboard/bookings`

- Pick a facility (Clubhouse, Pool, Gym, Tennis, Badminton, Yoga Room, Party Hall, Conference Room).
- Pick date + time slot + optional notes.
- Submits via `/api/bookings` which runs the **subscription gate**: facilities flagged `requires_subscription = true` (gym, pool, yoga) need an active clubhouse subscription whose tier includes that facility. The booking modal shows a 🔒 badge on locked facilities.
- Booking lifecycle: `pending → approved → revoked / rejected` (or `cancelled` by the resident before approval).
- Approval triggers a `.ics` invite to the booker (if Brevo is configured).
- If an admin **revokes or rejects** an approved booking, the resident is auto-notified via the Bot inbox with the typed reason.

### 6.8 Clubhouse — `/dashboard/clubhouse` and `/dashboard/clubhouse/passes`

**Tier overview** (`/dashboard/clubhouse`):

- Shows the resident's current tier (or "no subscription") and the facilities included.
- Lists all available tiers (price, included facilities, monthly pass quota, max pass duration).
- "Request subscription" form: pick tier + months (1, 3, 6, or 12) + optional notes → POST `/api/clubhouse/subscriptions/request`. Status starts as `pending_approval`.
- Once approved by admin, the row flips to `active` and the resident gets a push + bot-inbox notice.

**Self-issued passes** (`/dashboard/clubhouse/passes`):

- For an active subscription, the resident can mint a guest pass (e.g. "give my cousin gym access for the weekend").
- POST `/api/clubhouse/passes` returns a short human code (`AE-7K2J9F`) **and** an HMAC-signed QR data URL (rendered with `qrcode`).
- Quota, tier eligibility, and max duration are enforced at the **DB trigger** — not just in the API — so a hostile client can't bypass them.

### 6.9 Issues — `/dashboard/issues`

- "Raise a ticket" form: title, description, category (plumbing / electrical / housekeeping / security / lift / garden / pest_control / internet / other), priority (low / normal / high / urgent).
- Personal list of own tickets with status colour chip (`todo`, `in_progress`, `resolved`, `closed`).
- Comment thread on each ticket. Admin replies trigger a push.
- Reopen window: a resolved ticket can be reopened by the resident within 7 days.

### 6.10 Gallery — `/dashboard/gallery`

- Any approved resident can upload photos with an optional caption.
- Viewer is a tap-to-zoom grid.
- Uploader's name shown; admins can delete from `/admin/gallery`.

### 6.11 Broadcasts — `/dashboard/broadcasts`

- Read-only feed of admin-only community-wide messages.
- Admins compose on this same screen. Posting fans out a Web Push notification to subscribed devices.

### 6.12 Profile — `/dashboard/profile`

Editable personal section:

- Name, phone, avatar.
- Flat number, resident type (owner / tenant).
- **Vehicles** — multiple, with type (car / bike / other).
- **Family members** — relation, gender, age, phone.
- **Pets** — species, vaccinated.
- **WhatsApp opt-in** toggle (default on). Off = bot messages stop being sent over WhatsApp; in-app inbox still works.
- **Push notifications** toggle — registers/unregisters the device's service-worker subscription.

---

## 7. Admin experience

Admins see everything residents see, plus the items below. Sidebar shows an **Admin** section once `role = 'admin'`.

### 7.1 Admin Dashboard — `/admin`

KPI tiles (server-rendered counts) and quick-action buttons:

- Total Residents, Announcements, Events, **Pending Bookings** (red if > 0), Total Bookings, Photos Shared, Broadcasts.
- Quick links: Manage Users, Bot Messages, Community Updates, Review Bookings, Post Announcement, Send Broadcast, Create Event.

### 7.2 Manage Users — `/admin/users`

- List every profile with search + filter.
- Approve / un-approve, promote to admin, edit name / phone / flat / vehicles.
- Tag exactly one resident as the "Bot" (the persona that authors bot messages).
- Permanent delete (calls `/api/admin/users/[id]/delete` which uses the service-role key to remove the `auth.users` row that RLS can't reach; cascades to all `public.*` tables).

### 7.3 Issues Board — `/admin/issues`

Two tabs:

- **Board** — kanban with the four statuses. Drag a card or use the menu to move it. Status changes auto-stamp `resolved_at` / `closed_at`. Each move pushes a notification to the resident.
- **Analytics** — burndown, cumulative-flow, KPIs, by-category breakdown. Powered by `issue_status_events` (a trigger-maintained ledger of every status transition).

Comments on an issue can be flagged **internal** (admin-only). Resident never sees those.

### 7.4 Clubhouse — `/admin/clubhouse`

Three tabs:

| Tab | Manages |
|---|---|
| **Facilities** | The catalog (`clubhouse_facilities`): name, slug, hourly rate, pass-rate-per-visit, requires-subscription flag, bookable flag, display order. "Reset catalogue" button re-seeds the 8 defaults. |
| **Tiers** | Subscription plans (`clubhouse_tiers`): name, price, included facility slugs, monthly pass quota, max pass duration. |
| **Subscriptions** | Per-flat subscriptions. **Pending requests** panel at the top; approve sets `start_date` / `end_date` and pushes a notification, reject stores `rejected_reason` and notifies. Admins can also create a subscription directly (no request) for backfills. |

**Analytics** (separate tile / API at `/api/admin/clubhouse/analytics`): MRR-style revenue projection, churn funnel, pass-usage heatmap by facility.

### 7.5 Validate Pass — `/admin/clubhouse/validate`

The gate-keeper screen.

- Uses the browser's **`BarcodeDetector`** API to scan the QR off the resident's phone (with manual code-entry fallback for browsers that lack it).
- POSTs to `/api/admin/clubhouse/passes/validate`, which:
  - Verifies the HMAC signature against `CLUBHOUSE_PASS_SECRET`.
  - Re-reads the canonical `clubhouse_passes` row (so even a forged-but-signed QR still has to match a real DB row).
  - Confirms `status = active` and that `now()` is between `valid_from` and `valid_until`.
- Admin taps **Admit & consume** to flip the pass to `used` (records `used_at`, `validated_by`).

### 7.6 Bot Messages — `/admin/messages`

- Compose a message to be sent **as Aaditri Bot** to every approved, non-bot resident.
- POST `/api/admin/messages/send`:
  - Inserts into `bot_messages`.
  - Bulk-inserts a `bot_message_recipients` row per resident.
  - For each recipient, calls MSG91 in parallel (concurrency 5) if WhatsApp is configured.
  - Skipped/failed deliveries are captured per-row (`whatsapp_status`, `whatsapp_error`) so the admin can see "delivered to 87, opted-out 5, failed 2" at a glance.
- Per-message stats panel: total recipients, % read, WhatsApp delivery breakdown.

### 7.7 Updates — `/admin/updates`

- "Community Updates" — categorised long-form posts (e.g. "Water tank cleaning schedule").
- Admin-only insert/edit. Residents see the resulting items in their general feed surfaces.

### 7.8 Gallery moderation — `/admin/gallery`

- Same gallery view as residents, but with a delete-any-photo control.

---

## 8. Cross-cutting features

### 8.1 Web Push notifications

- Service worker at `public/sw.js`, registered manually by `src/components/pwa/PushSubscriber.tsx` (we don't let `next-pwa` register it — its runtime fights Next 16 + Turbopack).
- VAPID keys: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (browser), `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (server).
- Subscriptions stored per-device in `public.push_subscriptions`.
- Triggers:
  - **Broadcasts** → fan-out via `/api/push/broadcast` after the row is inserted.
  - **Issue status changes** → `/api/admin/issues/[id]/status-notify`.
  - **Issue comments** → `/api/issues/[id]/comment-notify`.
  - **Subscription approve / reject** → inside the approve / reject API routes.
  - **Daily cron** at 03:30 UTC (`/api/cron/event-reminders`, gated by `CRON_SECRET`):
    - Event reminders (24-48h ahead).
    - Clubhouse pass expiry sweep.
    - Subscription transitions (active → expiring → expired) with their own dedup ledger.

Push is **best-effort**. If VAPID isn't configured the API returns `{ skipped: 'not_configured' }` and the in-app row is still authoritative.

### 8.2 Calendar invites (optional, via Brevo)

- Admin **creates an event** → `.ics` invite emailed to every approved resident with email, plus Google / Outlook web-link buttons.
- Admin **approves a booking** → `.ics` invite to the booker only.
- Without Brevo configured the API routes return `{ skipped: true, reason: 'Email provider not configured' }` — feature degrades silently.
- Free tier covers 300 emails/day.

### 8.3 WhatsApp delivery (optional, via MSG91)

- Bot messages also fan out as WhatsApp template messages.
- Per-resident `whatsapp_opt_in` toggle.
- Per-message delivery breakdown visible to the admin on `/admin/messages`.

### 8.4 PWA install

- iOS Safari: Share → Add to Home Screen.
- Android Chrome: install prompt (or 3-dot menu → Install app).
- Brand color `#1B5E20`, accent `#FFD700`. Manifest at `public/manifest.json`.

---

## 9. Data model summary

The full schema lives in `supabase/schema.sql`. Migrations:

- `supabase/migrations/20260420_tickets_clubhouse.sql` — issues + clubhouse tables, triggers, RLS.
- `supabase/migrations/20260421_subscription_approval_flow.sql` — adds `pending_approval` + `rejected` statuses and the request workflow.

Headline tables:

| Table | Purpose |
|---|---|
| `profiles` | One per Supabase auth user. `role`, `is_approved`, `is_bot`, `whatsapp_opt_in`. |
| `vehicles`, `family_members`, `pets` | Personal extensions of `profiles`. |
| `announcements`, `events`, `event_rsvps`, `bookings`, `broadcasts`, `photos`, `updates` | Core community content. |
| `bot_messages`, `bot_message_recipients` | Admin → resident inbox + read receipts + WhatsApp status. |
| `issues`, `issue_comments`, `issue_status_events` | Ticket tracker + analytics ledger. |
| `clubhouse_facilities`, `clubhouse_tiers`, `clubhouse_subscriptions`, `clubhouse_subscription_events`, `clubhouse_subscription_notices_sent`, `clubhouse_passes` | Clubhouse subsystem. |
| `push_subscriptions`, `event_reminders_sent` | Web push + cron dedup. |

**Row Level Security is the source of truth** for access rules. The service-role key is used in only two places and both files import `'server-only'`:

1. `/api/admin/users/[id]/delete` — needs to delete from `auth.users`.
2. `/api/auth/register` — creates the user pre-confirmed to bypass Supabase mailer rate limits.

---

## 10. API surface (server routes)

All under `src/app/api/`. Every route enforces auth itself or relies on RLS at the DB layer.

| Route | Used by | Notes |
|---|---|---|
| `POST /api/auth/register` | Register page | Creates user + profile + vehicles + family + pets, sends welcome email. |
| `POST /api/bookings` | Resident booking | Centralised subscription-gate check. |
| `POST /api/admin/bookings/[id]/approve` | Admin | Marks approved, emails `.ics`. |
| `POST /api/admin/events/invite` | Event create flow | Broadcasts `.ics` to all approved residents. |
| `POST /api/admin/messages/send` | Bot Messages | Fan-out to inbox + WhatsApp. |
| `POST /api/admin/users/[id]/delete` | Admin Users | Hard delete via service role. |
| `POST /api/issues/[id]/comment-notify` | Issue comment | Push to the other party. |
| `POST /api/admin/issues/[id]/status-notify` | Admin status change | Push to resident. |
| `GET  /api/admin/issues/analytics` | Admin Issues | Burndown / CFD / KPIs. |
| `POST /api/clubhouse/subscriptions/request` | Resident | Creates `pending_approval` row. |
| `POST /api/admin/clubhouse/subscriptions/[id]/approve` | Admin | Activates + notifies. |
| `POST /api/admin/clubhouse/subscriptions/[id]/reject` | Admin | Stores reason + notifies. |
| `POST /api/admin/clubhouse/facilities/seed` | Admin | Re-seeds the 8 default facilities. |
| `GET  /api/admin/clubhouse/analytics` | Admin | Revenue / churn / usage. |
| `POST /api/clubhouse/passes` | Resident | Mints HMAC-signed QR + short code. |
| `POST /api/admin/clubhouse/passes/validate` | Admin gate | Verifies + admits. |
| `POST /api/push/subscribe` / `/api/push/unsubscribe` | Browser | Manage push registration. |
| `POST /api/push/broadcast` | Broadcasts | Fan-out push. |
| `GET  /api/cron/event-reminders` | Vercel cron | Gated by `CRON_SECRET`; runs daily 03:30 UTC. |
| `GET  /api/news/{weather,air-quality,feeds,cricket,markets,panchang,fuel,geocode}` | News dashboard | All cached (`revalidate`), all key-less. |
| `GET  /api/_debug/email-status` | Admin | Sanity-check Brevo config without leaking the key. |

---

## 11. Environment variables

### Required

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   # preferred (new scheme)
NEXT_PUBLIC_SUPABASE_ANON_KEY          # legacy fallback
SUPABASE_SERVICE_ROLE_KEY              # server-only; used by /api/auth/register and /api/admin/users/[id]/delete only
```

### Push notifications

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT          # e.g. mailto:admin@aaditri.example
CRON_SECRET            # Bearer for the daily cron
```

### Clubhouse passes

```
CLUBHOUSE_PASS_SECRET  # generate with `openssl rand -base64 32`
```

### Optional integrations

```
# Brevo (calendar invites + welcome email)
BREVO_API_KEY
EMAIL_FROM_ADDRESS     # must be a Brevo-verified sender
EMAIL_FROM_NAME

# MSG91 (WhatsApp bot messages)
MSG91_AUTH_KEY
MSG91_WHATSAPP_INTEGRATED_NUMBER
MSG91_WHATSAPP_TEMPLATE_NAME
MSG91_WHATSAPP_LANGUAGE                  # default 'en'
MSG91_WHATSAPP_DEFAULT_COUNTRY_CODE      # default '91'
```

If an optional integration's vars are missing, the related feature **degrades gracefully** — never crashes.

---

## 12. Deployment quick-reference

1. Create a Supabase project (Mumbai region recommended).
2. Run `supabase/schema.sql` in the SQL editor.
3. Apply the two migrations under `supabase/migrations/` in order.
4. Configure Auth → URL Configuration with your Vercel URL.
5. Push the repo to GitHub, import into Vercel.
6. Add the env vars from §11 (at minimum the Supabase + service-role + push + clubhouse-pass keys).
7. After your first registration, promote yourself to admin:
   ```sql
   UPDATE public.profiles
   SET role = 'admin', is_approved = true
   WHERE email = 'you@example.com';
   ```
8. Sign out + back in via `/auth/admin-login` to pick up the new role.

Full step-by-step is in [`DEPLOYMENT.md`](../DEPLOYMENT.md).

---

## 13. Per-feature deep-dives

For implementation detail beyond this overview see:

- [`docs/NEWS.md`](./NEWS.md) — News section architecture (9 panels, geolocation, RSS, security)
- [`docs/BOT_MESSAGES.md`](./BOT_MESSAGES.md) — Bot inbox + WhatsApp fan-out
- [`docs/VEHICLES.md`](./VEHICLES.md) — Vehicles table + editor component
- [`docs/CALENDAR_INVITES.md`](./CALENDAR_INVITES.md) — `.ics` builder + Brevo integration
- [`docs/BREVO_EMAIL.md`](./BREVO_EMAIL.md) — Brevo setup + debug endpoint
- [`docs/MSG91_WHATSAPP.md`](./MSG91_WHATSAPP.md) — MSG91 template setup + opt-in toggle
- [`docs/ADMIN_BOOKING_REVOKE.md`](./ADMIN_BOOKING_REVOKE.md) — Booking revoke / reject lifecycle
- [`AGENTS.md`](../AGENTS.md) — Authoritative project rulebook (Next 16 conventions, RLS rules, hydration safety)
- [`SECURITY.md`](../SECURITY.md) — Secret rotation runbook
