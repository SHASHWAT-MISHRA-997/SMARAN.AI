import { test, expect } from '@playwright/test';

test.use({
  userAgent: 'Mozilla/5.0 (Linux; Android 16; CPH2573) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
});

for (const viewport of [{ width: 390, height: 844 }, { width: 792, height: 360 }, { width: 667, height: 375 }]) {
  test(`phone controls remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('chat-composer')).toBeVisible();
    await expect(page.getByTestId('performance-panel')).toHaveCount(0);
    const menu = page.getByRole('button', { name: 'Open navigation menu' });
    await menu.click();
    await expect(page.locator('.sidebar-mobile-backdrop')).toBeVisible();
    await page.locator('.sidebar-mobile-backdrop').click({ position: { x: viewport.width - 8, y: 100 } });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.locator('#smaran-mobile-navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Appearance & Theme', { exact: true })).toBeVisible();
    await expect(page.getByText('Sidebar Position', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Hardware Performance Panel', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    const controls = [page.getByRole('button', { name: 'Dictate', exact: true })];
    if (viewport.width > viewport.height) {
      controls.push(page.getByRole('button', { name: 'Speak', exact: true }), page.getByRole('button', { name: 'Compare', exact: true }), page.locator('.composer-desktop-right').getByLabel('Reply language'));
      expect((await page.locator('.composer-input textarea').boundingBox()).width).toBeGreaterThan(150);
    }
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({ path: `test-results/screenshots/phone-controls-${viewport.width}.png` });
  });
}
