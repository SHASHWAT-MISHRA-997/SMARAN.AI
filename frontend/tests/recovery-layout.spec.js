import { test, expect } from '@playwright/test';
for (const width of [320, 390, 1280]) {
  test(`recovery and registration fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({width, height: 720});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({providers: [], questions: ['What was the name of your first school?', 'What was the name of your first pet?']})}));
    await page.goto('/');
    await page.getByRole('button', {name: /forgot password/i}).click();
    await page.getByPlaceholder('you@example.com').fill('owner@example.com');
    await page.getByRole('button', {name: 'Show my security questions'}).click();
    await expect(page.getByRole('textbox', {name: 'What was the name of your first school?', exact: true})).toBeVisible();
    await page.getByRole('button', {name: /back to sign in/i}).click();
    await page.getByRole('button', {name: /create.*account/i}).click();
    await expect(page.getByRole('combobox', {name: 'Security question 1'})).toBeVisible();
    for (const el of await page.locator('form input, form select, form p').all()) {
      const box = await el.boundingBox();
      if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); }
    }
    await page.getByRole('button', {name: /create.*account/i}).scrollIntoViewIfNeeded();
    await page.screenshot({path: `test-results/recovery-${width}.png`, fullPage: true});
    expect(errors).toEqual([]);
    await expect(page.getByText(/recovery code/i)).toHaveCount(0);
  });
}
