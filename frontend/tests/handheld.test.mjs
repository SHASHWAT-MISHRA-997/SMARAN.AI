/**
 * Cron, the gateway and the sandbox are gone from phones and tablets.
 *
 * All three act on the machine that is running SMARAN as a server. A handset
 * is a client of that machine, never the machine, so those three screens
 * opened on a phone and then did nothing at all - reported as "Automations
 * (crons) section kaam nahi kar raha hai" along with the other two.
 *
 * `isHandheld` decides where they are offered, so the thing worth pinning down
 * is which devices it answers yes for. The iPad is the case that makes this a
 * test rather than a one-liner: Safari on iPad has claimed to be a Macintosh
 * since iPadOS 13, so a user-agent test alone hands a tablet the desktop
 * build. `maxTouchPoints` is what separates it from a real Mac - 5 against 0 -
 * and a touchscreen laptop is the mirror case that must still count as a
 * desktop.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

/** Load device.js as though it were running on the given device. */
async function on({ userAgent, touchPoints = 0, width = 1920 }, label) {
  const navigator = { userAgent, maxTouchPoints: touchPoints };
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
  globalThis.window = {
    innerWidth: width,
    navigator,
    matchMedia: (query) => ({ matches: query.includes('coarse') ? touchPoints > 0 : false }),
  };
  // A fresh module per case: device.js reads window at call time, but the
  // query cache in the import map is keyed by URL.
  return import(`../src/utils/device.js?${encodeURIComponent(label)}`);
}

const DEVICES = {
  'Android phone': { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Mobile Safari', touchPoints: 5, width: 412 },
  'iPhone': { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', touchPoints: 5, width: 390 },
  'iPad in desktop mode': { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15', touchPoints: 5, width: 1024 },
  'Android tablet': { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit Safari', touchPoints: 5, width: 1280 },
  'Mac': { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15', touchPoints: 0, width: 1680 },
  'Windows desktop': { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36', touchPoints: 0, width: 1920 },
  'touchscreen Windows laptop': { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36', touchPoints: 10, width: 1920 },
};

for (const name of ['Android phone', 'iPhone', 'iPad in desktop mode', 'Android tablet']) {
  test(`${name} is handheld`, async () => {
    const { isHandheld } = await on(DEVICES[name], name);
    assert.equal(isHandheld(), true);
  });
}

for (const name of ['Mac', 'Windows desktop', 'touchscreen Windows laptop']) {
  test(`${name} is not handheld`, async () => {
    const { isHandheld } = await on(DEVICES[name], name);
    assert.equal(isHandheld(), false);
  });
}

test('an iPad and a Mac send the same user-agent, and only touch tells them apart', async () => {
  assert.equal(DEVICES['iPad in desktop mode'].userAgent, DEVICES.Mac.userAgent);
  // Each answer is taken while that device is the one installed: isHandheld
  // reads window when it is called, not when it is imported.
  const { isHandheld: pad } = await on(DEVICES['iPad in desktop mode'], 'pad-vs-mac-pad');
  const padAnswer = pad();
  const { isHandheld: mac } = await on(DEVICES.Mac, 'pad-vs-mac-mac');
  assert.equal(padAnswer, true);
  assert.equal(mac(), false);
});

test('a phone is handheld as well as a phone', async () => {
  const { isHandheld, isPhone } = await on(DEVICES['Android phone'], 'phone-implies-handheld');
  assert.equal(isPhone(), true);
  assert.equal(isHandheld(), true);
});

test('a tablet is handheld without being a phone', async () => {
  // The distinction matters: `isPhone` still drives layout, which a tablet
  // should get at desktop width, while `isHandheld` drives what is offered.
  const { isHandheld, isPhone } = await on(DEVICES['iPad in desktop mode'], 'tablet-not-phone');
  assert.equal(isPhone(), false);
  assert.equal(isHandheld(), true);
});
