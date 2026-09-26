import test from 'node:test';
import assert from 'node:assert/strict';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
};
globalThis.localStorage = memory();
const vibrations = [];
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p) => vibrations.push(p) }, configurable: true });

const { haptic, hapticsEnabled, hapticsVolume, setHaptics, soundFor, SOUNDS } = await import('../src/utils/haptics.js');

test('on by default at 60%, and the switch and volume are kept', () => {
  const s = memory();
  assert.equal(hapticsEnabled(s), true);
  assert.equal(hapticsVolume(s), 0.6);
  setHaptics({ enabled: false, volume: 0.25 }, s);
  assert.equal(hapticsEnabled(s), false);
  assert.equal(hapticsVolume(s), 0.25);
  setHaptics({ volume: 7 }, s);
  assert.equal(hapticsVolume(s), 1);
});

test('off means silent and still; on means a vibration on a phone', () => {
  setHaptics({ enabled: false });
  vibrations.length = 0;
  assert.equal(haptic('success'), false);
  assert.equal(vibrations.length, 0);
  setHaptics({ enabled: true });
  assert.equal(haptic('success'), true);
  assert.deepEqual(vibrations, [SOUNDS.success.vibrate]);
  assert.equal(haptic('no-such-sound'), false);
});

test('buttons tap, switches toggle, disabled controls and plain text say nothing', () => {
  const el = (matches, extra = {}) => ({
    closest: (sel) => (sel.includes('button') ? (extra.none ? null : node) : extra.muted ? node : null),
    matches: (sel) => matches && sel.includes('checkbox'),
    getAttribute: () => null,
    disabled: !!extra.disabled,
  });
  let node = el(false); node.closest = (sel) => (sel.includes('data-no-haptics') ? null : node);
  assert.equal(soundFor(node), 'tap');
  node = el(true); node.closest = (sel) => (sel.includes('data-no-haptics') ? null : node);
  assert.equal(soundFor(node), 'toggle');
  node = el(false, { disabled: true }); node.closest = (sel) => (sel.includes('data-no-haptics') ? null : node);
  assert.equal(soundFor(node), '');
  assert.equal(soundFor({ closest: () => null }), '');
});
