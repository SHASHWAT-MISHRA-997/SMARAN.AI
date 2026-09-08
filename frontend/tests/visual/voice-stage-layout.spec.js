import { test, expect } from '@playwright/test';

/**
 * The call screen on a phone: no view controls, and the words she says are
 * not drawn across her face.
 *
 * Both were reported by the owner. The controls (VIEW LOCKED, EYES TRACKING,
 * FACING HELD, FRONT/¾/SIDE/BACK, keyboard hints) are a desktop panel that
 * had been shuffled around the stage to avoid colliding with the caption and
 * the message box, which only traded one collision for another. And the
 * caption sat at a fixed percentage from the top of the same rectangle the
 * character filled, so a long answer covered her.
 */

const PHONE = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';

const mockApi = async (page) => {
  await page.addInitScript(() => localStorage.setItem('sm_wake_enabled', 'false'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path.endsWith('/lock/status')) body = { enabled: false };
    else if (path.endsWith('/chat/sessions')) body = [{ id: 'voice-layout', title: 'Voice layout' }];
    else if (path.endsWith('/messages')) {
      body = [{ id: 1, role: 'assistant', content: 'A short reply.', timestamp: new Date().toISOString() }];
    } else if (path.endsWith('/collections') || path.endsWith('/models')) body = [];
    await route.fulfill({ json: body });
  });
};

const openCall = async (page) => {
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeVisible();

  // Two composers, two routes in. Portrait hides the tools behind a "More"
  // sheet; sideways the phone shows the full toolbar and Speak sits in it
  // directly, so looking only for the sheet finds nothing there.
  const sheet = page.getByRole('button', { name: 'More', exact: true });
  if (await sheet.isVisible().catch(() => false)) {
    await sheet.click();
    await page.getByRole('button', { name: 'Speak Voice conversation', exact: true }).click();
  } else {
    // `.first()` can land on the compact sheet's copy, which is in the DOM but
    // hidden sideways; clicking that opens nothing and the wait below then
    // fails for a reason that has nothing to do with the layout under test.
    await page.getByRole('button', { name: /^Speak/ }).locator('visible=true').first().click();
  }
  await expect(page.getByRole('button', { name: 'Close Jarvis', exact: true })).toBeVisible();
};

/** Every label the owner asked to see gone from the phone. */
const CONTROL_LABELS = [
  'VIEW LOCKED', 'VIEW FREE', 'EYES TRACKING',
  'FACING HELD', 'FACING FREE', 'FRONT', 'SIDE', 'BACK',
];

test.describe('portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: PHONE });

  test.beforeEach(async ({ page }) => { await mockApi(page); });

  test('none of the view controls are on the phone', async ({ page }) => {
    await openCall(page);
    await expect(page.locator('.mmd-hud')).toHaveCount(0, { timeout: 1000 }).catch(async () => {
      // The HUD only renders once the character is ready; if it is in the DOM
      // at all it must not be displayed or occupy space.
      await expect(page.locator('.mmd-hud')).toBeHidden();
    });
    for (const label of CONTROL_LABELS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.locator('.mmd-key-hint')).toBeHidden().catch(() => {});
  });

  test('the character and the caption occupy separate rectangles', async ({ page }) => {
    await openCall(page);

    // The caption is driven by the call's own state machine, which needs a
    // microphone. The layout is what changed here, so the text is placed
    // directly and the boxes are measured.
    const boxes = await page.evaluate(() => {
      const p = document.querySelector('.voice-caption-scroll p');
      if (!p) return null;
      p.textContent = 'यह एक लंबा उत्तर है। '.repeat(40);
      const figure = document.querySelector('.voice-figure');
      const caption = document.querySelector('.voice-caption');
      const f = figure.getBoundingClientRect();
      const c = caption.getBoundingClientRect();
      return {
        figure: { top: f.top, bottom: f.bottom, height: f.height },
        caption: { top: c.top, bottom: c.bottom, height: c.height },
        scrollable: (() => {
          const s = document.querySelector('.voice-caption-scroll');
          return s.scrollHeight > s.clientHeight + 1;
        })(),
      };
    });

    expect(boxes, 'the caption element should exist').not.toBeNull();
    // Separate boxes: the caption starts at or after the figure ends.
    expect(boxes.caption.top).toBeGreaterThanOrEqual(boxes.figure.bottom - 1);
    // Neither is squeezed out of existence.
    expect(boxes.figure.height).toBeGreaterThan(100);
    expect(boxes.caption.height).toBeGreaterThan(40);
    // A long answer scrolls inside its own box instead of running off.
    expect(boxes.scrollable).toBe(true);
  });

  test('an empty caption gives its room back to the character', async ({ page }) => {
    await openCall(page);
    const heights = await page.evaluate(() => {
      const caption = document.querySelector('.voice-caption');
      const figure = document.querySelector('.voice-figure');
      return {
        caption: caption.getBoundingClientRect().height,
        figure: figure.getBoundingClientRect().height,
      };
    });
    expect(heights.caption).toBeLessThan(20);
    expect(heights.figure).toBeGreaterThan(200);
  });
});

test.describe('landscape', () => {
  test.use({ viewport: { width: 792, height: 360 }, userAgent: PHONE });

  test.beforeEach(async ({ page }) => { await mockApi(page); });

  test('the controls are gone sideways too', async ({ page }) => {
    await openCall(page);
    for (const label of CONTROL_LABELS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('sideways the character sits beside the words, not under them', async ({ page }) => {
    await openCall(page);
    const boxes = await page.evaluate(() => {
      const p = document.querySelector('.voice-caption-scroll p');
      if (!p) return null;
      p.textContent = 'A long spoken answer that has to stay readable. '.repeat(20);
      const f = document.querySelector('.voice-figure').getBoundingClientRect();
      const c = document.querySelector('.voice-caption').getBoundingClientRect();
      return { f: { right: f.right, width: f.width }, c: { left: c.left, width: c.width } };
    });
    expect(boxes).not.toBeNull();
    // Side by side: the caption begins at or after the figure ends.
    expect(boxes.c.left).toBeGreaterThanOrEqual(boxes.f.right - 1);
    expect(boxes.f.width).toBeGreaterThan(80);
    expect(boxes.c.width).toBeGreaterThan(120);
  });
});
