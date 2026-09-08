import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sm_wake_enabled', 'false'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path.endsWith('/lock/status')) body = { enabled: false };
    else if (path.endsWith('/chat/sessions')) body = [{ id: 'reply-audit', title: 'Reply audit' }];
    else if (path.endsWith('/messages')) body = [{ id: 1, role: 'assistant', content: 'Role summary:\n\n```\nForward Deploy Engineer = AI + Development + Customer Support\n```\n\n```text\nSummary\nAll words stay visible.\n```\n\n```javascript\nconsole.log("actual code");\n```', timestamp: new Date().toISOString() }];
    else if (path.endsWith('/collections') || path.endsWith('/models')) body = [];
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
});

test('fenced explanations stay readable without project controls; explicit code retains its download', async ({ page }) => {
  await expect(page.getByText('Forward Deploy Engineer = AI + Development + Customer Support', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Download ZIP/ })).toHaveCount(1);
  await expect(page.getByText('Summary\nAll words stay visible.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Output', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('Speak stays open when replacing the phone tools sheet and Back closes only the call', async ({ page }) => {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Speak Voice conversation', exact: true }).click();
  const close = page.getByRole('button', { name: 'Close Jarvis', exact: true });
  await expect(close).toBeVisible();
  await page.waitForTimeout(500); // Allow the previous sheet's asynchronous popstate to arrive.
  await expect(close).toBeVisible();
  await page.goBack();
  await expect(close).toBeHidden();
  await expect(page.getByTestId('chat-composer')).toBeVisible();
});
