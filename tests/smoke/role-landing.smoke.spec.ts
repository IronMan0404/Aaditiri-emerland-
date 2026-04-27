import { test, expect, usingRole, skipUnlessRoleReady } from '../support/fixtures';

/**
 * SMOKE — Each role's stored auth state lands on the correct home page
 * and shows the role-specific shell. Doesn't perform any further
 * navigation; that's covered by the e2e suite.
 *
 * If the smoke fails for a role, the e2e tests for that role will be
 * a waste of time — fix the seed user / RLS / proxy first.
 */

test.describe('@smoke admin lands on /admin shell', () => {
  skipUnlessRoleReady('admin');
  test.use(usingRole('admin'));

  test('admin dashboard renders stat cards and quick actions @cross-role', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin(?:$|\?)/);
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible();
    await expect(page.getByText(/aaditri emerland management/i)).toBeVisible();
    // At least one quick action should always exist.
    await expect(page.getByRole('link', { name: /manage users/i })).toBeVisible();
  });
});

test.describe('@smoke approved resident lands on /dashboard', () => {
  skipUnlessRoleReady('resident');
  test.use(usingRole('resident'));

  test('dashboard renders quick links and greeting', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:$|\?)/);
    // Greeting text is dynamic ("Good Morning"/"Good Afternoon"/"Good
    // Evening") so we only assert the role-stable Quick Links.
    await expect(page.getByRole('link', { name: /announcements/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /events/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /bookings/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /gallery/i })).toBeVisible();
  });
});

test.describe('@smoke security staff lands on /staff/security', () => {
  skipUnlessRoleReady('staffSecurity');
  test.use(usingRole('staffSecurity'));

  test('security shell renders', async ({ page }) => {
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/staff\/security(?:$|\?)/);
    // The staff layout always renders the bottom nav with "Home" and
    // "Residents" tabs (StaffTabs.tsx).
    await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /residents/i })).toBeVisible();
  });
});

test.describe('@smoke housekeeping staff lands on /staff/housekeeping', () => {
  skipUnlessRoleReady('staffHousekeeping');
  test.use(usingRole('staffHousekeeping'));

  test('housekeeping shell renders', async ({ page }) => {
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/staff\/housekeeping(?:$|\?)/);
    await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /residents/i })).toBeVisible();
  });
});
