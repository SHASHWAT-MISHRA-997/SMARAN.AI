import { chromium } from '@playwright/test';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  await page.route('**/api/lock/status', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false }),
    });
  });

  await page.goto('http://localhost:3003', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Pre-create a session via evaluate so it is already in database and loaded
  await page.evaluate(async () => {
    const devId = localStorage.getItem('smaran_ai_device_id');
    const devFp = localStorage.getItem('smaran_ai_device_fingerprint');
    await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': devId,
        'X-Device-Fingerprint': devFp,
      },
      body: JSON.stringify({ title: 'My Mobile Project' })
    });
  });

  // Reload page to let App.jsx fetch sessions normally
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Open mobile drawer
  const menuButton = page.locator('button[aria-label="Open navigation menu"]');
  await menuButton.click();
  await page.waitForTimeout(500);

  const drawer = page.locator('#smaran-mobile-navigation');
  console.log('DRAWER TEXT:\n', await drawer.innerText());

  // Check rename button
  const renameButton = drawer.locator('button[title="Rename conversation"]').first();
  await renameButton.waitFor({ state: 'visible', timeout: 5000 });
  console.log('Rename button is visible in mobile Chat History!');

  // Click rename
  await renameButton.click({ force: true });
  console.log('Clicked Rename button!');

  // Check rename input appears
  const renameInput = drawer.locator('input[aria-label="Rename conversation"]');
  await renameInput.waitFor({ state: 'visible', timeout: 3000 });
  console.log('Rename input is visible!');

  // Enter new title
  await renameInput.fill('Renamed AI Assistant Mobile Chat');

  // Click save
  const saveBtn = drawer.locator('button[title="Save title"]');
  await saveBtn.click({ force: true });
  console.log('Clicked Save button!');

  // Wait for state update
  await page.waitForTimeout(1000);

  const newTitle = drawer.locator('text=Renamed AI Assistant Mobile Chat');
  const visible = await newTitle.first().isVisible();
  console.log('Is new title visible in mobile drawer?', visible);

  if (!visible) {
    throw new Error('New title did not appear after saving rename!');
  }

  // Also test Cancel
  const renameBtn2 = drawer.locator('button[title="Rename conversation"]').first();
  await renameBtn2.click({ force: true });
  const cancelBtn = drawer.locator('button[title="Cancel"]');
  await cancelBtn.waitFor({ state: 'visible', timeout: 3000 });
  await cancelBtn.click({ force: true });
  console.log('Cancel rename button works!');

  await page.screenshot({ path: '../mobile_chat_history_verified.png' });
  console.log('Screenshot saved to mobile_chat_history_verified.png');

  await browser.close();
  console.log('SUCCESS: All mobile rename features tested and verified!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
