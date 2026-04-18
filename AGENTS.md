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
- **Single documented exception**: `src/lib/supabase-admin.ts` exports a privileged client backed by `SUPABASE_SERVICE_ROLE_KEY`, used ONLY by `/api/admin/users/[id]/delete` to drop a row from `auth.users` (RLS does not apply to the auth schema). The factory imports `'server-only'` so it can never be bundled into the browser. Do not add new call sites without an equally strong justification — prefer a new RLS policy whenever possible.

### 7. Windows + WSL warning
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
