# Functional Tests — Aaditri Emerland

End-to-end and smoke tests for the resident PWA, the admin console, and
the staff portal. Powered by [Playwright](https://playwright.dev).

## Layout

```
tests/
├── smoke/                    # Fast: <60s. Runs on PRs.
│   ├── auth-pages.smoke.spec.ts        Public auth pages render
│   └── role-landing.smoke.spec.ts      Each role's home page renders
├── e2e/                      # Functional flows, per role.
│   ├── anonymous.e2e.spec.ts           Proxy gating + bad-creds path
│   ├── resident.e2e.spec.ts            Approved resident
│   ├── resident-pending.e2e.spec.ts    Unapproved resident → /auth/pending
│   ├── admin.e2e.spec.ts               Admin console
│   └── staff.e2e.spec.ts               Security + Housekeeping (parameterised)
├── support/
│   ├── credentials.ts                  Env-vars-then-JSON resolver
│   ├── auth.ts                         Sign-in helpers + role landing patterns
│   ├── fixtures.ts                     `usingRole`, `skipUnlessRoleReady`
│   └── global-setup.ts                 Pre-authenticates every role once
├── .auth/                    # Stored auth cookies per role (gitignored)
└── credentials.example.json  # Template for local JSON creds
```

## Roles covered

| Role | How it signs in | Where it lands | Notes |
|---|---|---|---|
| `admin` | `/auth/admin-login` (email) | `/admin` | `profiles.role='admin'` |
| `resident` | `/auth/login` (email or phone) | `/dashboard` | approved resident |
| `residentPending` | `/auth/login` | `/auth/pending` | proxy redirects unapproved users |
| `staffSecurity` | `/auth/login` | `/staff/security` | `staff_role='security'` |
| `staffHousekeeping` | `/auth/login` | `/staff/housekeeping` | `staff_role='housekeeping'` |
| _anonymous_ | n/a | `/auth/login` | unauthenticated; tested against every gated route |

## Credentials

The resolver in `tests/support/credentials.ts` looks up creds in this order:

1. **Environment variables** (preferred for CI and shared environments):
   - `TEST_ADMIN_IDENTIFIER`, `TEST_ADMIN_PASSWORD`
   - `TEST_RESIDENT_IDENTIFIER`, `TEST_RESIDENT_PASSWORD`
   - `TEST_RESIDENT_PENDING_IDENTIFIER`, `TEST_RESIDENT_PENDING_PASSWORD` (optional)
   - `TEST_STAFF_SECURITY_IDENTIFIER`, `TEST_STAFF_SECURITY_PASSWORD`
   - `TEST_STAFF_HOUSEKEEPING_IDENTIFIER`, `TEST_STAFF_HOUSEKEEPING_PASSWORD`
   - `_FULL_NAME` and `_FLAT_NUMBER` are optional, used only by some assertions.
   - `.env.test.local` (gitignored) is auto-loaded for local dev — copy
     `.env.test.local.example` and edit.
2. **`tests/credentials.local.json`** (gitignored) — convenient JSON
   alternative for solo local dev. Copy `tests/credentials.example.json`
   to `tests/credentials.local.json` and fill in real values. Env vars
   override the JSON when both are set.

If neither source has a value, tests for that role **skip cleanly with a
clear message** rather than failing or reusing stale state.

## Running tests

First-time setup (per machine):

```bash
# Install Playwright browsers (Chromium only — what our app supports).
npm run test:install
```

Then either:

```bash
# Start dev server in one terminal:
npm run dev

# Run smoke (fast, ~60s):
npm run test:smoke

# Run full e2e suite (mobile + desktop projects):
npm run test:e2e

# Mobile only / desktop only:
npm run test:e2e:mobile
npm run test:e2e:desktop

# Interactive debugging UI:
npm run test:e2e:ui

# View the last HTML report:
npm run test:report
```

The Playwright config will auto-start `npm run dev` if no test base URL
is set; alternatively run against a deployment by setting
`TEST_BASE_URL=https://your-preview.vercel.app`.

## How role authentication works

`tests/support/global-setup.ts` runs once before any test. For each role
whose creds resolve, it:

1. Opens a clean browser context,
2. Drives the appropriate sign-in form,
3. Waits for the proxy to settle on the role's home page,
4. Persists the resulting cookies + storage to `tests/.auth/<role>.json`.

Each test then declares which role's stored state it wants:

```ts
import { test, expect, usingRole, skipUnlessRoleReady } from '../support/fixtures';

test.describe('admin flow', () => {
  skipUnlessRoleReady('admin');
  test.use(usingRole('admin'));

  test('…', async ({ page }) => {
    await page.goto('/admin');
    // already authenticated as admin
  });
});
```

This means each test pays the login cost zero times in steady state.
`residentPending` and the anonymous suite are exceptions — they sign in
live (or use no state) so the test exercises the redirect.

## Tags

Tests use Playwright tag annotations (`@smoke`, `@desktop`, `@cross-role`)
in the test title. The desktop project filters with
`grep: /@desktop|@cross-role/` so the resident mobile-only flows don't
run on desktop. To run all tests with a tag:

```bash
npx playwright test --grep @cross-role
```

## CI

These tests aren't wired into `.github/workflows/ci.yml` yet — they need
a live test Supabase project + seeded test users to be useful, and
that's an environment-level decision. To enable:

1. Create a dedicated test Supabase project (or reuse staging).
2. Seed it with one user per role (admin, approved resident,
   optionally a pending resident, security staff, housekeeping staff).
3. Add the `TEST_*_IDENTIFIER` / `TEST_*_PASSWORD` values as GitHub
   repository secrets.
4. Add a job to `ci.yml`:

   ```yaml
   e2e:
     name: Functional tests
     runs-on: ubuntu-latest
     timeout-minutes: 20
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version-file: .nvmrc
           cache: npm
       - run: npm ci --no-audit --no-fund
       - run: npx playwright install --with-deps chromium
       - run: npm run build
       - run: npm run test:e2e
         env:
           NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
           NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
           TEST_ADMIN_IDENTIFIER: ${{ secrets.TEST_ADMIN_IDENTIFIER }}
           TEST_ADMIN_PASSWORD: ${{ secrets.TEST_ADMIN_PASSWORD }}
           TEST_RESIDENT_IDENTIFIER: ${{ secrets.TEST_RESIDENT_IDENTIFIER }}
           TEST_RESIDENT_PASSWORD: ${{ secrets.TEST_RESIDENT_PASSWORD }}
           TEST_STAFF_SECURITY_IDENTIFIER: ${{ secrets.TEST_STAFF_SECURITY_IDENTIFIER }}
           TEST_STAFF_SECURITY_PASSWORD: ${{ secrets.TEST_STAFF_SECURITY_PASSWORD }}
           TEST_STAFF_HOUSEKEEPING_IDENTIFIER: ${{ secrets.TEST_STAFF_HOUSEKEEPING_IDENTIFIER }}
           TEST_STAFF_HOUSEKEEPING_PASSWORD: ${{ secrets.TEST_STAFF_HOUSEKEEPING_PASSWORD }}
       - uses: actions/upload-artifact@v4
         if: always()
         with:
           name: playwright-report
           path: playwright-report/
           retention-days: 7
   ```

## Adding a new test

- Pick the right folder: `smoke/` for must-pass-on-every-PR sanity,
  `e2e/` for behaviour.
- Use the role fixtures — don't sign in manually unless your test is
  specifically about the sign-in UX.
- Prefer accessible queries (`getByRole`, `getByLabel`) over CSS
  selectors so refactors don't silently break tests.
- Don't assert on dynamic copy (greetings, dates, dynamic counts) —
  assert on routes, role-stable controls, and structural elements.
- Tag desktop-only tests with `@desktop` so they run on the desktop
  project but skip on mobile. Tag cross-role redirect tests with
  `@cross-role` so they run on both viewports.

## Residual risk

- The auth flow tests cover happy paths plus the "wrong creds" path,
  but don't exercise OTP / Telegram pairing / forgot-password — those
  need external services and seed data outside the scope here.
- Booking creation, fund contribution, and clubhouse-pass mint flows
  have not been added — they require admin + resident interaction
  (booking → admin approves) which is best modelled as a separate
  `multi-role.e2e.spec.ts` test using two browser contexts.
- Push notifications and Telegram dispatch are intentionally out of
  scope — they're tested at the API layer.
