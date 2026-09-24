// The paired phone's chat reached the PC without its pairing token and was
// refused ("Sign in to use SMARAN.AI from another device"). The token is now
// added at the fetch layer - to the paired host only.
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = { location: { href: 'https://localhost/' } };
globalThis.localStorage = { getItem: () => null };
const { withCompanionToken } = await import('../src/utils/companionAuth.js');

const link = { url: 'http://192.168.1.5:3003', token: 'tok-123' };
const seen = [];
const base = (input, init) => { seen.push({ input, headers: new Headers(init?.headers) }); return Promise.resolve('ok'); };
const f = withCompanionToken(base, () => link);

test('a request to the paired desktop carries the token', async () => {
  await f('http://192.168.1.5:3003/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const last = seen.at(-1);
  assert.equal(last.headers.get('X-Companion-Token'), 'tok-123');
  assert.equal(last.headers.get('Content-Type'), 'application/json');
});

test('a request anywhere else never sees it', async () => {
  await f('https://api.open-meteo.com/v1/forecast?x=1');
  assert.equal(seen.at(-1).headers.get('X-Companion-Token'), null);
  await f('http://192.168.1.5:9999/api/chat');
  assert.equal(seen.at(-1).headers.get('X-Companion-Token'), null);
});

test('not paired: requests are untouched', async () => {
  const g = withCompanionToken(base, () => null);
  await g('http://192.168.1.5:3003/api/chat');
  assert.equal(seen.at(-1).headers.get('X-Companion-Token'), null);
});
