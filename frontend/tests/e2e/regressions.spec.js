import { test, expect } from '@playwright/test';

test('a failed lock check keeps the workspace private and can be retried', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/lock/status', route => route.fulfill({
    status: unavailable ? 503 : 200,
    json: unavailable ? { detail: 'Engine unavailable' } : { enabled: false },
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry lock check' })).toBeVisible();
  await expect(page.getByTestId('chat-composer')).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Retry lock check' }).click();
  await expect(page.getByTestId('chat-composer')).toBeVisible();
});

test('an invalid lock response cannot silently unlock the workspace', async ({ page }) => {
  await page.route('**/api/lock/status', route => route.fulfill({ json: {} }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry lock check' })).toBeVisible();
  await expect(page.getByTestId('chat-composer')).toHaveCount(0);
});

test('empty server registry clears stale cached servers and reports an empty view', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sm_custom_mcps', JSON.stringify([
    { name: 'stale-test-server', state: 'connected', type: 'mcp' },
  ])));
  await page.route('**/api/mcp/servers', route => route.fulfill({ json: { servers: [] } }));
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await page.getByRole('button', { name: 'Plugins & Skills', exact: true }).click();
  await page.getByRole('button', { name: 'MCP Servers 0', exact: true }).click();
  await expect(page.getByText('No extensions in this view')).toBeVisible();
  await expect(page.getByText('● all running')).toHaveCount(0);
  await expect(page.getByText('stale-test-server')).toHaveCount(0);
});

test('plugin registry failure is visible instead of looking like an empty success', async ({ page }) => {
  await page.route('**/api/plugins', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await page.getByRole('button', { name: 'Plugins & Skills', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Plugin registry failed (503)');
  await expect(page.getByText('● all running')).toHaveCount(0);
});

test('site creation opens and closes through accessible controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await page.getByRole('button', { name: 'Sites', exact: true }).click();
  await page.getByRole('button', { name: 'Create New Site', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a Website' })).toBeVisible();
  await page.getByRole('button', { name: 'Close site creation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create a Website' })).toHaveCount(0);
});
