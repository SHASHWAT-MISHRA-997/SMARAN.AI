import { test, expect } from '@playwright/test';

test('an empty chat history settles instead of polling indefinitely', async ({ page }) => {
  let sessionReads = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/chat/sessions')) {
      sessionReads += 1;
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/lock/status')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, username: 'audit' } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect.poll(() => sessionReads).toBeGreaterThan(0);
  const settledReads = sessionReads;
  // Observe beyond two retry intervals. No failed backend request is involved.
  await page.waitForTimeout(4500);
  expect(sessionReads).toBe(settledReads);
});
