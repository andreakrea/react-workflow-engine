import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the demo built from the local source.
 * `npm run e2e` builds the package and the demo, serves it, and runs Chromium.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/react-workflow-engine/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: {
    command: 'npm --prefix demo run build && npm --prefix demo run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/react-workflow-engine/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
