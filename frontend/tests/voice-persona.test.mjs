import test from 'node:test';
import assert from 'node:assert/strict';
import { liveVoiceForPersona, REFERENCE_LIVE_VOICES } from '../src/utils/liveVoicePersona.js';

test('reference characters keep the recovered Gemini voice', () => {
  assert.equal(liveVoiceForPersona('myra'), 'Aoede');
  assert.equal(liveVoiceForPersona('myraa'), 'Aoede');
  assert.equal(liveVoiceForPersona('amarya'), 'Aoede');
  assert.equal(liveVoiceForPersona('evelyn'), 'Aoede');
  assert.equal(liveVoiceForPersona('core'), 'Orus');
});

test('unknown personas fail closed to the female reference voice', () => {
  assert.equal(liveVoiceForPersona('other'), 'Aoede');
  assert.deepEqual(Object.keys(REFERENCE_LIVE_VOICES).sort(), ['amarya', 'core', 'evelyn', 'myra', 'myraa']);
});

