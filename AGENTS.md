<!-- BEGIN:nextjs-agent-rules -->
# Heads up: this is Next.js 16, not the Next.js you know

This project is on Next.js **16.2.4** with **Turbopack dev**. Several conventions changed and will trip up any agent running on older training data. Before writing code, check the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## Project: Aaditri Emerland Community Web App

Mobile-first PWA for residents of the Aaditri Emerland community — announcements, events, facility bookings, gallery, broadcasts, profile, and an admin panel. Hosted on Vercel, backed by Supabase.

## Specialized Agent Playbooks (Cross-Model)

Use the shared role playbooks in `agents/` when a task is specifically about operations, testing, or review:

- `agents/sre-agent.md`
- `agents/testing-agent.md`
- `agents/code-review-agent.md`

For Cursor auto-discovery, equivalent wrappers are available in `.cursor/skills/`.

## Tech Stack (authoritative — check `package.json` for exact versions)

- **Next.js `16.2.4`** (App Router, Turbopack)
- **React `19.2.4`** + **TypeScript `^5`**
- **Tailwind CSS `^4`** via `@tailwindcss/postcss`
- **Supabase**: `@supabase/ssr@^0.10.2`, `@supabase/supabase-js@^2.103.3` (Auth + Postgres + Storage + RLS)
- **PWA**: `next-pwa@^5.6.0`
- **UI**: `lucide-react@^1.8.0`, `react-hot-toast@^2.6.0`
- **Utils**: `date-fns@^4.1.0`
- **Hosting**: Vercel

## Project-Specific Rules (MUST follow)

### 1. Auth & role gating live in `src/proxy.ts`, not in layouts
- `src/proxy.ts` (formerly `middleware.ts`) handles `/dashboard/*` and `/admin/*` protection and role-based redirects.
- Keep `src/app/admin/layout.tsx` and `src/app/dashboard/layout.tsx` **synchronous** Server Components — no `async`, no `await`, no `redirect()` calls.
- Reason: async layouts that call `redirect()` trigger a Turbopack dev-tracing crash:
  `Failed to execute 'measure' on 'Performance': '​AdminLayout' cannot have a negative time stamp.`

### 2. File convention: `proxy.ts`, not `middleware.ts`
- Next.js 16 renamed the file and the exported function.
- Use `export async function proxy(request: NextRequest)`, not `middleware`.
- Migration codemod (reference): `npx @next/codemod@canary middleware-to-proxy .`

### 3. Hydration-safe client rendering
- `useAuth()` returns a `mounted` flag that is `false` on SSR + first client render.
- Any UI that depends on `profile`, `session`, or `isAdmin` MUST be gated on `mounted` (or use `suppressHydrationWarning` on the specific element) to avoid hydration mismatches.
- Never put `Date.now()`, `Math.random()`, `new Date().getHours()`, or locale-specific formatting directly in JSX during render. Compute in `useEffect` and store in state.

### 4. Supabase client factories — pick the right one
- **Browser components** (`'use client'`): `import { createClient } from '@/lib/supabase'`
- **Server components / Route handlers**: `import { createServerSupabaseClient } from '@/lib/supabase-server'`
- **Proxy (`src/proxy.ts`)**: uses `createServerClient` from `@supabase/ssr` directly with the NextRequest cookies adapter (already set up).

### 5. Env var fallback order
Supabase key is read as: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` first, then `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Support both schemes in any new code.

### 6. RLS is the source of truth for data access
- Every table in `supabase/schema.sql` has RLS policies. Default to RLS for everything in `public.*`.
- When adding a new table or query, also add/update the matching RLS policy.
- **Documented exceptions** (only for operations that touch `auth.users`, which is not reachable via RLS): `src/lib/supabase-admin.ts` exports a privileged client backed by `SUPABASE_SERVICE_ROLE_KEY`, used by:
  - `/api/admin/users/[id]/delete` — admin permanently removing a user (cascades to `public.*`).
  - `/api/auth/register` — self-service registration that creates the user pre-confirmed (`email_confirm: true`) so Supabase's built-in mailer is not invoked. We send our own welcome email through Brevo (`src/lib/email.ts`) instead. This sidesteps Supabase's hard ~2/hour confirmation-email rate limit on the free tier.
  
  The factory imports `'server-only'` so it can never be bundled into the browser. Do not add new call sites without an equally strong justification — prefer a new RLS policy whenever possible.

### 7a. News section (`/dashboard/news`) — location-aware, 9 panels

Full spec lives in [`docs/NEWS.md`](./docs/NEWS.md). Key constraints when editing:

**Architecture.** Single client page at `src/app/dashboard/news/page.tsx` renders one of nine panel components from `src/components/news/panels.tsx` based on the active tab. Each panel fetches its own data lazily on mount, scoped to the user's resolved location.

**Geolocation.** `src/hooks/useGeoLocation.ts` is the single source of truth for the active city + coords. On first visit it auto-prompts the browser once (and remembers the user's choice in `localStorage` under `ae-news-location` so we never re-prompt). Falls back to Hyderabad on denial. Manual override via `<LocationPicker>` (`src/components/news/LocationPicker.tsx`). All panels MUST receive `location: ResolvedLocation` and refetch when its `lat`/`lon`/`city` changes — never hard-code coords inside a panel.

**Hydration discipline.** The page renders nothing while `geo.hydrating` is true (the brief moment before localStorage is read). This prevents a double-fetch (fallback → real city) and a flash of Hyderabad data for a non-Hyderabad user.

**API routes.** All under `src/app/api/news/`:

| Route | Source | Cache | Notes |
|---|---|---|---|
| `weather` | Open-Meteo forecast | 10 min | Accepts `?lat=&lon=&city=`. Defaults to Hyderabad. Validates coords. |
| `air-quality` | Open-Meteo Air Quality | 15 min | US AQI + dominant pollutant. Same param contract. |
| `feeds?category=traffic\|local\|hyderabad\|ai&city=` | Hand-curated RSS + Google News RSS | 15 min | `local` is dynamic per city (curated for major Indian cities, Google News fallback otherwise). `hyderabad` is the legacy alias for back-compat. |
| `cricket` | Google News RSS (cricket-scoped) | 10 min | City-independent. |
| `markets` | Yahoo Finance v8 chart | 5 min | NIFTY, SENSEX, BANK NIFTY, USD/INR, EUR/INR, Gold. v7 quote endpoint requires auth — don't switch back. Yahoo blocks the default Node UA, so we always send a browser UA. |
| `panchang` | Computed locally | 1 hour | Tithi/moon phase from Conway's lunar-age algorithm + sunrise/sunset from Open-Meteo. No external Panchang API (they all need keys). |
| `fuel?city=` | Google News RSS scoped to "<city> petrol diesel price" | 30 min | Headlines, not raw numbers — every public price API needs a key. |
| `geocode?lat=&lon=` (reverse) or `?q=` (forward) | Nominatim (OSM) reverse + Open-Meteo geocoding forward | 24 hours | Nominatim's policy requires a real `User-Agent` — we send `AaditriEmerland/1.0`. Don't strip it. |

**RSS parser.** `src/lib/rss.ts` is dependency-free. The `clean()` function does CDATA unwrap → entity decode → strip `<a>`/`<img>`/`<script>`/`<style>` → strip remaining tags, **in that order**. Reordering breaks Times of India feeds (their HTML is XML-escaped in `<description>`). The parser also extracts the first usable thumbnail URL from `<enclosure>`, `<media:thumbnail>`, `<media:content>`, or `<img>` in the description.

**Security.** Every external link (article URLs and image URLs) passes through `safeUrl()` (http(s) only) inside `panels.tsx` before reaching `<a href>` or `<img src>`. This neutralises `javascript:` / `data:` payloads from hostile feeds. Don't bypass it.

**Mobile-first layout.** Panels are written for a 320–414px viewport first; `sm:` breakpoint expands to desktop. Don't introduce fixed pixel widths or tables — the page sits inside a mobile bottom-nav layout and breaks if anything overflows. Tab strip uses `-mx-3 sm:mx-0` (full-bleed scroll on mobile, wraps on desktop) with a right-edge gradient fade as a scroll affordance.

**Sharing.** `src/lib/share.ts` exports `shareOrCopy()` — uses Web Share API on supported browsers (mostly mobile), falls back to clipboard + toast. Always call this rather than `navigator.share` directly.

**Adding a new tab.** Don't bolt logic onto `panels.tsx` indefinitely — once that file passes ~600 lines, split per-panel into `src/components/news/<Name>Panel.tsx`. Add the new tab id to the `Tab` union and the `TABS` array in `page.tsx`.

**No API keys, no new dependencies.** Every external service used is unauthenticated and free-tier safe at our cache rates. If a feature needs a paid API, find an alternative or skip it.

### 7. Web push notifications
- Service worker lives at `public/sw.js` and is registered manually by `src/components/pwa/PushSubscriber.tsx` (we do **not** rely on `next-pwa` to register it — that runtime fights Next 16 + Turbopack dev).
- VAPID keys live in env vars: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (browser), `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (server-only).
- Generate a key pair once per env: `npx web-push generate-vapid-keys`.
- Server-side push helper: `src/lib/push.ts` (uses `createAdminSupabaseClient` to read subscriptions across all users).
- New tables: `public.push_subscriptions` (one row per device endpoint) and `public.event_reminders_sent` (dedup ledger for the 24h cron).
- `/api/cron/event-reminders` runs **once daily at 03:30 UTC** (Vercel Hobby plans don't allow more frequent crons; see `vercel.json`). The endpoint is gated by `CRON_SECRET` and now does three idempotent passes: event reminders (24-48h ahead), clubhouse pass expiry sweep, and clubhouse subscription transitions (active → expiring → expired) with their own `clubhouse_subscription_notices_sent` dedup ledger. Adding a `Bearer ${CRON_SECRET}` header from any healthcheck is safe to retry.
- Broadcasts trigger a fan-out via `/api/push/broadcast` after the row is inserted client-side. Push is **best-effort** — a missing VAPID config returns `{ skipped: 'not_configured' }` and the in-app row is still authoritative.

### 7b. Issues (community ticket tracker) + Clubhouse subscriptions

Full schema and seed data live in `supabase/migrations/20260420_tickets_clubhouse.sql` (also appended to `supabase/schema.sql` for fresh installs). Apply once on existing prod DBs.

**Issues.** Resident UI at `/dashboard/issues` (raise, list own tickets, comment, reopen within 7 days of resolution). Admin UI at `/admin/issues` with two tabs: kanban Board + Analytics (burndown, cumulative flow, KPIs, by-category). Push notifications are fired via `/api/issues/[id]/comment-notify` and `/api/admin/issues/[id]/status-notify` *after* the resident/admin writes the row directly via the supabase-js client (RLS is the gatekeeper). The `issue_status_events` ledger is auto-populated by a `before insert/update` trigger so analytics never has to compute "what was the state on day X" from a moving target.

**Clubhouse.** Three new admin-managed catalogs: `clubhouse_facilities` (rates per hour / per pass), `clubhouse_tiers` (price + included facility slugs + monthly pass quota + max pass duration), and `clubhouse_subscriptions` (per-flat, primary user + offline-collected dues). Residents see their tier + included facilities at `/dashboard/clubhouse`. Booking modal at `/dashboard/bookings` now renders a 🔒 badge on facilities the resident's tier doesn't cover and submits via `/api/bookings` (centralised subscription-gate check that RLS can't easily express).

**Subscribe → Admin approve flow** (added in `supabase/migrations/20260421_subscription_approval_flow.sql`). `clubhouse_subscriptions.status` now also includes `pending_approval` and `rejected`. Residents POST to `/api/clubhouse/subscriptions/request` (tier + months ∈ {1, 3, 6, 12} + optional notes); the row is inserted with `status='pending_approval'` via a dedicated RLS policy that only allows residents to create requests for their own flat. Admins see a "Pending requests" panel at the top of the `/admin/clubhouse` Subscriptions tab and act via `/api/admin/clubhouse/subscriptions/[id]/approve` or `/reject`. On approve, the API computes `start_date` + `end_date` (from the requested months, optionally overridden) and pushes a notification to the resident; on reject, it stores `rejected_reason` and notifies them too. A second partial unique index (`clubhouse_subscriptions_one_pending_per_flat`) prevents duplicate requests. Admins can still create subscriptions directly (no request) for backfills — those rows have NULL `requested_*` columns. Residents whose flat has no facility catalog yet can hit `/api/admin/clubhouse/facilities/seed` (admin-only) to idempotently re-insert the 8 default facilities — also wired as a "Reset catalogue" button on the Facilities tab.

**Self-serve passes.** `/dashboard/clubhouse/passes` mints HMAC-signed QR + short code via `/api/clubhouse/passes`. The DB trigger `clubhouse_passes_enforce_quota` enforces tier eligibility, monthly quota, and max pass duration so the rules can't be bypassed by a hostile client. Validation flow at `/admin/clubhouse/validate` uses the browser's `BarcodeDetector` API (with manual code-entry fallback for unsupported browsers) and posts to `/api/admin/clubhouse/passes/validate`. Admins tap "Admit & consume" to flip the pass to `used`.

**New env var.** `CLUBHOUSE_PASS_SECRET` — required for `/api/clubhouse/passes` to mint signed tokens and `/api/admin/clubhouse/passes/validate` to verify them. Generate with `openssl rand -base64 32` and add to `.env.local` + Vercel project env. Forging a QR without this secret fails signature verification; even if a forgery slipped through, the validate endpoint always re-reads the canonical `clubhouse_passes` row before admitting.

**New dependency.** `qrcode@^1.5.4` (+ `@types/qrcode` dev). Used only by `src/app/dashboard/clubhouse/passes/page.tsx` to render the data-URL QR in the resident's browser.

### 7c. Multi-channel notification dispatcher + Telegram bot

The notification system was rewritten in April 2026 to fan out every system notification through a single dispatcher that routes to **web push AND Telegram DMs**. The WhatsApp deep-link buttons in residents' UIs are unchanged — Telegram is purely additive.

**Migrations to apply (in order)** on existing prod DBs:

1. `supabase/migrations/20260430_telegram.sql` — `telegram_links`, `telegram_pairings`, `telegram_notifications_sent`.
2. `supabase/migrations/20260501_notifications.sql` — `notification_events` (audit log), `notification_preferences` (scaffold for opt-out).
3. `supabase/migrations/20260502_telegram_pending_actions.sql` — short-lived per-admin state for the two-step Telegram reject flow.
4. `supabase/migrations/20260503_booking_update_trigger.sql` — BEFORE UPDATE trigger pinning resident-controlled booking columns (facility/date/time_slot/user_id/notes/created_at) and locking status transitions to `pending → cancelled`. Closes a gap where residents could edit a `pending` row past the `/api/bookings` subscription gate.
5. `supabase/migrations/20260504_telegram_links_unique_active_chat.sql` — partial unique index on `telegram_links(chat_id) where is_active`. Prevents two distinct app accounts from binding to the same Telegram chat (which would mis-route DMs and break admin callback authorization).

All five are appended to `supabase/schema.sql` so a fresh install doesn't need them separately.

**Env vars (all server-side except where noted):**

- `TELEGRAM_BOT_TOKEN` — secret from BotFather. Never commit.
- `TELEGRAM_BOT_USERNAME` — without the `@` (e.g. `Aaditri_Emerald_Bot`). Used to build pairing deep-links from the resident-facing pair UI.
- `TELEGRAM_WEBHOOK_SECRET` — strong random string we send in the `X-Telegram-Bot-Api-Secret-Token` header on `setWebhook` and verify on every inbound webhook hit. Without it the webhook returns 401 to everyone.
- `TELEGRAM_WEBHOOK_URL` — public URL of the bot webhook (e.g. `https://aaditri-emerland.vercel.app/api/telegram/webhook`). Set the webhook by POSTing as an admin to `/api/telegram/init`.

**Architecture (read this before adding any new notification kind):**

- `src/lib/notify.ts` — the single dispatcher. Call sites do `await notify('event_published', eventId, payload).catch(() => {})`. The catch is intentional: notification failures must never break the originating action (booking insert, ticket comment, etc.).
- `src/lib/notify-routing.ts` — the routing table. One entry per `kind` declares (a) the audience resolver (which user IDs receive it), (b) the per-channel renderer (push title/body/url + Telegram MarkdownV2 + optional inline buttons), (c) optional callback_data for admin Approve/Reject taps. **Every change to "who gets notified for X" lives here.** The dispatcher and channel modules are payload-agnostic.
- `src/lib/push.ts` — web push channel (existing, unchanged).
- `src/lib/telegram.ts` — Telegram channel: `sendMessage`, MarkdownV2 escaping, fan-out per chat, dedup ledger writes.
- `src/lib/channels/telegram-actions.ts` — handles inbound Telegram `callback_query` (admin tapped Approve/Reject) and the two-step reject state machine.

**Audience routing semantics (current contract):**

- **Society-wide** (broadcasts, announcements, events, fund_created, fund_closed): every approved non-bot resident.
- **Per-flat fan-out** (subscription_expiring/expired, event_reminder): every approved member sharing the same `flat_number`.
- **Approval flows** (`registration_submitted`, `subscription_requested`, `booking_submitted`): all admins **plus** the requester themselves so they get an "in queue" echo.
- **Per-user feedback** (`*_decided`, `direct_message_received`, `ticket_comment_added`, `ticket_status_changed`, `fund_contribution_*`): just the relevant resident (or just admins, for `phonebook_entry_reported`).

**Telegram inline approvals + two-step reject.** Any admin paired with the bot can approve/reject registrations, bookings, and clubhouse subscription requests directly from a Telegram DM. Approve is one-tap. Reject is a two-step flow:

1. Admin taps ❌ Reject. The webhook records a row in `telegram_pending_actions` (one per admin chat) describing what they're rejecting and replies "Reply with a reason for rejection."
2. Admin sends a plain-text message in the same chat. The webhook checks `telegram_pending_actions` for that chat, treats the next message as the reason, finalises the rejection, and clears the row. Pending rows older than 10 minutes are treated as expired.

The web Approve/Reject endpoints AND the Telegram callback runner go through the **same shared decision helpers**:

- `src/lib/decisions/registrations.ts` → `approveRegistration` / `rejectRegistration`
- `src/lib/decisions/subscriptions.ts` → `approveSubscription` / `rejectSubscription`
- `src/lib/decisions/bookings.ts` → `approveBooking` / `rejectBooking`

This is the architectural commitment: every approval path (web AND Telegram) writes the row, logs an `admin_audit_log` entry, and dispatches the appropriate `*_decided` notification. The web booking-approve route additionally sends a calendar-invite email with an ICS attachment — that's a side effect of the web path only and does not block parity with Telegram.

**Adding a new notification kind:** add a payload type + an entry to `ROUTING` in `src/lib/notify-routing.ts`, then call `notify('your_kind', dedupKey, payload)` from the originating route. Don't add a new channel module unless you genuinely need a new transport.

**Don't bypass the dispatcher.** Direct calls to `sendPushToUsers` / `sendPushToAllResidents` are deprecated for new code — use `notify()` so push and Telegram stay in sync. The ones that remain (rate-limit warnings, internal admin pings) are documented in their call site.

### 8. Windows + WSL warning
The repo lives at `C:\work\aaditri-emerland-web`. **Never run `next dev` from WSL against `/mnt/c/...`** — it corrupts Turbopack's cache. If someone hits `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`, first run:
```powershell
wsl -d Ubuntu -u root -- ps -ef | Select-String next
```
Kill any stray `next dev` in WSL, wipe `.next`, then restart.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev (Turbopack) — http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run lint` | ESLint (`eslint-config-next@16.2.4`) |

## Coding Conventions

- TypeScript everywhere. No `any` without a comment explaining why.
- `'use client'` at top of any component using hooks, browser APIs, or event handlers.
- Keep Server Components synchronous unless an `await` is truly needed AND the component will never call `redirect()` during render.
- Use Tailwind utility classes; brand color `#1B5E20`, accent `#FFD700`.
- Prefer the `@/` path alias: `@/lib/...`, `@/components/...`, `@/hooks/...`, `@/types`.
- Don't commit `.env.local`. Never hard-code Supabase URLs or keys.

## Before finishing any task

1. Run `npm run lint` and fix new errors you introduced.
2. Don't leave `console.log` in committed code.
3. If you touched DB schema, update `supabase/schema.sql` **and** document the migration in the PR.
4. If you change `proxy.ts` auth rules, manually test `/dashboard`, `/admin`, `/auth/pending`, and `/auth/login` flows.

