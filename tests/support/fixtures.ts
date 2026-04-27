import { test as base, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { authStatePath } from './auth';
import { hasCredentials, type RoleId } from './credentials';

/**
 * Per-test fixtures.
 *
 *   `roleSkipIfNoCreds(role)` — call from a beforeAll/beforeEach hook to
 *   skip the test cleanly when the role's credentials weren't configured
 *   for this environment. Cleaner than wrapping every test in an `if`.
 *
 *   `usingRole(role)` — declarative helper that mounts the role's stored
 *   auth cookies onto the test's browser context. Typical usage:
 *
 *       test.use(usingRole('admin'));
 *
 * This file deliberately re-exports `expect` so test files only need a
 * single `import { test, expect } from '../support/fixtures'` line.
 */
export interface RoleFixtures {
  authedPage: Page;
}

export const test = base.extend<RoleFixtures>({
  authedPage: async ({ page }, use) => {
    await use(page);
  },
});

export { expect };

/**
 * Build a `use` block that points at the role's stored auth state.
 * Use it in `test.use(...)`. If the state file doesn't exist (creds not
 * configured, or login failed during global-setup) we fall back to no
 * storage — tests that rely on the role should also call
 * `skipUnlessRoleReady(role)` so they skip with a clear message instead
 * of failing because the user isn't actually authenticated.
 */
export function usingRole(role: RoleId): { storageState?: string } {
  const p = authStatePath(role);
  if (fs.existsSync(p)) return { storageState: p };
  return {};
}

/** Hard-skip a test when the role isn't usable in this environment. */
export function skipUnlessRoleReady(role: RoleId): void {
  test.beforeAll(() => {
    if (!hasCredentials(role)) {
      test.skip(true, `Credentials for "${role}" are not configured (set TEST_${role.toUpperCase()}_IDENTIFIER + _PASSWORD or add to tests/credentials.local.json).`);
    }
    if (!fs.existsSync(authStatePath(role))) {
      test.skip(true, `Stored auth state for "${role}" missing — global-setup likely failed for this role. Check the run log.`);
    }
  });
}
