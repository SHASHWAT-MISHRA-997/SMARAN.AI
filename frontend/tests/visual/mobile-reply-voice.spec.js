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

test('mobile settings omit keyboard shortcuts in portrait and landscape', async ({ page }) => {
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'General & Theme', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shortcuts', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('button', { name: 'Shortcuts', exact: true })).toHaveCount(0);
});

test('share previews completed messages and downloads a snapshot', async ({ page }) => {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share conversation' });
  await expect(dialog).toContainText('Forward Deploy Engineer');
  await expect(dialog).toContainText('Public links are not configured');
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download snapshot' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('smaran-conversation.txt');
  await dialog.getByRole('button', { name: 'Close share preview' }).click();
  await expect(dialog).toBeHidden();
});

test('mobile handset ends the call instead of only pausing the microphone', async ({ page }) => {
  const renderLoops = [];
  page.on('console', message => {
    if (message.text().includes('Maximum update depth exceeded')) renderLoops.push(message.text());
  });
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Speak Voice conversation', exact: true }).click();
  await page.getByRole('button', { name: 'End the conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Jarvis', exact: true })).toBeHidden();
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await page.waitForTimeout(250);
  expect(renderLoops).toEqual([]);
});
