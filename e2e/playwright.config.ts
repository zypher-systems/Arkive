import { defineConfig, devices } from '@playwright/test';

// Arkive end-to-end suite. Runs against an already running stack, e.g.
//   ARKIVE_SETUP_TOKEN=e2e-setup-token ARKIVE_TRUSTED_PROXIES=... docker compose up -d --wait
//   ARKIVE_E2E_URL=http://localhost:3080 ARKIVE_SETUP_TOKEN=e2e-setup-token npx playwright test
// See README "Testing" (or `make e2e`) for the full recipe.

const baseURL = process.env.ARKIVE_E2E_URL || 'http://localhost:3080';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'chromium',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
    // Screenshots of the main screens for a visual check (visual/screens.spec.ts);
    // only when ARKIVE_E2E_SCREENS names an output directory.
    ...(process.env.ARKIVE_E2E_SCREENS
      ? [{ name: 'screens', testDir: './visual', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }]
      : []),
  ],
});
