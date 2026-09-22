// The default model a phone is given when a key is pasted.
//
// Groq's list sorted smallest-first and then alphabetically put "allam-2-7b"
// on top - an Arabic model - so asked "Speak in Hinglish" the phone apologised
// in Arabic. Nobody had chosen it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const GROQ = ['allam-2-7b', 'compound-beta', 'gemma2-9b-it', 'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile', 'meta-llama/llama-guard-4-12b', 'whisper-large-v3'];
globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: GROQ.map((id) => ({ id })) }) });

const standalone = await import('../src/utils/standalone.js');

test('a Groq key gets a general model, not the Arabic one', async () => {
  const chosen = await standalone.pickDefaultModel('groq', 'test-key');
  assert.equal(chosen, 'llama-3.3-70b-versatile');
});

test('a language-specialist model is never first in the list', () => {
  const order = standalone.usable(GROQ.map((id) => ({ id }))).map((m) => m.id);
  assert.notEqual(order[0], 'allam-2-7b');
  assert.ok(order.indexOf('allam-2-7b') > order.indexOf('llama-3.3-70b-versatile'));
});

test('a phone already stuck on the Arabic model is repaired', () => {
  delete store.sm_response_language;
  store.sm_direct_model = 'allam-2-7b';
  assert.equal(standalone.getModel(), '');
  assert.equal(store.sm_direct_model, undefined);
});

test('someone replying in Arabic keeps it', () => {
  store.sm_response_language = 'ar';
  store.sm_direct_model = 'allam-2-7b';
  assert.equal(standalone.getModel(), 'allam-2-7b');
  delete store.sm_response_language;
});

test('an ordinary chosen model is left alone', () => {
  store.sm_direct_model = 'gemma2-9b-it';
  assert.equal(standalone.getModel(), 'gemma2-9b-it');
});
