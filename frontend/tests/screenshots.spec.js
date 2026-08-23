// Captures the screenshots used in the README.
//
// Kept as a test rather than a one-off script so the images can be retaken
// whenever the interface moves, instead of slowly drifting out of date. Run
// against a live app:
//
//   npx playwright test tests/screenshots.spec.js --config=playwright.local.config.js
//
// The app must already be serving on SHOT_BASE (default http://127.0.0.1:8805).

import { test, expect } from '@playwright/test';
import path from 'path';

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:8805';
const OUT = path.resolve('../docs/images');

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

/** Give the entry animations and the telemetry poll time to settle. */
const settle = async (page, ms = 2500) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
};

/** Open a modal from the sidebar by the button's accessible name.
 *  The rail labels its buttons with aria-label rather than title, and the
 *  labels are not the same as the modal headings. */
const openFromSidebar = async (page, name) => {
  const item = page.getByRole('button', { name, exact: true }).first();
  await item.waitFor({ state: 'visible', timeout: 15000 });
  await item.click();
  await page.waitForTimeout(1800);
};

test.beforeEach(async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page);
});

test('workspace', async ({ page }) => {
  await page.screenshot({ path: `${OUT}/workspace.png` });
  expect(await page.title()).toContain('SMARAN');
});

test('model hub', async ({ page }) => {
  await openFromSidebar(page, 'Model Catalog & Matrix');
  // Wait for the catalogue itself, not a fixed delay: a timed wait caught
  // the loading spinner and shipped that as the screenshot.
  await page.getByText(/Loading Enterprise Model Catalog/i)
    .waitFor({ state: 'hidden', timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/model-hub.png` });
});

test('settings', async ({ page }) => {
  await openFromSidebar(page, 'Settings');
  await page.screenshot({ path: `${OUT}/settings.png` });
});

test('sign in', async ({ page }) => {
  await openFromSidebar(page, 'Sign In / Register');
  await page.screenshot({ path: `${OUT}/sign-in.png` });
});

test('device pairing', async ({ page }) => {
  await openFromSidebar(page, 'Link Your Phone');
  await page.waitForTimeout(2000); // the QR is generated server-side
  await page.screenshot({ path: `${OUT}/pairing.png` });
});

test('speak', async ({ page }) => {
  const speak = page.getByRole('button', { name: /speak/i }).first();
  await speak.click();
  // The avatar loads its model and only then fades in; without waiting for
  // that the shot is of an empty stage.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/speak.png` });
});

test('mobile workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot({ path: `${OUT}/mobile.png` });
});
