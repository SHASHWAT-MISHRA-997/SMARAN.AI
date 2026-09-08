import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/api.mjs';
import { resolveWindow, daysBetween, WEB_LABELS } from '../netlify/lib/shared.mjs';

test('custom and rolling analytics windows count inclusive days consistently', () => {
  const range = resolveWindow({ start: '2026-09-01', end: '2026-09-07' });
  assert.equal(range.span, 7);
  assert.equal(daysBetween(range.from, range.to).length, 7);
  assert.equal(resolveWindow({ start: '2026-09-07', end: '2026-09-07' }).span, 1);
  assert.equal(resolveWindow({ days: '7' }).span, 7);
});

test('invalid or inverted date ranges cannot silently return misleading statistics', () => {
  for (const input of [{ days: '1.5' }, { days: 'Infinity' }, { days: '-1' }, { start: '2026-02-30' }, { start: '2026-09-07', end: '2026-09-01' }, { start: '2000-01-01', end: '2026-01-01' }]) {
    assert.throws(() => resolveWindow(input), RangeError);
  }
});

test('GET cannot erase installation records and invalid requests fail before storage access', async () => {
  process.env.ANALYTICS_DASHBOARD_KEY = 'isolated-test-key';
  const request = (path) => new Request(`https://example.invalid${path}`, { headers: { 'x-dashboard-key': 'isolated-test-key' } });
  assert.equal((await handler(request('/api/erase?install_id=fixture'))).status, 405);
  assert.equal((await handler(request('/api/summary?days=1.5'))).status, 400);
  assert.equal((await handler(new Request('https://example.invalid/api/summary'))).status, 401);
  delete process.env.ANALYTICS_DASHBOARD_KEY;
});

test('Linux downloads have their own accepted analytics label', () => {
  assert.ok(WEB_LABELS.includes('linux'));
});
