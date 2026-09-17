import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test('gateway failures are visible and credentials are not persisted', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sm_tg_token', 'legacy-secret'));
  await page.route('**/api/agent/gateway/**', route => route.fulfill({ status: 503, json: { detail: 'Gateway unavailable' } }));
  await page.goto('/tests/visual/settings.html?view=gateway');
  await expect(page.getByRole('alert')).toHaveText('Gateway unavailable');
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('sm_tg_token'))).toBeNull();
  await page.screenshot({ path: 'test-results/screenshots/gateway-failure.png' });
});

test('sandbox failures do not invent permissive mode or a timeout', async ({ page }) => {
  await page.route('**/api/agent/sandbox/**', route => route.fulfill({ status: 503, json: { detail: 'Backend offline' } }));
  await page.goto('/tests/visual/settings.html?view=sandbox');
  await expect(page.getByText('Backend offline')).toBeVisible();
  await expect(page.getByText('Permissive', { exact: true })).toHaveCount(0);
  await expect(page.getByText('120s limit', { exact: true })).toHaveCount(0);
});

test('automation validation and run queue work on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  let created = false;
  await page.route('**/api/agent/scheduler/**', async route => {
    const request = route.request();
    if (request.url().endsWith('/run')) return route.fulfill({ status: 202, json: { status: 'queued' } });
    if (request.method() === 'POST') {
      if (request.postDataJSON().schedule_expr === 'bad') return route.fulfill({ status: 422, json: { detail: 'Invalid schedule' } });
      created = true;
      return route.fulfill({ json: { status: 'created' } });
    }
    return route.fulfill({ json: { jobs: created ? [{ id: 'test', name: 'QA job', schedule_expr: 'every 1 hour', task_prompt: 'Check files', last_status: 'pending' }] : [] } });
  });
  await page.goto('/tests/visual/settings.html');
  await page.getByRole('button', { name: 'Add First Automation' }).click();
  await page.getByPlaceholder('e.g. Daily Workspace Review, Health Check').fill('QA job');
  await page.getByPlaceholder('e.g. every 30 minutes, daily at 09:00, or */15 * * * *').fill('bad');
  await page.getByPlaceholder('What should SMARAN agent do when this triggers?').fill('Check files');
  await page.getByRole('button', { name: 'Save Automation' }).click();
  await expect(page.getByText('Invalid schedule', { exact: true })).toBeVisible();
  await page.getByPlaceholder('e.g. every 30 minutes, daily at 09:00, or */15 * * * *').fill('every 1 hour');
  await page.getByRole('button', { name: 'Save Automation' }).click();
  await expect(page.getByText('QA job', { exact: true })).toBeVisible();
  await page.getByTitle('Run Now', { exact: true }).click();
  await expect(page.getByTitle('Run Now', { exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/screenshots/scheduler-mobile.png' });
});
