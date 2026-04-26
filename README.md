# Aaditri Emerald Community Web App

Official community app for residents of Aaditri Emerald. It's a mobile-first PWA for announcements, events, facility bookings, a photo gallery, broadcasts, and admin management.

## Tech Stack

### Runtime & Framework
- **Next.js `16.2.4`** (App Router, Turbopack dev)
- **React `19.2.4`** / **React DOM `19.2.4`**
- **TypeScript `^5`**
- **Node.js `18+`**

### Styling / UI
- **Tailwind CSS `^4`** (via `@tailwindcss/postcss`)
- **lucide-react `^1.8.0`** — icon set
- **react-hot-toast `^2.6.0`** — toast notifications

### Backend as a Service
- **Supabase** (free tier)
  - **@supabase/ssr `^0.10.2`** — SSR / App Router client
  - **@supabase/supabase-js `^2.103.3`**
  - Services used: Auth, Postgres, Storage, RLS policies

### PWA
- **next-pwa `^5.6.0`**
- Manifest at `public/manifest.json` (standalone, brand color `#1B5E20`)
- Installable on iOS Safari and Android Chrome

### Utilities
- **date-fns `^4.1.0`** — date formatting

### Tooling
- **ESLint `^9`** + `eslint-config-next@16.2.4`

### Hosting
- **Vercel** (free tier, auto-deploy from GitHub)

## Project Structure

```
src/
├── app/
│   ├── admin/              # Admin-only section (protected by proxy.ts)
│   │   ├── gallery/
│   │   ├── messages/       # NEW: send Aaditri Bot messages to all residents
│   │   ├── updates/
│   │   ├── users/          # tag users as bot, edit vehicles, approve
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── api/                # NEW: server-only API routes
│   │   ├── _debug/
│   │   │   └── email-status/    # admin-only email-config sanity check
│   │   ├── admin/
│   │   │   ├── bookings/[id]/approve/   # approves + emails .ics invite
│   │   │   ├── events/invite/           # broadcasts event invite to all
│   │   │   └── messages/send/           # bot-message fan-out (+ WhatsApp)
│   │   └── news/                # NEW: location-aware News section backend
│   │       ├── weather/                 # Open-Meteo forecast + alerts
│   │       ├── air-quality/             # Open-Meteo AQI (US scale)
│   │       ├── feeds/                   # RSS aggregator (traffic/local/ai)
│   │       ├── cricket/                 # cricket headlines via Google News RSS
│   │       ├── markets/                 # Yahoo Finance v8 (NIFTY/SENSEX/USDINR/Gold)
│   │       ├── panchang/                # local tithi + sun times
│   │       ├── fuel/                    # petrol/diesel news headlines
│   │       └── geocode/                 # Nominatim reverse + Open-Meteo forward
│   ├── auth/
│   │   ├── admin-login/
│   │   ├── login/
│   │   ├── pending/
│   │   └── register/
│   ├── dashboard/
│   │   ├── announcements/
│   │   ├── bookings/       # admin can revoke/reject approved bookings now
│   │   ├── broadcasts/
│   │   ├── events/         # native date/time picker; auto-emails invites
│   │   ├── gallery/
│   │   ├── messages/       # NEW: per-user bot-message inbox
│   │   ├── news/           # NEW: location-aware news, weather, AQI, markets, panchang…
│   │   ├── profile/        # vehicles editor, WhatsApp opt-in
│   │   ├── layout.tsx
│   │   └── page.tsx        # community-photo hero
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── layout/             # Sidebar, TopBar, MobileNav, AuthShell (NEW)
│   ├── news/               # NEW: LocationPicker + panels (Weather/AQI/Markets/Panchang/Feed)
│   └── ui/                 # Button, Input, Modal, VehiclesEditor (NEW)
├── hooks/
│   ├── useAuth.ts
│   └── useGeoLocation.ts   # NEW: browser geolocation + reverse-geocode + cache
├── lib/
│   ├── email.ts            # NEW: Brevo transactional sender
│   ├── ics.ts              # NEW: RFC 5545 calendar-invite builder
│   ├── msg91.ts            # NEW: WhatsApp template sender (server-only)
│   ├── rss.ts              # NEW: dependency-free RSS/Atom parser
│   ├── share.ts            # NEW: Web Share API + clipboard fallback
│   ├── supabase.ts
│   └── supabase-server.ts
├── types/
│   └── index.ts
└── proxy.ts

public/
├── community.webp          # NEW: community photo used by dashboard hero + auth screens
├── manifest.json
└── icon-192.png, icon-512.png

supabase/
└── schema.sql              # tables (incl. bot_messages, vehicles), RLS, storage buckets

docs/                       # NEW per-feature documentation
├── BOT_MESSAGES.md
├── VEHICLES.md
├── CALENDAR_INVITES.md
├── AI_ASSISTANT.md         # NEW: free local Ollama/Llama community assistant
├── BREVO_EMAIL.md
├── MSG91_WHATSAPP.md
├── NEWS.md                 # NEW: news section architecture (9 endpoints, geolocation, security)
└── ADMIN_BOOKING_REVOKE.md
```

## Features

### Core (always on)
- **Auth** with approval queue and a separate admin login.
- **Role-based access** enforced in `src/proxy.ts` (runs before every request).
- **Announcements** (admin posts, pinned support).
- **Events** with RSVPs and a native date/time picker.
- **Facility bookings** with a full lifecycle: pending → approved → revoked/rejected (with required reason; resident is auto-notified via the bot inbox).
- **Broadcasts** (admin-only community-wide messages).
- **Photo gallery** (any resident can upload).
- **Profile**: name, flat, phone, avatar, **multiple vehicles**, WhatsApp opt-in toggle.
- **Admin Bot Messages**: send a message as "Aaditri Bot" to every approved resident, with per-user read receipts and an inbox at `/dashboard/messages`.
- **Multiple vehicles per resident**: dedicated `vehicles` table; admin and resident can add/remove with a per-vehicle type (car/bike/other).
- **Visual identity**: community photo used as a hero on the dashboard and as a background on every auth page.
- **News section** ([`docs/NEWS.md`](./docs/NEWS.md)) — location-aware dashboard with nine tabs: Weather, Air Quality, Traffic & Civic, Local News, Markets, Cricket, Panchang, Fuel News, AI/Tech. Auto-detects the user's city (with Hyderabad fallback) and lets them switch via a built-in city search. Mobile-first layout with thumbnails, share buttons, and per-panel filtering.
- **PWA**: installable, brand-themed, offline-ready shell.

### Optional integrations (graceful-degrade if not configured)
- **Email** via [Brevo](./docs/BREVO_EMAIL.md) — sends `.ics` calendar invites when an admin creates an event or approves a booking. Free tier covers 300 emails/day.
- **WhatsApp** via [MSG91](./docs/MSG91_WHATSAPP.md) — bot messages also go out as WhatsApp template messages. Per-resident opt-in.
- **AI Assistant** via local [Ollama](https://ollama.com/) + Llama models — fully free local inference for booking help and activity/report summaries. See [AI_ASSISTANT.md](./docs/AI_ASSISTANT.md).

### Free third-party data sources used by the News section (no keys needed)
- **[Open-Meteo](https://open-meteo.com/)** — weather forecast + air quality
- **[Nominatim (OpenStreetMap)](https://nominatim.org/)** — reverse geocoding (lat/lon → city)
- **[Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api)** — forward geocoding (city search)
- **[Yahoo Finance v8 chart](https://query1.finance.yahoo.com/)** — market quotes
- **[Google News RSS](https://news.google.com/rss)** — traffic, civic, cricket, fuel, and city-news fallback

All cached server-side via Next.js `revalidate`; no API keys, no new dependencies. See [`docs/NEWS.md`](./docs/NEWS.md) for cache TTLs, fallback behaviour, and security model.

## Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works) — see [DEPLOYMENT.md](./DEPLOYMENT.md)

### Setup
```bash
npm install
cp .env.local.example .env.local   # then fill in Supabase values
npm run dev
```

Open http://localhost:3000.

### Required environment variables
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
# OR, for projects using the new publishable-key scheme:
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The app reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` first and falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Optional AI environment variables (local and free)

```bash
AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
AI_OLLAMA_MODEL=llama3.2:3b
```

Then run `ollama serve` and pull a model (for example `ollama pull llama3.2:3b`).

### Scripts
| Script         | What it does                  |
|----------------|-------------------------------|
| `npm run dev`  | Next.js dev (Turbopack)       |
| `npm run build`| Production build              |
| `npm start`    | Serve production build        |
| `npm run lint` | ESLint                        |

## Important Development Notes

- **Don't run `next dev` from WSL against `/mnt/c/...`**. Running the dev server from inside WSL while the repo lives on the Windows filesystem corrupts Turbopack's `.next` cache and produces errors like `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`. Use PowerShell/CMD on Windows, or clone the repo inside the WSL filesystem.
- **Auth/role gating lives in `src/proxy.ts`**, NOT in individual layouts. Keep `admin/layout.tsx` and `dashboard/layout.tsx` synchronous Server Components — awaits + `redirect()` in async layouts triggers a Turbopack perf-tracing crash (`cannot have a negative time stamp`).
- **Client-rendered dynamic content** that depends on `useAuth()` should be gated on the `mounted` flag to avoid hydration mismatches.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full Supabase + Vercel setup.

## License

Private — internal use by the Aaditri Emerland community.
