import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Load test env (gitignored). Optional — if missing, tests fall back to
// process.env (CI) and finally tests/credentials.local.json. See
// tests/support/credentials.ts for the lookup order.
dotenv.config({ path: path.resolve(__dirname, '.env.test.local') });

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests',

  // E2E suites are largely independent (they sign in via stored state),
  // so let Playwright parallelise. We cap workers in CI to keep the
  // login churn against the test Supabase project predictable.
  fullyParallel: true,
  workers: isCI ? 2 : undefined,

  // Fail the run if anyone left a `test.only` in the source tree —
  // that's the single most common way a green CI hides a real failure.
  forbidOnly: isCI,

  // One retry in CI to absorb transient network blips talking to
  // Supabase / external feeds. No retries locally — a flake is a bug.
  retries: isCI ? 1 : 0,

  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
    // Default to mobile viewport: this app is mobile-first and many
    // critical UI elements (bottom nav, hamburger sidebar) only exist
    // on small screens. Specific projects below override.
    viewport: { width: 390, height: 844 },
  },

  // Global setup signs every role in once and persists their auth
  // cookies under tests/.auth/<role>.json. Each test then reuses that
  // storageState — no test pays the login round-trip more than once.
  globalSetup: path.resolve(__dirname, 'tests/support/global-setup.ts'),

  projects: [
    // ── Smoke ────────────────────────────────────────────────
    // Auth-page renders + per-role landing-page sanity. Runs on
    // mobile Chromium only — same engine as the resident PWA.
    {
      name: 'smoke',
      testDir: 'tests/smoke',
      use: { ...devices['Pixel 7'] },
    },

    // ── E2E mobile (default) ─────────────────────────────────
    {
      name: 'e2e-mobile',
      testDir: 'tests/e2e',
      use: { ...devices['Pixel 7'] },
    },

    // ── E2E desktop ──────────────────────────────────────────
    // The admin dashboard and several /admin/* analytics pages
    // are explicitly desktop-optimised, so we cover them on a
    // larger viewport too.
    {
      name: 'e2e-desktop',
      testDir: 'tests/e2e',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      // Skip the resident-mobile-only flows on desktop — they
      // assert against the bottom nav which only renders on small
      // viewports. The grep keeps desktop focused on admin paths.
      grep: /@desktop|@cross-role/,
    },
  ],

  // Boot the Next.js dev server unless a test base URL is already
  // pointing somewhere live (e.g. a preview deployment).
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
