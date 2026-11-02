import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests laufen gegen einen gestarteten Stack (docker compose up).
 * JOTION_E2E_URL überschreibt die Adresse, PW_CHROMIUM_PATH einen vorinstallierten Browser.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.JOTION_E2E_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    locale: 'de-DE',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
