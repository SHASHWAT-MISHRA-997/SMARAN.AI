import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, loadAppearance, saveAppearance } from '../src/utils/appearancePreferences.js';

test('invalid saved appearance cannot break startup or create extreme font sizes', () => {
  assert.deepEqual(normalizeAppearance(null), { uiSize: 14, codeSize: 13, motion: 'system' });
  assert.deepEqual(normalizeAppearance({ uiSize: 10000, codeSize: -1, motion: 'unknown' }),
    { uiSize: 24, codeSize: 12, motion: 'system' });
});
test('appearance settings are persisted and applied to the document', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const root = { style: { setProperty(key, value) { this[key] = value; } }, dataset: {} };
  globalThis.document = { documentElement: root };
  saveAppearance({ uiSize: 16, codeSize: 15, motion: 'on' });
  assert.deepEqual(loadAppearance(), { uiSize: 16, codeSize: 15, motion: 'on' });
  assert.equal(root.style.fontSize, '16px');
  assert.equal(root.style['--sm-code-size'], '15px');
  assert.equal(root.dataset.reduceMotion, 'on');
  delete globalThis.localStorage;
  delete globalThis.document;
});

test('a cleared or missing font size falls back to the default, not the minimum', () => {
  // Number(null) and Number('') are both 0 and both finite, so these slipped
  // past the validity check and were clamped up to the 12px floor. Clearing
  // the box shrank the whole interface instead of restoring 14px.
  assert.equal(normalizeAppearance({ uiSize: null }).uiSize, 14);
  assert.equal(normalizeAppearance({ uiSize: '' }).uiSize, 14);
  assert.equal(normalizeAppearance({ codeSize: null }).codeSize, 13);
  assert.equal(normalizeAppearance({ codeSize: '' }).codeSize, 13);
});

test('a real size still survives, including one given as a string', () => {
  // The fix must not reject the ordinary case: a number input hands back text.
  assert.equal(normalizeAppearance({ uiSize: '18' }).uiSize, 18);
  assert.equal(normalizeAppearance({ uiSize: 16 }).uiSize, 16);
});

test('the clamp still holds at both ends', () => {
  assert.equal(normalizeAppearance({ uiSize: 4 }).uiSize, 12);
  assert.equal(normalizeAppearance({ uiSize: 999 }).uiSize, 24);
});

test('unreadable stored preferences do not stop the app starting', () => {
  const values = new Map([['sm_ui_preferences', '{ not json']]);
  globalThis.localStorage = { getItem: key => values.get(key), setItem: () => {} };
  assert.deepEqual(loadAppearance(), { uiSize: 14, codeSize: 13, motion: 'system' });
  delete globalThis.localStorage;
});
