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
│   │   ├── updates/
│   │   ├── users/
│   │   ├── layout.tsx      # sync server component (no awaits)
│   │   └── page.tsx        # admin dashboard with stats
│   ├── auth/
│   │   ├── admin-login/
│   │   ├── login/
│   │   ├── pending/        # shown to unapproved users
│   │   └── register/
│   ├── dashboard/          # Resident section (protected by proxy.ts)
│   │   ├── announcements/
│   │   ├── bookings/
│   │   ├── broadcasts/
│   │   ├── events/
│   │   ├── gallery/
│   │   ├── profile/
│   │   ├── layout.tsx      # sync server component
│   │   └── page.tsx
│   ├── globals.css
│   ├── layout.tsx          # root layout + PWA metadata + Toaster
│   └── page.tsx            # root → redirects to /dashboard or /auth/login
├── components/
│   ├── layout/             # Sidebar, TopBar, MobileNav ('use client')
│   └── ui/                 # Button, Input, Modal
├── hooks/
│   └── useAuth.ts          # client-side auth + profile hook
├── lib/
│   ├── supabase.ts         # browser client factory
│   └── supabase-server.ts  # server component client factory
├── types/
│   └── index.ts            # Profile, Announcement, Event, Booking, ...
└── proxy.ts                # auth + role gating (was middleware.ts)

public/
├── manifest.json           # PWA manifest
└── icon-192.png, icon-512.png  (to be added)

supabase/
└── schema.sql              # tables, RLS policies, storage buckets
```

## Features

- **Auth**: email/password via Supabase, with an approval queue (`is_approved` flag on profile) and a separate admin login.
- **Role-based access**: `admin` vs `user`. All gating happens in `src/proxy.ts` (runs before page render).
- **Announcements** (admin posts, pinned support)
- **Events** with RSVPs
- **Facility bookings** (Clubhouse, Pool, Tennis, Badminton, Gym, Party Hall, Conference Room) with admin approval flow
- **Broadcasts** (admin-only community-wide messages)
- **Photo gallery** (any resident can upload)
- **Profile management** (name, flat number, vehicle, phone, avatar)
- **Admin panel**: stats dashboard, user management, updates, gallery moderation
- **PWA**: installable, brand-themed, offline-ready shell

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
