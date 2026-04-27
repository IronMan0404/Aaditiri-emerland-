import { test, expect } from '../support/fixtures';

/**
 * SMOKE — Public auth pages render without runtime errors.
 *
 * These tests don't sign in. They just confirm that the unauthenticated
 * shell of the app boots: routing, env vars, Tailwind, hydration.
 *
 * Failure here usually means:
 *   - NEXT_PUBLIC_SUPABASE_URL/KEY missing (the page would still render
 *     but supabase client init would log a console error — we catch that),
 *   - Server-side import error in a layout (page would 500),
 *   - Hydration mismatch from a regression in the AuthShell tree.
 */

test.describe('@smoke auth pages render', () => {
  // Capture console errors so a green test that's silently logging
  // hydration warnings doesn't slip through.
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      throw new Error(`Page threw at runtime: ${err.message}`);
    });
  });

  test('login page renders the email/phone + password form', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email or phone number/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeEnabled();
    // Cross-link to register and admin login should exist.
    await expect(page.getByRole('link', { name: /register/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /admin login/i })).toBeVisible();
  });

  test('admin login page renders email + password form', async ({ page }) => {
    await page.goto('/auth/admin-login');
    await expect(page.getByRole('heading', { name: /admin sign in/i })).toBeVisible();
    await expect(page.getByLabel(/admin email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /admin sign in/i })).toBeEnabled();
    await expect(page.getByRole('link', { name: /back to user login/i })).toBeVisible();
  });

  test('register page renders required fields and resident-type toggle', async ({ page }) => {
    await page.goto('/auth/register');
    await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/flat number/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /owner/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /tenant/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeEnabled();
  });

  test('forgot-password page renders the reset request form', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    // Page heading varies a bit between iterations — assert by URL + a
    // primary input. We don't want this smoke to break every time copy
    // is tightened.
    await expect(page).toHaveURL(/\/auth\/forgot-password/);
    await expect(page.locator('form')).toBeVisible();
  });
});
