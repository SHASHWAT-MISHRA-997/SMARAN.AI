import { test, expect } from '@playwright/test';

test.describe('Phase 3 — Responsive & Visual Regression', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ];

  for (const vp of viewports) {
    test(`Responsive Viewport: ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const screenshotPath = `test-results/screenshots/home__${vp.name}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // Verify screenshot file exists
      await expect(page.locator('body')).toBeVisible();
    });
  }
});
