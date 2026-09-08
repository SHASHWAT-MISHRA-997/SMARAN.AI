import { test, expect } from '@playwright/test';

for (const width of [390, 792, 1440]) {
  test(`marketing website controls and layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 792 ? 375 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Keep test traffic out of production analytics and feedback stores.
    await page.route('https://smaran-analytics.netlify.app/**', route => route.fulfill({ json: {} }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.SMARAN_WEBSITE_AUDIT_URL || 'http://127.0.0.1:8028/');
    await expect(page.locator('#dlCliLinux')).toHaveAttribute('href', /smaran-linux-x86_64$/);
    await page.locator('#tb-lin').click();
    await expect(page.locator('#tp-lin')).toBeVisible();
    await expect(page.locator('#tp-win')).toBeHidden();
    await page.locator('#extToggle').click();
    await expect(page.locator('#extension-detail')).toBeVisible();
    await page.locator('#extToggle').click();
    await expect(page.locator('#extension-detail')).toBeHidden();
    await page.getByText('Do I need internet?', { exact: true }).click();
    await expect(page.locator('.faq details[open]')).toContainText('installed language packs');
    await page.locator('#themeToggle').click();
    const overflow = await page.evaluate(() => ({ width:innerWidth, scroll:document.documentElement.scrollWidth,
      elements:[...document.querySelectorAll('main *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0 && r.right>innerWidth+1;}).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right})).slice(0,15) }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(width + 1);
    await page.locator('#download h2').scrollIntoViewIfNeeded();
    await expect(page.locator('#download h2')).toBeInViewport();
    await expect(page.locator('#download .head')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `test-results/screenshots/website-audit-${width}.png` });
    expect(errors).toEqual([]);
  });
}
