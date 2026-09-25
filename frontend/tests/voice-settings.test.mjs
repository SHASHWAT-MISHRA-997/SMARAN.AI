import test from 'node:test';
import assert from 'node:assert/strict';
import { chosenVoice, continuousDictation, micConstraint, openMicrophone } from '../src/utils/voiceSettings.js';

const store = (values) => ({ getItem: (k) => values[k] ?? null });

test('the chosen microphone is asked for, the default otherwise', () => {
  assert.deepEqual(micConstraint({}, store({ sm_voice_mic: 'abc' })), { deviceId: { exact: 'abc' } });
  assert.equal(micConstraint({}, store({})), true);
  assert.equal(micConstraint({}, store({ sm_voice_mic: 'default' })), true);
  assert.deepEqual(micConstraint({ echoCancellation: true }, store({ sm_voice_mic: 'abc' })),
    { echoCancellation: true, deviceId: { exact: 'abc' } });
});

test('an unplugged microphone falls back to the default instead of breaking voice', async () => {
  globalThis.localStorage = store({ sm_voice_mic: 'gone' });
  const asked = [];
  const media = {
    getUserMedia: async ({ audio }) => {
      asked.push(audio);
      if (audio?.deviceId) { const e = new Error('no'); e.name = 'OverconstrainedError'; throw e; }
      return 'stream';
    },
  };
  assert.equal(await openMicrophone({}, media), 'stream');
  assert.deepEqual(asked, [{ deviceId: { exact: 'gone' } }, true]);
  delete globalThis.localStorage;
});

test('the reading voice and dictation mode follow the settings', () => {
  const voices = [{ name: 'A', lang: 'en-US' }, { name: 'B', lang: 'hi-IN' }];
  assert.equal(chosenVoice(voices, store({ sm_tts_voice: 'B' })).name, 'B');
  assert.equal(chosenVoice(voices, store({ sm_tts_voice: 'Z' })), null);
  assert.equal(continuousDictation(store({ sm_continuous_dictation: 'false' })), false);
  assert.equal(continuousDictation(store({})), true);
});
