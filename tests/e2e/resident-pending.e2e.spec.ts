import { test, expect } from '../support/fixtures';
import { signInAsResidentOrStaff } from '../support/auth';
import { getCredentials, hasCredentials } from '../support/credentials';

/**
 * E2E — Pending (unapproved) resident.
 *
 * The proxy sends an authenticated user with role='user' AND
 * is_approved=false to /auth/pending whenever they hit /dashboard. We
 * deliberately don't pre-store this role's auth state in global-setup —
 * instead we sign in live so the test asserts the post-login redirect
 * happens correctly.
 *
 * Skip cleanly if the environment doesn't have a pending seed user.
 */

test.describe('pending resident is gated to /auth/pending', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (!hasCredentials('residentPending')) {
      testInfo.skip(true, 'TEST_RESIDENT_PENDING_IDENTIFIER / _PASSWORD not configured.');
    }
  });

  // No stored auth state — sign in fresh.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login redirects to /auth/pending', async ({ page }) => {
    const creds = getCredentials('residentPending');
    await signInAsResidentOrStaff(page, creds);
    // The post-login redirect goes to /dashboard, then proxy bounces to
    // /auth/pending. Wait for the final URL.
    await page.waitForURL(/\/auth\/pending/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /approval pending/i })).toBeVisible();
  });

  test('@cross-role pending user cannot access /dashboard', async ({ page }) => {
    const creds = getCredentials('residentPending');
    await signInAsResidentOrStaff(page, creds);
    await page.waitForURL(/\/auth\/pending/, { timeout: 30_000 });
    await page.goto('/dashboard/announcements');
    await expect(page).toHaveURL(/\/auth\/pending/);
  });

  test('pending page exposes a sign-out button', async ({ page }) => {
    const creds = getCredentials('residentPending');
    await signInAsResidentOrStaff(page, creds);
    await page.waitForURL(/\/auth\/pending/, { timeout: 30_000 });
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
