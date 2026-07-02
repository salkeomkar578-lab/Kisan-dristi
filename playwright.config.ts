import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 5000 },
  use: {
    headless: true,
    baseURL: process.env.BASE_URL || 'http://localhost:5174',
    viewport: { width: 1280, height: 720 },
  },
});
