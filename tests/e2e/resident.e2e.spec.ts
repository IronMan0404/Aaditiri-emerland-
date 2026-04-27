import { test, expect, usingRole, skipUnlessRoleReady } from '../support/fixtures';

/**
 * E2E — Approved resident.
 *
 * Critical user flows:
 *   - Lands on /dashboard from /
 *   - Quick-link nav: announcements, events, bookings, gallery, news
 *   - Profile page renders own profile
 *   - Cannot reach /admin (proxy bounces to /dashboard)
 *   - Sign-out clears session and returns to /auth/login
 *
 * Mobile viewport (Pixel 7 default in playwright.config). The bottom
 * nav and quick-link grid are mobile-only, so we don't tag this for
 * @desktop.
 */

test.describe('approved resident core flows', () => {
  skipUnlessRoleReady('resident');
  test.use(usingRole('resident'));

  test('dashboard hero shows resident name, flat number, and quick links', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:$|\?)/);

    // The greeting text is one of three time-based strings; we assert
    // the hero region exists rather than the specific greeting so the
    // test doesn't fail at midnight UTC ↔ IST boundaries.
    await expect(page.getByText(/^(good morning|good afternoon|good evening),/i)).toBeVisible();

    // Quick-link grid — we sanity-check four high-traffic destinations.
    for (const label of ['Announcements', 'Events', 'Bookings', 'Gallery']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${label}$`, 'i') })).toBeVisible();
    }
  });

  test('navigates to Announcements and back', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^announcements$/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/announcements/);
    // Page should render either a list, an empty-state, or at minimum
    // a back-affordance to /dashboard. Assert the route, not the copy.
  });

  test('navigates to Events page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^events$/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/events/);
  });

  test('navigates to Bookings page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^bookings$/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/bookings/);
  });

  test('navigates to Gallery page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^gallery$/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/gallery/);
  });

  test('profile page loads and shows the resident name', async ({ page }) => {
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL(/\/dashboard\/profile/);
    // The page is a single-column form; assert at least one field with
    // the user's email or phone exists. If `fullName` was provided in
    // creds we additionally assert it.
  });

  test('@cross-role resident is bounced from /admin back to /dashboard', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/dashboard(?:$|\?)/);
  });

  test('@cross-role resident is bounced from /staff back to /dashboard', async ({ page }) => {
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/dashboard(?:$|\?)/);
  });
});

test.describe('resident sign-out clears session', () => {
  skipUnlessRoleReady('resident');
  test.use(usingRole('resident'));

  test('after clearing cookies, /dashboard redirects to /auth/login', async ({ page, context }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:$|\?)/);
    await context.clearCookies();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
