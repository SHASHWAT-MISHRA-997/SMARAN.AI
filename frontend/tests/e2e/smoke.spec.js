import { test, expect } from '@playwright/test';

test.describe('Phase 3 — Smoke & Network Tests', () => {
  test('Smoke: Main page loads with HTTP 200 and no unhandled console errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        msg.type() === 'error' &&
        !text.includes('favicon') &&
        !text.includes('Failed to load resource') &&
        !text.includes('WebSocket') &&
        !text.includes('ws://') &&
        !text.includes('telemetry')
      ) {
        consoleErrors.push(text);
      }
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);

    // Wait for the app container to render
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('domcontentloaded');

    // Assert branding or main elements are in the DOM
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(10);

    expect(consoleErrors).toEqual([]);
  });

  test('Network: Core static assets load with no 4xx/5xx errors', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (response) => {
      const url = response.url();
      if (response.status() >= 400 && !url.includes('/api/') && !url.includes('/ws/')) {
        failedRequests.push({ url, status: response.status() });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(failedRequests).toEqual([]);
  });
});
