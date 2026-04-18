<!-- BEGIN:nextjs-agent-rules -->
# Heads up: this is Next.js 16, not the Next.js you know

This project is on Next.js **16.2.4** with **Turbopack dev**. Several conventions changed and will trip up any agent running on older training data. Before writing code, check the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## Project: Aaditri Emerland Community Web App

Mobile-first PWA for residents of the Aaditri Emerland community — announcements, events, facility bookings, gallery, broadcasts, profile, and an admin panel. Hosted on Vercel, backed by Supabase.

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
- `/api/cron/event-reminders` runs hourly via `vercel.json` `crons` and is gated by `CRON_SECRET`.
- Broadcasts trigger a fan-out via `/api/push/broadcast` after the row is inserted client-side. Push is **best-effort** — a missing VAPID config returns `{ skipped: 'not_configured' }` and the in-app row is still authoritative.

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
