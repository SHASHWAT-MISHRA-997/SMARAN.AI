import { test, expect } from '@playwright/test';

test('offline devices do not invent a paired phone or delivered history', async ({ page }) => {
  await page.route('**/api/companion/devices', route => route.abort());
  await page.goto('/tests/visual/dispatch.html');
  await expect(page.getByRole('alert')).toContainText('Could not load paired devices');
  await expect(page.getByText('No dispatch actions yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dispatch', exact: true })).toBeDisabled();
  await expect(page.getByText('Android Companion (Pixel)')).toHaveCount(0);
});

test('HTTP failure retains the command and only an acknowledgement creates queued history', async ({ page }) => {
  await page.route('**/api/companion/devices', route => route.fulfill({ json: { devices: [{ id: 'phone', name: 'Test phone' }] } }));
  let accepted = false;
  await page.route('**/api/companion/dispatch', route => route.fulfill(accepted
    ? { json: { dispatched: true, devices_count: 1 } }
    : { status: 503, json: { detail: 'Unavailable' } }));
  await page.goto('/tests/visual/dispatch.html');
  const command = page.getByPlaceholder('Type command or notification', { exact: false });
  await command.fill('Test command');
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Dispatch failed (503)');
  await expect(command).toHaveValue('Test command');
  await expect(page.getByText('No dispatch actions yet.')).toBeVisible();
  accepted = true;
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await expect(command).toHaveValue('');
  await expect(page.getByText('queued', { exact: true })).toBeVisible();
  await expect(page.getByText('delivered', { exact: true })).toHaveCount(0);
});
