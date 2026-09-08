import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
});

test('settings opens from the profile menu and returns to the conversation', async ({ page }) => {
  await page.getByRole('button', { name: / profile$/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings & Preferences' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/settings.png' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings & Preferences' })).toHaveCount(0);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
});

test('model picker opens the real hub and can be closed without configuration changes', async ({ page }) => {
  await page.getByRole('button', { name: /Auto Router/ }).click();
  await expect(page.getByRole('heading', { name: /Model Hub & Cloud APIs/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/model-hub.png' });
  await page.getByRole('button', { name: 'Close model hub', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Model Hub & Cloud APIs/ })).toHaveCount(0);
});

test('choosing an installed model sends that model in the next chat request', async ({ page }) => {
  await page.route('**/api/models/catalog', route => route.fulfill({ json: {
    catalog: [{ id: 'audit/model', name: 'Audit Model', company_code: 'meta',
      capabilities: ['Text'], is_downloaded: true, ollama_tag: 'audit-model:1b' }],
    user_gpu_vram_gb: 6,
  } }));
  await page.route('**/api/chat', route => route.fulfill({
    contentType: 'application/x-ndjson', body: '{"token":"Audit response"}\n',
  }));
  await page.getByRole('button', { name: /Auto Router/ }).click();
  await page.getByRole('button', { name: 'Use in chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Model Hub & Cloud APIs/ })).toHaveCount(0);
  await page.getByTestId('chat-composer').getByRole('textbox').fill('Verify chosen model');
  const request = page.waitForRequest(r => r.url().endsWith('/api/chat') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Send Message', exact: true }).click();
  expect((await request).postDataJSON().model).toBe('audit-model:1b');
});

test('terminal opens with an editable command field and closes without running a command', async ({ page }) => {
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Terminal command' })).toBeEditable();
  await page.screenshot({ path: 'test-results/screenshots/terminal.png' });
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Terminal command' })).toHaveCount(0);
});

test('voice view can close when microphone access is denied', async ({ page }) => {
  // Exercise denial without opening the host microphone or making a live call.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Microphone denied by test', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: 'Speak', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Jarvis', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/voice-denied.png' });
  await page.getByRole('button', { name: 'Close Jarvis', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Jarvis', exact: true })).toHaveCount(0);
});
