import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashKey, keyHash, matchesKeyHash, requireDashboardKey } from '../netlify/lib/shared.mjs';
import ingest from '../netlify/functions/ingest.mjs';

test('hash verifier accepts the original key but rejects its digest and wrong keys', () => {
  const key = 'fixture-only-key-12345678901234567890';
  const digest = hashKey(key);
  assert.equal(matchesKeyHash(key, digest), true);
  for (const wrong of ['', key + 'x', digest, null]) assert.equal(matchesKeyHash(wrong, digest), false);
  assert.equal(matchesKeyHash(key, 'invalid'), false);
});

test('dashboard and ingest routes authenticate using hash-only configuration and fail closed', async () => {
  const key = 'fixture-only-key-12345678901234567890';
  for (const kind of ['dashboard', 'ingest']) {
    const prefix = `ANALYTICS_${kind.toUpperCase()}_KEY`;
    const saved = [process.env[prefix], process.env[`${prefix}_SHA256`]];
    try {
      delete process.env[prefix];
      process.env[`${prefix}_SHA256`] = hashKey(key);
      const check = async (given) => {
        const req = new Request(`https://example.invalid/${kind}`, {
          method: kind === 'ingest' ? 'POST' : 'GET',
          headers: { [`x-${kind}-key`]: given },
          ...(kind === 'ingest' ? { body: 'invalid JSON' } : {}),
        });
        return kind === 'ingest' ? (await ingest(req)).status : requireDashboardKey(req)?.status ?? 200;
      };
      assert.equal(await check(key), kind === 'ingest' ? 400 : 200);
      assert.equal(await check(hashKey(key)), 401);
      assert.equal(await check('wrong'), 401);
      process.env[`${prefix}_SHA256`] = '';
      assert.equal(await check(key), 503);
      process.env[prefix] = key;
      assert.equal(keyHash(kind), hashKey(key));
    } finally {
      for (const [index, name] of [prefix, `${prefix}_SHA256`].entries()) {
        if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
      }
    }
  }
});
