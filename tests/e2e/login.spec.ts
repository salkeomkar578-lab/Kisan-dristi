import { test, expect } from '@playwright/test';

test('login page loads', async ({ page, baseURL }) => {
  await page.goto('/login');
  await expect(page.locator('text=Sign in')).toBeVisible();
});
