import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],
  // The example must be built with PREVIEW_PINS_AUTH_ORIGIN=http://localhost:8787
  // (`pnpm build:example:e2e`), and the worker with `pnpm build`.
  webServer: [
    {
      command: 'pnpm --filter @assuncaocharles/pinback-example preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/support/worker-server.mjs',
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
