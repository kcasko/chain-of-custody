// End-to-end browser tests for the local workspace and the Integrity Challenge.
// Starts its own demo server on a separate port so it never touches a server
// you already have running. Chromium only: this checks the app's behavior, not
// browser compatibility. Run with: npm run test:e2e

import { defineConfig, devices } from '@playwright/test';

const PORT = 4391;

export default defineConfig({
  testDir: 'app/e2e',
  // The server holds one in-memory case, so tests run one at a time and each
  // starts by resetting the demo data.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  outputDir: '.local/playwright-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node app/src/main.ts',
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
