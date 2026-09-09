import test from 'node:test';
import assert from 'node:assert/strict';
import { usagePercent, usageWidth } from '../src/utils/usageBar.js';

test('a real reading becomes a real percentage', () => {
  assert.equal(usagePercent(3, 6), 50);
  assert.equal(usageWidth(3, 6), '50%');
});

test('an unreported reading is null, not zero', () => {
  // This is the whole point. Zero and unknown draw the same empty bar, so a
  // machine reporting nothing would look like one using no memory at all.
  assert.equal(usagePercent(null, 16), null);
  assert.equal(usagePercent(4, null), null);
  assert.equal(usagePercent(undefined, undefined), null);
  assert.equal(usageWidth(null, 16), null);
});

test('genuine zero usage is zero, and is not confused with unknown', () => {
  assert.equal(usagePercent(0, 16), 0);
  assert.equal(usageWidth(0, 16), '0%');
});

test('a nonsense capacity cannot be drawn', () => {
  assert.equal(usagePercent(4, 0), null);
  assert.equal(usagePercent(4, -8), null);
  assert.equal(usagePercent(-1, 8), null);
});

test('non-numeric values do not become NaN in a style string', () => {
  // 'Not reported' reaching a width would render `width: NaN%`, which the
  // browser drops silently - leaving a full-width bar.
  assert.equal(usagePercent('Not reported', 16), null);
  assert.equal(usageWidth('Not reported', 16), null);
});

test('a reading above capacity is clamped rather than overflowing the track', () => {
  assert.equal(usagePercent(20, 16), 100);
  assert.equal(usageWidth(20, 16), '100%');
});

test('the width is rounded, so the style does not churn on every render', () => {
  assert.equal(usageWidth(1, 3), '33.3%');
});

test('numeric strings from an API are accepted', () => {
  assert.equal(usagePercent('4', '8'), 50);
});
