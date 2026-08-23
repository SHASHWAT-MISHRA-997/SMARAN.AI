import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js --port 5173 --host 127.0.0.1',
    env: {
      VITE_API_TARGET: process.env.VITE_API_TARGET || 'http://127.0.0.1:3003',
    },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30 * 1000,
  },
});
