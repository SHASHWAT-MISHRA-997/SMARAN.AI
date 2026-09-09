import test from 'node:test';
import assert from 'node:assert/strict';
import { voicePersonaRule } from '../src/utils/voicePersona.js';

test('female characters receive feminine Hindi first-person examples', () => {
  const prompt = voicePersonaRule('female');
  assert.match(prompt, /मैं करती हूँ, खोलती हूँ, कर सकती हूँ/);
  assert.doesNotMatch(prompt, /मैं करता हूँ/);
});

test('Energy Core receives masculine grammar independently of female characters', () => {
  const prompt = voicePersonaRule('male');
  assert.match(prompt, /Energy Core/);
  assert.match(prompt, /मैं करता हूँ, खोलता हूँ, कर सकता हूँ/);
  assert.doesNotMatch(prompt, /मैं करती हूँ/);
});
