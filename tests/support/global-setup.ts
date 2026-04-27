import { chromium, type FullConfig, request as pwRequest } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { hasCredentials, type RoleId } from './credentials';
import {
  authStatePath,
  ROLE_LANDING,
  signInAsAdmin,
  signInAsResidentOrStaff,
} from './auth';
import { getCredentials } from './credentials';

// Roles we want pre-authenticated state for. Pending and anonymous are
// excluded — pending is asserted in-test (we want to confirm the redirect
// actually happens), anonymous is the default unauthenticated state.
const PRE_AUTH_ROLES: RoleId[] = [
  'admin',
  'resident',
  'staffSecurity',
  'staffHousekeeping',
];

/**
 * Pre-flight: hit baseURL and bail out fast with a friendly error if the
 * dev server isn't reachable. Without this, every individual test would
 * time out for 30s with a stack trace that doesn't tell you the root cause.
 */
async function assertServerReachable(baseURL: string): Promise<void> {
  const ctx = await pwRequest.newContext();
  try {
    const res = await ctx.get(baseURL, { timeout: 15_000 });
    if (res.status() >= 500) {
      throw new Error(
        `Dev server at ${baseURL} returned HTTP ${res.status()}. Check that NEXT_PUBLIC_SUPABASE_URL / KEY are set in .env.local.`,
      );
    }
  } catch (err) {
    throw new Error(
      `Could not reach test base URL ${baseURL}: ${(err as Error).message}. ` +
        `Start the app with \`npm run dev\` (or set TEST_BASE_URL to a running deployment) and retry.`,
    );
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ?? process.env.TEST_BASE_URL ?? 'http://localhost:3000';
  await assertServerReachable(baseURL);

  const authDir = path.resolve(__dirname, '..', '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  // Sign each available role in once. Skip roles whose creds aren't
  // configured — the corresponding tests will skip themselves at runtime
  // (see the role fixtures). This way a partial-creds setup (e.g. just
  // admin + resident) still produces a green baseline.
  const browser = await chromium.launch();
  try {
    for (const role of PRE_AUTH_ROLES) {
      if (!hasCredentials(role)) {
        console.warn(`[global-setup] Skipping role "${role}" — credentials not configured.`);
        continue;
      }
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      const creds = getCredentials(role);
      try {
        if (role === 'admin') {
          await signInAsAdmin(page, creds);
        } else {
          await signInAsResidentOrStaff(page, creds);
        }
        await page.waitForURL(ROLE_LANDING[role], { timeout: 30_000 });
        await ctx.storageState({ path: authStatePath(role) });
        console.log(`[global-setup] ✓ Stored auth state for "${role}".`);
      } catch (err) {
        // Don't blow up the whole run if one role fails — log clearly so
        // the dev sees which role's seed user is broken, and let
        // role-tagged tests skip themselves.
        console.error(
          `[global-setup] ✗ Failed to sign in as "${role}": ${(err as Error).message}`,
        );
        // Remove a stale state file so role-fixtures don't accidentally
        // reuse a previous run's cookies.
        const p = authStatePath(role);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}
