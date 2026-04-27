import { test, expect, usingRole, skipUnlessRoleReady } from '../support/fixtures';

/**
 * E2E — Admin.
 *
 * The admin dashboard is a Server Component that runs queries against
 * Supabase to count residents/announcements/etc. We assert:
 *   - The shell renders without throwing,
 *   - Every quick-action link is reachable,
 *   - Admin-only routes do not 404 (proxy lets them through).
 *
 * Tagged @desktop because /admin/* pages are explicitly desktop-
 * optimised — analytics tables and the kanban issues board don't fit
 * a 390px viewport.
 */

test.describe('@desktop admin core flows', () => {
  skipUnlessRoleReady('admin');
  test.use(usingRole('admin'));

  test('admin dashboard renders stats and quick actions', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin(?:$|\?)/);
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible();
    // Quick action labels (admin/page.tsx).
    for (const label of [
      'Manage Users',
      'Bot Messages',
      'Community Updates',
      'Review Bookings',
      'Post Announcement',
      'Send Broadcast',
      'Create Event',
      'Audit Log',
      'Manage Funds',
      'Association Tags',
    ]) {
      await expect(page.getByRole('link', { name: new RegExp(label, 'i') })).toBeVisible();
    }
  });

  test('Manage Users navigates to /admin/users', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: /manage users/i }).click();
    await expect(page).toHaveURL(/\/admin\/users/);
  });

  test('Audit Log navigates to /admin/audit', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: /audit log/i }).click();
    await expect(page).toHaveURL(/\/admin\/audit/);
  });

  test('Manage Funds navigates to /admin/funds', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: /manage funds/i }).click();
    await expect(page).toHaveURL(/\/admin\/funds/);
  });

  test('admin can also reach /dashboard (admins see the resident view)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:$|\?)/);
    // The hero shows an "Admin Dashboard →" pill linking back to /admin
    // when isAdmin is true.
    await expect(page.getByRole('link', { name: /admin dashboard/i })).toBeVisible();
  });

  test('@cross-role admin is bounced from /staff routes', async ({ page }) => {
    await page.goto('/staff');
    // Per proxy.ts, non-staff users hitting /staff go to /admin (admin)
    // or /dashboard (resident). Admin is the case here.
    await expect(page).toHaveURL(/\/admin(?:$|\?)/);
  });
});

test.describe('@desktop admin sign-out', () => {
  skipUnlessRoleReady('admin');
  test.use(usingRole('admin'));

  test('clearing cookies revokes /admin access', async ({ page, context }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin(?:$|\?)/);
    await context.clearCookies();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
