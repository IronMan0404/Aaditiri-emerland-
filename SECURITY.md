# Security policy

## Reporting a vulnerability

Email the maintainer (private repo). Please do **not** open a public GitHub issue with details.

## Secrets management

This repo uses three classes of credentials. Each lives in **only two places**: `.env.local` (local dev, git-ignored) and Vercel's Project Settings → Environment Variables.

| Variable | Sensitivity | Where it goes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public — safe in client | `.env.local`, Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `…_PUBLISHABLE_KEY` | public — safe in client (RLS enforces row access) | same |
| `BREVO_API_KEY` | **secret** — must NEVER be in client bundles | `.env.local` (local), Vercel (server only) |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | low — verified sender info | same |
| `MSG91_AUTH_KEY` | **secret** | same |
| `MSG91_WHATSAPP_*` | low | same |

**`SUPABASE_SERVICE_ROLE_KEY` is intentionally not used anywhere in this codebase.** All access is governed by Row Level Security in `supabase/schema.sql`. If you find yourself reaching for the service role key, the right answer is almost always to add or fix an RLS policy.

## Things that must never happen

- ❌ Don't paste an API key into chat (with the AI assistant, in Slack, in a PR description, in an issue, in a screenshot).
- ❌ Don't commit `.env*` files. They're git-ignored.
- ❌ Don't add a key to a `NEXT_PUBLIC_*` variable. Anything prefixed `NEXT_PUBLIC_` is shipped to every browser.
- ❌ Don't rotate "later". Rotate immediately.

## Key-rotation runbook

If a key has been exposed in any way (chat history, screenshot, accidental commit, leaked log), rotate **before** doing anything else:

### Resend (no longer used in this app, but still applicable)
1. https://resend.com/api-keys → **Revoke** the exposed key.
2. **Create API Key** → copy.
3. Update `.env.local` and Vercel env vars.
4. Restart `npm run dev`; redeploy on Vercel.

### Brevo
1. https://app.brevo.com/security/api → click the trash icon next to the exposed key.
2. **Generate a new API key** → copy.
3. Update `BREVO_API_KEY` in `.env.local` and in Vercel.
4. Restart `npm run dev`; redeploy on Vercel.

### MSG91
1. MSG91 Panel → **API** → **Auth Keys** → revoke the leaked key.
2. Create a new one.
3. Update `MSG91_AUTH_KEY` everywhere; restart/redeploy.

### Supabase publishable/anon key
The publishable key is designed to be public, but if you need to rotate (e.g. you changed RLS and want a clean slate):
1. Supabase dashboard → **Project Settings → API → Reset key**.
2. Update `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` and Vercel.
3. Redeploy.

## Verifying the secret didn't leak into git history

```
git log --all --full-history -- .env.local
git log --all --pretty=oneline -S "your_key_fragment_here"
```

Both should print **nothing**. If either prints commits, the secret is in history and a force-push after `git filter-repo` is required. Ask before doing that.

## Verifying server-only modules stay server-only

Files that handle secrets (`src/lib/email.ts`, `src/lib/msg91.ts`) start with:

```ts
import 'server-only';
```

This is a Next.js mechanism — if any client component ever imports one of these by mistake, the build fails loudly. Don't remove the import.

## Past incidents (for transparency)

- **Resend key leaked twice in chat** during initial setup. Each was revoked the same day. Learning: switched to a flow where the key is pasted into `.env.local` and verified via the `/api/_debug/email-status` endpoint without ever appearing in a message body.

## Periodic audit

Suggested every 90 days:

- Rotate `BREVO_API_KEY` and `MSG91_AUTH_KEY` even if no incident.
- Check Vercel → Logs for unexpected env-var access patterns.
- Review Supabase RLS policies for any `using (true)` or overly-permissive conditions.
