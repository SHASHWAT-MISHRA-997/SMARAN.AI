/**
 * The analytics panel must open on the user's calendar date.
 *
 * It opened on `new Date().toISOString().split('T')[0]`, which is the UTC
 * date. In India that is the previous day until 05:30 every morning, so the
 * panel selected 15 September while the header next to it read 16 September.
 * Filtered counts then came back zero for a day the user never chose, which
 * looks exactly like a panel that cannot read its own database.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { todayLocalISO } from '../src/utils/localDate.js';

/** A Date that behaves as if the machine were at the given UTC offset. */
function atOffset(iso, offsetMinutesAheadOfUtc) {
  const real = new Date(iso);
  return {
    getTime: () => real.getTime(),
    getTimezoneOffset: () => -offsetMinutesAheadOfUtc,
  };
}

test('early morning in India is not yesterday', () => {
  // 02:18 on 16 September IST is 20:48 on 15 September UTC.
  const ist = atOffset('2026-09-15T20:48:00Z', 330);
  assert.equal(todayLocalISO(ist), '2026-09-16');
});

test('the same instant in UTC is the 15th', () => {
  assert.equal(todayLocalISO(atOffset('2026-09-15T20:48:00Z', 0)), '2026-09-15');
});

test('late evening west of Greenwich is not tomorrow', () => {
  // 19:30 on 15 September in New York is 23:30 UTC the same day.
  const ny = atOffset('2026-09-15T23:30:00Z', -240);
  assert.equal(todayLocalISO(ny), '2026-09-15');
});

test('midday is unambiguous everywhere', () => {
  for (const offset of [-480, -240, 0, 120, 330, 540]) {
    const noonish = atOffset('2026-09-15T12:00:00Z', offset);
    const day = todayLocalISO(noonish);
    assert.ok(['2026-09-15', '2026-09-16'].includes(day), `${offset}: ${day}`);
  }
});

test('it returns a plain ISO calendar date', () => {
  assert.match(todayLocalISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('it matches what the browser would show the user', () => {
  const now = new Date();
  const expected = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  assert.equal(todayLocalISO(now), expected);
});
