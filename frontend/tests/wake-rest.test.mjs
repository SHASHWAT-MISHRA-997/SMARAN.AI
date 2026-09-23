// "Hey SMARAN, open YouTube" said to the desktop: the instruction after the
// name is carried out, and the name alone is answered with a question.
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window ??= {};
const { wakeRest } = await import('../src/utils/wakeWord.js');

test('what follows the wake phrase is the instruction', () => {
  assert.equal(wakeRest('Hey Smaran open YouTube'), 'open youtube');
  assert.equal(wakeRest('Hey Amarya, what is the time?'), 'what is the time');
  assert.equal(wakeRest('ok so jarvis play music'), 'play music');
  assert.equal(wakeRest('Hey SMARAN AI, pause'), 'pause');
});

test('the name alone leaves nothing to do', () => {
  assert.equal(wakeRest('hey smaran'), '');
  assert.equal(wakeRest('Hey Myra!'), '');
  assert.equal(wakeRest('hello there'), '');
});
