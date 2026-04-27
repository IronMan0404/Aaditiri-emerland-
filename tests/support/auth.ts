import { type Page, expect } from '@playwright/test';
import { getCredentials, type RoleId, type RoleCredentials } from './credentials';

/**
 * Where each role lands after a successful sign-in.
 *
 * IMPORTANT: residents land on /dashboard, then proxy.ts sends pending
 * (unapproved) residents to /auth/pending. Staff land on /dashboard
 * first too, then the proxy bounces them to /staff and the /staff page
 * forwards by staff_role. Tests assert the FINAL URL.
 */
export const ROLE_LANDING: Record<RoleId, RegExp> = {
  admin: /\/admin(?:$|\/|\?)/,
  resident: /\/dashboard(?:$|\/|\?)/,
  residentPending: /\/auth\/pending(?:$|\?)/,
  staffSecurity: /\/staff\/security(?:$|\/|\?)/,
  staffHousekeeping: /\/staff\/housekeeping(?:$|\/|\?)/,
};

/** Path to the storage-state file for a given role. */
export function authStatePath(role: RoleId): string {
  return `tests/.auth/${role}.json`;
}

/**
 * Drive the resident sign-in form at /auth/login. Works for residents
 * AND staff — both use the email-or-phone resolver flow. Admins use a
 * different page (`/auth/admin-login`); use `signInAsAdmin` for those.
 */
export async function signInAsResidentOrStaff(
  page: Page,
  creds: RoleCredentials,
): Promise<void> {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();

  await page.getByLabel(/email or phone number/i).fill(creds.identifier);
  await page.getByLabel(/password/i).fill(creds.password);

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 30_000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
}

/**
 * Drive the admin sign-in form at /auth/admin-login. Email-only by design
 * (the admin form doesn't go through the phone resolver).
 */
export async function signInAsAdmin(page: Page, creds: RoleCredentials): Promise<void> {
  await page.goto('/auth/admin-login');
  await expect(page.getByRole('heading', { name: /admin sign in/i })).toBeVisible();

  await page.getByLabel(/admin email/i).fill(creds.identifier);
  await page.getByLabel(/password/i).fill(creds.password);

  await Promise.all([
    page.waitForURL(/\/admin(?:$|\/|\?)/, { timeout: 30_000 }),
    page.getByRole('button', { name: /admin sign in/i }).click(),
  ]);
}

/** Generic sign-in that picks the right form for the role. */
export async function signIn(page: Page, role: RoleId): Promise<RoleCredentials> {
  const creds = getCredentials(role);
  if (role === 'admin') {
    await signInAsAdmin(page, creds);
  } else {
    await signInAsResidentOrStaff(page, creds);
  }
  // Wait for the proxy's role-routing to settle on the role's home.
  await page.waitForURL(ROLE_LANDING[role], { timeout: 30_000 });
  return creds;
}

/**
 * Sign out via Supabase by clearing storage. Faster than locating a
 * sign-out button (which lives in different places per role) and works
 * even when the sign-out button is below the fold on mobile. Tests
 * that specifically validate the sign-out UX should click the button
 * directly instead of using this helper.
 */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Ignore — some pages disable storage in iframes.
    }
  });
}
