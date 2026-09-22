/**
 * English is the default, and the default is the part that was missing.
 *
 * The picker was already `'en'`. Every non-English choice produced a named
 * instruction; English produced nothing at all, and a model given no
 * instruction drifts. On this build it drifted to Hindi - an English question
 * about a Python function came back with Hindi prose and a Hindi comment
 * inside the code.
 *
 * The phone makes it worse: with no desktop paired it calls the provider
 * directly and never reaches the backend, so the backend's rules do not apply
 * to it at all. These cover the copy that runs there.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { languageRule, languageName, CODE_OUTPUT_RULE } from '../src/utils/replyRules.js';

test('English is stated explicitly rather than left unsaid', () => {
  const rule = languageRule('en');
  assert.match(rule, /respond entirely in English/i);
  // Naming the drift is the point: a bare "respond in English" was not enough.
  assert.match(rule, /Hindi/);
  assert.match(rule, /do not mix languages/i);
});

test('no selection at all still means English', () => {
  for (const empty of [undefined, null, '', '   ']) {
    assert.match(languageRule(empty), /respond entirely in English/i);
  }
});

test('an unknown code falls back to English rather than being passed through', () => {
  // "Respond entirely in xx" is not an instruction a model can follow.
  assert.match(languageRule('xx'), /respond entirely in English/i);
  assert.equal(languageName('xx'), '');
});

test('a chosen language wins and is named, not coded', () => {
  const rule = languageRule('gu');
  assert.match(rule, /Respond entirely in Gujarati/);
  assert.doesNotMatch(rule, /entirely in gu\b/);
});

test('the choice is case insensitive', () => {
  assert.match(languageRule('HI'), /Respond entirely in Hindi/);
});

test('a chosen language still keeps code untouched', () => {
  assert.match(languageRule('hi'), /Keep code, commands, URLs and product names unchanged/);
});

test('the code rule keeps code in English whatever the reply language is', () => {
  assert.match(CODE_OUTPUT_RULE, /identifiers, keywords, comments and string literals/);
  assert.match(CODE_OUTPUT_RULE, /in English/);
  assert.match(CODE_OUTPUT_RULE, /Never translate code/);
});

test('the code rule asks for something that actually runs when pasted', () => {
  assert.match(CODE_OUTPUT_RULE, /runs as pasted/);
  assert.match(CODE_OUTPUT_RULE, /include every import/);
  assert.match(CODE_OUTPUT_RULE, /never elide a body/);
});

// "Speak in Hinglish" was answered in Arabic on a phone. Part of it was the
// model; part was this rule, which with the picker on its English default
// told the model "Do not switch to Hindi, Hinglish".
test('the default follows the language the person writes in', () => {
  const rule = languageRule('en');
  assert.match(rule, /latest message/);
  assert.match(rule, /Hinglish/);
  assert.match(rule, /reply in natural Hinglish/);
  assert.doesNotMatch(rule, /Do not switch to Hindi, Hinglish/);
});

test('an explicit request for a language is followed, whatever the picker says', () => {
  for (const code of ['en', 'hi', 'gu']) {
    assert.match(languageRule(code), /explicitly asks you to use a particular language/);
    assert.match(languageRule(code), /speak in Hinglish/);
  }
});

test('nobody is answered in a language they did not use or ask for', () => {
  assert.match(languageRule('en'), /Never reply in a language they neither used nor asked for/);
});
