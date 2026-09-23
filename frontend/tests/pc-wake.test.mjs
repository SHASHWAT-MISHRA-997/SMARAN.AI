// The computer streams its microphone to the backend's "Hey Jarvis" detector
// as 16-bit PCM; the conversion must be exact at the limits.
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { toPcm16 } = await import('../src/utils/pcWake.js');

test('float samples become little-endian 16-bit PCM, clipped', () => {
  const out = new Int16Array(toPcm16(Float32Array.from([0, 1, -1, 0.5, 2, -2])));
  assert.deepEqual(Array.from(out), [0, 32767, -32768, 16383, 32767, -32768]);
});
