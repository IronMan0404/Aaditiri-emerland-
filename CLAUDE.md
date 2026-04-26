# Claude instructions for this repo

**Read `AGENTS.md` in this repo first — it is the source of truth for all project rules.** This file only adds Claude-specific guidance.

@AGENTS.md

## Specialized Agent Playbooks

When the task is role-specific, use:

- `agents/sre-agent.md` for incident response and reliability work
- `agents/testing-agent.md` for test planning and validation work
- `agents/code-review-agent.md` for severity-first code review work

## Quick context for Claude

- App: **Aaditri Emerland** — residential community PWA.
- Stack: **Next.js 16.2.4 (App Router, Turbopack) + React 19.2.4 + TypeScript 5 + Tailwind 4 + Supabase**.
- Auth/role gating: `src/proxy.ts` (not the layouts). Layouts are sync Server Components.
- Supabase clients: `@/lib/supabase` (browser), `@/lib/supabase-server` (server).
- PWA: `next-pwa` + `public/manifest.json`. Brand color `#1B5E20`.

## Top 5 things to check before writing code

1. **This is Next.js 16, not 14/15.** `middleware.ts` is now `proxy.ts`, the exported function is `proxy`. Async Server Component layouts must not call `redirect()`.
2. **Don't reintroduce async + `redirect()` in `admin/layout.tsx` or `dashboard/layout.tsx`.** It crashes Turbopack dev tracing.
3. **Gate client-side dynamic values on `mounted`** from `useAuth()`. Otherwise you'll create hydration mismatches.
4. **Never use the Supabase service-role key.** RLS policies in `supabase/schema.sql` enforce access.
5. **Windows + WSL dev conflict**: don't run `next dev` from WSL on a `/mnt/c/...` path.

## How to operate in this repo

- Explore with `Grep` / `Read` before editing (the code is small but interconnected through `useAuth`, `proxy.ts`, and RLS).
- When adding a feature, check `src/types/index.ts` first — the type you need probably already exists.
- When adding a route under `/admin/*` or `/dashboard/*`, you do NOT need to add auth checks in the page — `proxy.ts` handles it.
- When adding a new DB table, update **both** `supabase/schema.sql` (schema + RLS) and `src/types/index.ts`.

## When in doubt

- `AGENTS.md` → project rules (authoritative).
- `README.md` → overview, features, structure.
- `DEPLOYMENT.md` → Supabase + Vercel setup, troubleshooting.
- `docs/NEWS.md` → architecture of the `/dashboard/news` section (9 API routes, geolocation, security, mobile UX). Read before touching anything under `src/app/api/news/` or `src/components/news/`.
- `node_modules/next/dist/docs/` → Next.js 16 API reference.
