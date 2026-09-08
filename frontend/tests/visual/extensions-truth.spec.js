import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/api/plugins') body = { plugins: {} };
    if (path === '/api/mcp/servers' || path === '/api/mcp/catalogue') body = { servers: [] };
    if (path.endsWith('/lock/status')) body = { enabled: false };
    if (path.endsWith('/chat/sessions') || path.endsWith('/models')) body = [];
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('smaran:navigate', { detail: { view: 'plugins' } })));
  await expect(page.getByRole('button', { name: 'Close extensions' })).toBeVisible();
});

test('failed server save stays visible as failure, never as a running server', async ({ page }) => {
  await page.route('**/api/mcp/servers', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { detail: 'Audit service unavailable' } });
    return route.fulfill({ json: { servers: [] } });
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add MCP Server', exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add an MCP server' }) });
  await form.locator('input').nth(0).fill('Audit server');
  await form.locator('input').nth(1).fill('http://127.0.0.1:9999/mcp');
  await form.getByRole('button', { name: /Save|Add server/i }).click();
  await expect(page.getByText('Audit service unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('custom_mcp_tool', { exact: true })).toHaveCount(0);
  await expect(form).toBeVisible();
});

test('saved skill fills a reviewable chat draft instead of pretending to execute', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('sm_pending_skill_prompt', 'Review this design for keyboard accessibility.');
    window.dispatchEvent(new CustomEvent('smaran:use-skill'));
    window.dispatchEvent(new CustomEvent('smaran:navigate', { detail: { view: 'chat' } }));
  });
  await expect(page.locator('.composer-input textarea')).toHaveValue('Review this design for keyboard accessibility.');
  expect(await page.evaluate(() => localStorage.getItem('sm_pending_skill_prompt'))).toBeNull();
});
