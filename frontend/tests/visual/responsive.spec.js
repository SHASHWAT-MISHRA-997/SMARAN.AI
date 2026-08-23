import { test, expect } from '@playwright/test';

test.describe('Responsive layout regression matrix', () => {
  const viewports = [
    { name: 'phone-compact', width: 320, height: 568 },
    { name: 'phone-standard', width: 375, height: 667 },
    { name: 'phone-tall', width: 390, height: 844 },
    { name: 'phone-landscape', width: 844, height: 390 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'split-window', width: 950, height: 900 },
    { name: 'tablet-landscape', width: 1024, height: 768 },
    { name: 'laptop', width: 1280, height: 720 },
    { name: 'desktop', width: 1440, height: 900 },
  ];

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('sm_auth_logged_out');
      localStorage.setItem('smaran_ai_device_id', 'responsive-test-device');
      localStorage.setItem('smaran_ai_device_fingerprint', 'responsive-test-fingerprint');
      localStorage.setItem('showRightPanel', 'true');
      localStorage.setItem('sm_performance_position', 'right');
    });
  });

  for (const vp of viewports) {
    test(`${vp.name} ${vp.width}x${vp.height} stays readable and bounded`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const composer = page.getByTestId('chat-composer');
      const panel = page.getByTestId('performance-panel');
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await expect(panel).toBeVisible({ timeout: 20_000 });

      const pageOverflow = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(pageOverflow.documentWidth).toBeLessThanOrEqual(vp.width + 1);
      expect(pageOverflow.bodyWidth).toBeLessThanOrEqual(vp.width + 1);

      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox.x).toBeGreaterThanOrEqual(-1);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(vp.width + 1);
      expect(panelBox.y).toBeGreaterThanOrEqual(-1);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(vp.height + 1);
      if (vp.width < 768) {
        expect(panelBox.width).toBeGreaterThanOrEqual(vp.width - 2);
        expect(panelBox.y + panelBox.height).toBeGreaterThanOrEqual(vp.height - 2);
      } else {
        expect(panelBox.width).toBeGreaterThanOrEqual(330);
        expect(panelBox.width).toBeLessThanOrEqual(400);
        expect(panelBox.height).toBeGreaterThanOrEqual(vp.height - 2);
      }

      const panelOverflow = await panel.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(panelOverflow.scrollWidth).toBeLessThanOrEqual(panelOverflow.width + 1);

      const panelScroll = panel.locator('.performance-scroll');
      await expect(panelScroll).toBeVisible();
      const scrollState = await panelScroll.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(scrollState.clientHeight).toBeGreaterThan(0);
      expect(['auto', 'scroll']).toContain(scrollState.overflowY);

      await page.screenshot({
        path: `test-results/screenshots/home__${vp.name}.png`,
        fullPage: false,
      });

      await panel.getByRole('button', { name: 'Close performance panel' }).click();
      await expect(panel).toBeHidden();
      const composerBox = await composer.boundingBox();
      expect(composerBox).not.toBeNull();
      expect(composerBox.x).toBeGreaterThanOrEqual(-1);
      expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(vp.width + 1);
      const composerOverflow = await composer.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(composerOverflow.scrollWidth).toBeLessThanOrEqual(composerOverflow.width + 1);
    });
  }

  test('panel survives portrait-to-landscape resize without reloading', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const panel = page.getByTestId('performance-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(845);
    expect(box.y + box.height).toBeLessThanOrEqual(391);
  });
});
