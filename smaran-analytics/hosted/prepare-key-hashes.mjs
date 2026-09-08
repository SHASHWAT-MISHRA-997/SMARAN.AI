import { readFileSync, writeFileSync } from 'node:fs';
import { hashKey } from './netlify/lib/shared.mjs';

const keys = JSON.parse(readFileSync(new URL('./keys.json', import.meta.url), 'utf8'));
const hashes = {};
for (const kind of ['dashboard', 'ingest']) {
  const key = keys[kind];
  if (typeof key !== 'string' || key.trim().length < 32) {
    throw new Error(`${kind} must be a randomly generated API key of at least 32 characters.`);
  }
  hashes[kind] = hashKey(key.trim());
}
writeFileSync(new URL('./key-hashes.json', import.meta.url), JSON.stringify(hashes, null, 2) + '\n', { mode: 0o600 });
console.log('Prepared dashboard and ingest verification hashes; no raw keys emitted.');
