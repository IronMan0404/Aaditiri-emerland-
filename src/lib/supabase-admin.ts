import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Privileged Supabase client that bypasses RLS using the project's
 * service-role key. ONLY use this from server-side code (route handlers,
 * server actions, server components) and ONLY for operations that cannot
 * be expressed as a Row-Level-Security policy.
 *
 * Legitimate use cases (each one is justified individually in AGENTS.md):
 *   - Admin permanently deleting a user (auth.users row) — see
 *     /api/admin/users/[id]/delete.
 *   - Self-service registration that creates the user pre-confirmed,
 *     bypassing Supabase's built-in mailer's 2/hr rate limit — see
 *     /api/auth/register. We send our own welcome email via Brevo instead.
 *
 * Both touch the auth schema, which is not reachable from the regular
 * `@supabase/ssr` client at all.
 *
 * NEVER import this module from a `'use client'` component or any code
 * path that ships to the browser. The `server-only` import above will
 * fail the build if that ever happens.
 *
 * The key MUST live in `SUPABASE_SERVICE_ROLE_KEY` (un-prefixed so it's
 * never bundled into the client). Add it to .env.local for local dev and
 * to Vercel project env vars for production.
 */
export function createAdminSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (and Vercel) ' +
        'from Supabase Dashboard → Project Settings → API → service_role key.',
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminClientConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
