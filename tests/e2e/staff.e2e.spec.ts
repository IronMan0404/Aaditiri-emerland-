import { test, expect, usingRole, skipUnlessRoleReady } from '../support/fixtures';

/**
 * E2E — Staff (security + housekeeping).
 *
 * The two staff sub-roles share `StaffHome.tsx`, so the assertions are
 * symmetric. Both should:
 *   - Land on their role-specific home,
 *   - See the bottom-nav with Home + Residents tabs,
 *   - Be able to navigate to /staff/residents and back,
 *   - NOT be able to reach /dashboard or /admin (proxy bounces).
 */

function staffSuite(roleId: 'staffSecurity' | 'staffHousekeeping', landing: string) {
  test.describe(`${roleId} core flows`, () => {
    skipUnlessRoleReady(roleId);
    test.use(usingRole(roleId));

    test(`lands on ${landing}`, async ({ page }) => {
      await page.goto('/staff');
      await expect(page).toHaveURL(new RegExp(`${landing.replace('/', '\\/')}(?:$|\\?)`));
      await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /residents/i })).toBeVisible();
    });

    test('residents directory loads with search', async ({ page }) => {
      await page.goto('/staff/residents');
      await expect(page).toHaveURL(/\/staff\/residents/);
      // The page has a search input — assert it's there. Don't assert
      // results (the test DB may be empty).
      await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    });

    test(`@cross-role ${roleId} is bounced from /dashboard`, async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page).toHaveURL(new RegExp(`${landing.replace('/', '\\/')}(?:$|\\?)`));
    });

    test(`@cross-role ${roleId} is bounced from /admin`, async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL(new RegExp(`${landing.replace('/', '\\/')}(?:$|\\?)`));
    });

    test(`@cross-role ${roleId} is bounced from /dashboard/announcements`, async ({ page }) => {
      await page.goto('/dashboard/announcements');
      await expect(page).toHaveURL(new RegExp(`${landing.replace('/', '\\/')}(?:$|\\?)`));
    });
  });
}

staffSuite('staffSecurity', '/staff/security');
staffSuite('staffHousekeeping', '/staff/housekeeping');
