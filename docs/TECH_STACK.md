# Tech Stack — Aaditri Emerland Community App

Source of truth for what the app is built on and how the pieces fit together. Update this when you add a major dependency or service.

> **Versions are pinned in `package.json`** — the numbers below are accurate as of 2026-04-26 but always cross-check `package.json` if you're adding code that depends on a specific version's behaviour.

---

## At a glance

```
                                Aaditri Emerland Web (PWA)
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                 ▼                                 ▼
   Frontend (React)              Backend (Next.js Routes)            External services
   ─────────────────              ────────────────────────            ────────────────────
   Next.js 16 App Router          Server Components                  Supabase (DB / Auth /
   React 19                       Route Handlers (REST)                Storage / RLS)
   TypeScript 5                   src/proxy.ts (auth gating)         Brevo (email)
   Tailwind CSS 4                 next.after() background tasks      Web Push (VAPID)
   PWA (next-pwa + sw.js)         Vercel Cron (daily)                Telegram Bot API
   Web Push subscriber                                                Groq (AI assistant)
                                                                      Yahoo Finance, Open-Meteo,
                                                                      Nominatim, Google News RSS
                                                                      (read-only data)
```

---

## Frontend

| Layer | Choice | Version | Why |
|---|---|---|---|
| **Framework** | [Next.js](https://nextjs.org/) (App Router, Turbopack dev) | `16.2.4` | First-class TS, file-system routing, SSR + RSC, Vercel-native. **Note: this is Next 16, which renamed `middleware.ts` → `proxy.ts`.** |
| **UI runtime** | React | `19.2.4` | Server Components + new hooks (`use`, `useFormStatus`). |
| **Language** | TypeScript | `^5` | Strict mode. No `any` without a comment. |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | `^4` (via `@tailwindcss/postcss`) | Utility-first. Brand palette: primary `#1B5E20` (dark green), accent `#FFD700` (gold), background `#F5F5F5`. |
| **Icons** | [lucide-react](https://lucide.dev/) | `^1.8.0` | Tree-shakeable SVG icon set. |
| **Toasts** | [react-hot-toast](https://react-hot-toast.com/) | `^2.6.0` | One-line success/error feedback. |
| **Date utils** | [date-fns](https://date-fns.org/) | `^4.1.0` | Pure functions, ESM, no global mutation. |
| **PWA** | [next-pwa](https://github.com/shadowwalker/next-pwa) + hand-written `public/sw.js` | `^5.6.0` | Manifest at `public/manifest.json`. Service worker is registered manually by `src/components/pwa/PushSubscriber.tsx` because next-pwa's auto-register fights Next 16 + Turbopack dev. |
| **QR codes** | [qrcode](https://github.com/soldair/node-qrcode) | `^1.5.4` | Used only on `/dashboard/clubhouse/passes` to render data-URL QR for self-serve clubhouse passes. |

### Frontend conventions

- `'use client'` at top of any component using hooks, browser APIs, or event handlers.
- Layouts under `src/app/admin/` and `src/app/dashboard/` are **synchronous** Server Components — no `async`, no `await`, no `redirect()`. Auth gating is in `src/proxy.ts`. Async layouts that call `redirect()` crash Turbopack's dev tracer in Next 16.
- Anything client-rendered that depends on auth state is gated on `mounted` from `useAuth()` to avoid hydration mismatches.
- `@/` path alias for everything: `@/lib`, `@/components`, `@/hooks`, `@/types`.
- Mobile-first: every page is designed for 320–414px viewports first, with `sm:` (>= 640px) breakpoints adding desktop polish.

---

## Backend

The backend is **inside the same Next.js app** — no separate API server, no microservices. Two layers run on the server:

### 1. Route Handlers (`src/app/api/**/route.ts`) — REST endpoints

106+ route handlers covering: auth, admin operations, bookings, issues, clubhouse, community funds, phonebook, family invites, push subscriptions, Telegram webhook, news aggregation, AI assistant, services directory, scheduled reminders, cron, and admin debug tools.

Folder organization:

| Folder | Purpose |
|---|---|
| `src/app/api/auth/*` | Self-service registration (email-or-phone, no OTP). |
| `src/app/api/admin/*` | Admin-only operations. Service-role-key client used sparingly (see "Privileged operations" below). |
| `src/app/api/cron/*` | Vercel Cron entry points. Currently one daily job at 03:30 UTC. |
| `src/app/api/news/*` | Server-side news/data aggregators (weather, AQI, fuel, markets, panchang, RSS feeds, geocode). All unauthenticated, all rate-limited via Next's `revalidate`. |
| `src/app/api/push/*` | Web push subscribe/unsubscribe and broadcast fan-out. |
| `src/app/api/telegram/*` | Telegram webhook + pairing flow. |
| `src/app/api/ai/*` | AI assistant — provider-agnostic adapter (currently Groq). Tool-calling is on for Groq/OpenAI: read tools execute server-side immediately, write tools (`create_booking`, `create_issue`) mint a signed pending-action token that the user must Confirm. No update/delete tools. |

### 2. `src/proxy.ts` — auth + role gating

Replaces the older `middleware.ts` (Next 16 renamed it). Runs before every request to `/dashboard/*` or `/admin/*`. Key trick: it caches `{ role, is_approved }` in an `httpOnly` cookie so we don't hit the `profiles` table on every navigation.

### 3. Server-only utilities (`src/lib/*`)

| Module | Job |
|---|---|
| `supabase.ts` | Browser Supabase client factory (uses public key). |
| `supabase-server.ts` | Server Component / route handler Supabase client (cookie-aware). |
| `supabase-admin.ts` | **Service-role** client (`'server-only'`). Used only for ops that must bypass RLS. |
| `notify.ts` + `notify-routing.ts` | Single dispatcher for all notifications. Routes each "kind" through web push + Telegram with a shared payload. |
| `push.ts` | Web Push channel (VAPID). |
| `telegram.ts` + `channels/telegram-actions.ts` | Telegram channel + inline-button handler (Approve/Reject from a DM). |
| `email.ts` | Brevo transactional email (server SMTP/API). |
| `booking-email.ts` | Builds tentative/confirmed/cancelled `.ics` attachments and dispatches via `email.ts`. |
| `ics.ts` | iCalendar generation (`METHOD`, `SEQUENCE`, `STATUS`). |
| `ai/index.ts` + adapters | Provider-agnostic AI chat client. Default: Groq. |
| `phone.ts` | E.164 phone-number normalization for the email-or-phone login. |
| `rate-limit.ts` | In-memory per-IP/per-key throttle for sensitive endpoints. |
| `decisions/*.ts` | Shared approval helpers used by both web routes AND the Telegram bot — guarantees feature parity. |

### Privileged operations (service-role key)

The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS, so we use it sparingly. Current call sites:

- `/api/admin/users/[id]/delete` — cascades to `auth.users`, only reachable to admins.
- `/api/auth/register` — creates the auth user pre-confirmed (skipping Supabase's mailer rate limits) and inserts the `profiles` row with `is_approved = false`.
- `/api/admin/clubhouse/passes/validate` — reads canonical pass row to admit a guest.
- A handful of admin-only catalog endpoints (services, facility seed, scheduled reminders).
- The cron and notification dispatchers (need to fan out across all users).

The factory imports `'server-only'` so it can never be bundled into the browser.

---

## Database & data layer

| Service | Purpose |
|---|---|
| **[Supabase](https://supabase.com/)** | Postgres + Auth + Storage + Row-Level Security + Realtime. **One service, one bill.** |
| **`@supabase/ssr`** `^0.10.2` | Cookie-aware client factory for Server Components and route handlers. |
| **`@supabase/supabase-js`** `^2.103.3` | Underlying client. |

### Schema layout

Single source of truth for fresh installs: `supabase/schema.sql` (~1857 lines).

Incremental changes ship as numbered files in `supabase/migrations/`. Apply once, in date order, on existing prod DBs. Both files always end up in the same final state — keep them in sync when you add a table.

Major tables (see `src/types/index.ts` for TypeScript shapes):

- **Identity**: `profiles`, `vehicles`, `family_members`, `pets`, `family_invitations`.
- **Community content**: `announcements`, `events`, `bookings`, `gallery_items`, `broadcasts`, `phonebook`.
- **Operations**: `issues`, `issue_status_events`, `clubhouse_facilities`, `clubhouse_tiers`, `clubhouse_subscriptions`, `clubhouse_passes`, `services`, `service_rates`.
- **Governance**: `community_funds`, `fund_contributions`, `fund_spends`, `admin_audit_log`, `scheduled_reminders`.
- **Notifications**: `push_subscriptions`, `event_reminders_sent`, `bot_messages`, `bot_message_recipients`, `notification_events`, `notification_preferences`, `telegram_links`, `telegram_pairings`, `telegram_notifications_sent`, `telegram_pending_actions`.

### RLS is the source of truth

Every table has Row-Level Security policies. **When adding a new table or query, also add or update the matching RLS policy.** The few service-role-key call sites listed above are documented exceptions, all justified by needing access to `auth.users` (which is unreachable from RLS) or cross-user fan-out for notifications.

---

## Authentication

- **Provider**: Supabase Auth.
- **Identifier**: email or phone (no OTP — admin approval is the gate).
- **Sessions**: stored as Supabase's `sb-*-auth-token` cookie.
- **Role gating**: `src/proxy.ts` reads the JWT, fetches `{ role, is_approved }` from `profiles`, caches positive results in an `httpOnly` cookie for 30 minutes.
- **Approval flow**: new resident → `is_approved = false` → admin approves via `/admin/users` or Telegram inline button → next sign-in lands on `/dashboard`.
- **Forgot password**: email-only path via Supabase's built-in `resetPasswordForEmail`.

See `docs/PHONE-LOGIN.md` for the phone-as-identifier details.

---

## Notifications (multi-channel dispatcher)

Every system event goes through **one** dispatcher (`src/lib/notify.ts`) that fans out to multiple channels.

| Channel | Status |
|---|---|
| **Web Push** | Active. VAPID via `web-push@^3.6.7`. Service worker at `public/sw.js`. Registered by `PushSubscriber.tsx`. Subscriptions stored in `public.push_subscriptions`. |
| **Telegram DM** | Active. Bot (`@Aaditri_Emerald_Bot`) handles inbound webhooks at `/api/telegram/webhook`. Inline Approve/Reject buttons for admins. Two-step reject flow with reason capture. |
| **Email (Brevo)** | Active. Transactional. Used for welcome emails, booking calendar invites (`.ics` attachments), and admin alerts. |
| **WhatsApp** | Deep-link buttons in resident UIs only — we don't send WhatsApp ourselves. (See `docs/MSG91_WHATSAPP.md` for the future plan.) |

The **routing table** lives in `src/lib/notify-routing.ts` — one entry per kind declares (a) audience, (b) per-channel renderers, (c) optional callback_data for Telegram inline buttons. Adding a new notification kind = adding a row to that table + calling `notify('your_kind', dedupKey, payload)` from the originating route.

---

## Scheduled jobs

Single Vercel Cron entry: `/api/cron/event-reminders` runs daily at **03:30 UTC** (~09:00 IST). Configured in `vercel.json`:

```json
"crons": [{ "path": "/api/cron/event-reminders", "schedule": "30 3 * * *" }]
```

The endpoint is gated by `CRON_SECRET` and runs four idempotent passes:

1. Event reminders (24–48h ahead).
2. Clubhouse pass expiry sweep.
3. Clubhouse subscription transitions (active → expiring → expired).
4. Scheduled reminders (admin-curated free-text reminders for that calendar day).

Vercel Hobby plans cap cron at one daily run, hence the consolidated handler. If we ever upgrade we'll split these by cadence.

---

## External services & APIs

| Service | What we use it for | Auth |
|---|---|---|
| **[Supabase](https://supabase.com/)** | DB, Auth, Storage, RLS. | Anon key (browser) + service-role key (server). |
| **[Vercel](https://vercel.com/)** | Hosting, edge network, cron, env-var management. | Project-level. |
| **[Brevo](https://www.brevo.com/)** (formerly Sendinblue) | Transactional email. **300/day free tier** — fine for our scale. Bypasses Supabase's hard ~2/hour confirmation-mail rate limit. | API key. |
| **[Groq](https://groq.com/)** | AI assistant chat (Llama 3.1 8B Instant by default). **Free tier: 30 req/min, 14,400 req/day.** | API key. |
| **Telegram Bot API** | Bot DMs + inline approve/reject + commands (`/dues`, `/issue`, etc.). | Bot token + webhook secret. |
| **[Open-Meteo](https://open-meteo.com/)** | Weather forecast + Air Quality + sunrise/sunset (Panchang). | None — fully unauthenticated free API. |
| **[Yahoo Finance v8 chart API](https://finance.yahoo.com/)** | NIFTY 50 / SENSEX / USD-INR / Gold (USD/oz) → derived ₹/10g 24K & 22K. | None (browser-ish UA required). |
| **[Nominatim (OpenStreetMap)](https://nominatim.org/)** | Reverse geocoding for the news location picker. | None — must send a real `User-Agent`. |
| **Google News RSS** | Local / traffic / cricket / fuel headlines. | None. |
| **Hand-curated RSS** | Times of India, Hindustan Times, Deccan Chronicle, etc. | None. |

**No paid AI APIs. No paid SMS gateway. No paid news APIs.** Every external service we use is either Supabase/Vercel/Brevo (tiny free tiers we already need anyway) or fully unauthenticated.

---

## Hosting & deployment

| Item | Details |
|---|---|
| **Host** | [Vercel](https://vercel.com/) — Hobby plan. |
| **Region** | `bom1` (Mumbai) — pinned in `vercel.json` to keep Supabase ↔ app round-trips under 5ms. |
| **Build** | `npm ci --no-audit --no-fund` → `npm run build`. |
| **Branch model** | `main` is production. PR previews on every branch. |
| **Env vars** | Managed in Vercel project settings; mirrored locally in `.env.local` (gitignored). |
| **Security headers** | Set in `vercel.json`: HSTS, X-Frame-Options=SAMEORIGIN, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy (camera/geolocation only). |

### Required env vars (production)

| Variable | What it does | Where you get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Supabase anon key (browser) | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server only) | Same |
| `BREVO_API_KEY` | Brevo transactional email | Brevo → SMTP & API |
| `BREVO_FROM_EMAIL` | Verified sender | Brevo → Senders |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web push public key (browser) | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Web push private key (server) | Same command |
| `VAPID_SUBJECT` | `mailto:` for VAPID | Your email |
| `TELEGRAM_BOT_TOKEN` | Bot token | BotFather |
| `TELEGRAM_BOT_USERNAME` | e.g. `Aaditri_Emerald_Bot` (no `@`) | BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random 32-byte string | `openssl rand -base64 32` |
| `TELEGRAM_WEBHOOK_URL` | Public URL of `/api/telegram/webhook` | Your deploy |
| `CRON_SECRET` | Bearer token for cron auth | `openssl rand -base64 32` |
| `CLUBHOUSE_PASS_SECRET` | HMAC secret for QR passes | `openssl rand -base64 32` |
| `AI_PROVIDER` | `groq` (recommended), `gemini`, `openai`, or `none` | — |
| `AI_API_KEY` | Provider key | https://console.groq.com/keys |
| `AI_MODEL` | Override model (optional) | Provider docs |
| `AI_TOOLS_SECRET` | HMAC secret for AI pending-action tokens (falls back to `CLUBHOUSE_PASS_SECRET`) | `openssl rand -base64 32` |

---

## Tooling & developer workflow

| Tool | Job |
|---|---|
| **Turbopack** | Dev server (`npm run dev`). Production build is still webpack. |
| **ESLint** | `eslint@^9` + `eslint-config-next@16.2.4`. `npm run lint`. |
| **TypeScript** | `tsc --noEmit` for a fast typecheck. `npm run type-check`. |
| **No tests yet.** | Risk-based manual validation per `agents/testing-agent.md`. |

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start Turbopack dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Serve production build locally |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript-only typecheck |

### One critical Windows + WSL warning

The repo lives at `C:\work\...`. **Never run `next dev` from WSL against `/mnt/c/...`** — both processes will write to `.next/` and corrupt Turbopack's chunk manifest. See `.cursor/rules/windows-wsl-dev.mdc` for diagnosis + recovery.

---

## Repository layout (top-level)

```
src/
  app/                      Next.js App Router
    api/                      Route handlers (REST endpoints)
    admin/                    Admin pages (gated by proxy.ts)
    dashboard/                Resident pages (gated by proxy.ts)
    auth/                     Login / register / forgot / pending
  components/                 Reusable UI components
  hooks/                      useAuth, useGeoLocation, etc.
  lib/                        Server + shared utilities
    ai/                         Provider-agnostic AI adapter (Groq default)
    decisions/                  Shared approval helpers (web + Telegram parity)
    channels/                   Per-channel notification renderers
  types/                      Shared TypeScript types
  proxy.ts                    Next 16 proxy (was middleware.ts)
public/
  sw.js                       Hand-written service worker
  manifest.json               PWA manifest
  icons/                      App icons
supabase/
  schema.sql                  Source-of-truth schema for fresh installs
  migrations/                 Numbered SQL files for existing prod DBs
docs/
  TECH_STACK.md               (this file)
  END_TO_END.md               Walkthrough of the major user flows
  NEWS.md                     Architecture of the /dashboard/news section
  PHONE-LOGIN.md              Email-or-phone login design
  CALENDAR_INVITES.md         Booking ICS invite flow
  COMMUNITY_FUNDS_SPEC.md     Funds + dues data model
  AI_ASSISTANT.md             AI assistant design + provider switch
  ...                         (and a few others — see docs/ folder)
agents/                       Cross-model agent playbooks
  sre-agent.md
  testing-agent.md
  code-review-agent.md
.cursor/
  rules/                      Cursor-specific guidance for AI coding agents
  skills/                     Skill wrappers
AGENTS.md                     Project-wide rules — read first
CLAUDE.md                     Claude-specific notes (delegates to AGENTS.md)
README.md                     Public overview
DEPLOYMENT.md                 Supabase + Vercel + Brevo setup walkthrough
```

---

## What this stack deliberately does NOT include

Worth being explicit about — these were considered and consciously rejected:

- **No separate API server / microservices.** Everything is a Next.js route handler. One repo, one deploy.
- **No state-management library.** React Server Components + Supabase realtime + React Context (`useAuth`) cover everything. No Redux, no Zustand, no MobX.
- **No CSS-in-JS.** Tailwind utility classes only.
- **No component library.** A handful of hand-rolled `Button` / `Input` / `Modal` components in `src/components/ui/` are enough.
- **No GraphQL.** Plain REST route handlers.
- **No Docker / Kubernetes.** Vercel runs everything.
- **No paid APIs (SMS, AI, news).** Free tiers + Groq + RSS get us all the way there.
- **No self-hosted AI (Ollama / vLLM).** Doesn't survive serverless. We use Groq's hosted Llama instead.
- **No service workers we didn't write ourselves.** `public/sw.js` is hand-rolled because next-pwa's auto-register doesn't play well with Next 16 + Turbopack dev.

---

## Adding new tech — the bar

Before pulling in a new dependency or external service, the question is: **does this earn its keep against the maintenance burden it adds?**

A new dep is justified if it:
- Replaces ~50+ lines of subtly tricky code we'd otherwise own.
- Has a stable API and active maintenance.
- Doesn't require a new env var that admins will forget.
- Has graceful fallback if it's unavailable (the way `notify()` does for VAPID/Telegram).

If those don't all check out, write the boring solution by hand. Most of this codebase is "boring solution by hand" and that's the point.
