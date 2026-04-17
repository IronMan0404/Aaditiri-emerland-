# Aaditri Emerland Community Web App

Official community app for residents of Aaditri Emerland. It's a mobile-first PWA for announcements, events, facility bookings, a photo gallery, broadcasts, and admin management.

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
│   │   └── admin/
│   │       ├── bookings/[id]/approve/   # approves + emails .ics invite
│   │       ├── events/invite/           # broadcasts event invite to all
│   │       └── messages/send/           # bot-message fan-out (+ WhatsApp)
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
│   │   ├── profile/        # vehicles editor, WhatsApp opt-in
│   │   ├── layout.tsx
│   │   └── page.tsx        # community-photo hero
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── layout/             # Sidebar, TopBar, MobileNav, AuthShell (NEW)
│   └── ui/                 # Button, Input, Modal, VehiclesEditor (NEW)
├── hooks/
│   └── useAuth.ts
├── lib/
│   ├── email.ts            # NEW: Brevo transactional sender
│   ├── ics.ts              # NEW: RFC 5545 calendar-invite builder
│   ├── msg91.ts            # NEW: WhatsApp template sender (server-only)
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
├── BREVO_EMAIL.md
├── MSG91_WHATSAPP.md
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
- **PWA**: installable, brand-themed, offline-ready shell.

### Optional integrations (graceful-degrade if not configured)
- **Email** via [Brevo](./docs/BREVO_EMAIL.md) — sends `.ics` calendar invites when an admin creates an event or approves a booking. Free tier covers 300 emails/day.
- **WhatsApp** via [MSG91](./docs/MSG91_WHATSAPP.md) — bot messages also go out as WhatsApp template messages. Per-resident opt-in.

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
