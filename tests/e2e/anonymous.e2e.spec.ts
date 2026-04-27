import { test, expect } from '../support/fixtures';

/**
 * E2E — Anonymous (unauthenticated) user.
 *
 * No stored auth state: this is the default. The test asserts every
 * gated route bounces back to /auth/login per the proxy.ts matcher.
 * Also covers the "wrong creds rejected" negative case so we know the
 * login form actually validates instead of silently dropping the user
 * onto /dashboard.
 */

test.describe('@cross-role anonymous user is gated by proxy', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ['/dashboard', '/dashboard/announcements', '/admin', '/admin/users', '/staff', '/staff/security']) {
    test(`GET ${path} → /auth/login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/login/);
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    });
  }

  test('login form rejects bad credentials with a toast', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/email or phone number/i).fill('not-a-real-user@example.com');
    await page.getByLabel(/password/i).fill('definitely-wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Either the toast surfaces the resolver "user not found" error or
    // Supabase rejects the password — both arrive as a toast text node.
    // We assert the URL stayed on /auth/login (the most reliable signal
    // that the sign-in failed) and that *some* error toast appeared.
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('div').filter({ hasText: /invalid|incorrect|not found|credentials/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('login form rejects empty submission', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('div').filter({ hasText: /please fill in all fields/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('client-side validation flags malformed identifier', async ({ page }) => {
    await page.goto('/auth/login');
    // 5-digit phone — too short. Resolver should never even be called.
    await page.getByLabel(/email or phone number/i).fill('12345');
    await page.getByLabel(/password/i).fill('whatever');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('div').filter({ hasText: /too short|valid email or phone|format not recognised/i }).first()).toBeVisible({ timeout: 5_000 });
  });
});
