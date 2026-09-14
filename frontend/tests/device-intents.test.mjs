/**
 * The phone must answer the same sentences the desktop does.
 *
 * Reported from a real handset: asking SMARAN to play a song on YouTube came
 * back with "mere paas aise koi tool nahi hai jo aapke device par apps open ya
 * videos play kare" - I have no tool that opens apps or plays videos on your
 * device. The phone was perfectly able to; the sentence never reached the part
 * that could do it.
 *
 * The phone has its own matcher rather than calling the backend, because a
 * standalone install has no paired desktop and a local action must not depend
 * on the network. Two matchers, one contract - and the contract was where it
 * went wrong. Four of the seven phrasings the desktop handles matched nothing
 * here:
 *
 *     ganpati bappa song youtube par play karo   NO MATCH
 *     arijit singh song youtube pe bajao         NO MATCH
 *     tum hi ho youtube par lagao                NO MATCH
 *     ganpati bappa gaana youtube pe chalao      NO MATCH
 *
 * All four put what to play *before* the site, which is the most common way it
 * is said. The desktop had the same gap once; it was fixed there and not here.
 * "lagao" was missing from the verbs entirely.
 *
 * The phrases are read from shared/device-intents.json, which the Python suite
 * reads too, so the two sides cannot drift apart again without a test failing.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { detectDeviceCommand, isBeingDiscussed } from '../src/utils/deviceCommands.js';

const here = dirname(fileURLToPath(import.meta.url));
const shared = JSON.parse(
  readFileSync(join(here, '..', '..', 'shared', 'device-intents.json'), 'utf8'),
);

test('every phrasing the desktop plays, the phone plays too', () => {
  for (const phrase of shared.play_on_youtube) {
    const command = detectDeviceCommand(phrase);
    assert.ok(command, `reached nothing on the phone: ${phrase}`);
    assert.equal(command.action, 'youtube', phrase);
    assert.ok(command.query && command.query.trim(), `no query for: ${phrase}`);
    assert.ok(
      !/youtube/i.test(command.query),
      `the site name leaked into the search: ${command.query}`,
    );
  }
});

test('the phone searches for exactly what the backend searches for', () => {
  // Not just "a query" - the right one. Checking only that it was non-empty
  // is what let a third matcher search YouTube for "par", the postposition,
  // and report success. Two matchers that disagree mean the result depends on
  // which screen you happened to be on.
  for (const [phrase, expected] of Object.entries(shared.expected_query)) {
    const command = detectDeviceCommand(phrase);
    assert.ok(command, `reached nothing: ${phrase}`);
    assert.equal(command.query.trim(), expected, phrase);
  }
});

test('the search is never a grammatical particle', () => {
  for (const phrase of shared.play_on_youtube) {
    const query = detectDeviceCommand(phrase).query.trim().toLowerCase();
    assert.ok(
      !['par', 'pe', 'on', 'mein', 'me', 'youtube'].includes(query),
      `searched for the particle instead of the song: ${phrase} -> ${query}`,
    );
  }
});

test('what is being played survives, whichever order it is said in', () => {
  // Both orders carry the same song. If the subject is lost the phone opens
  // YouTube and searches for nothing, which looks like it half worked.
  assert.match(
    detectDeviceCommand('ganpati bappa song youtube par play karo').query,
    /ganpati bappa/i,
  );
  assert.match(
    detectDeviceCommand('play ganpati bappa on youtube').query,
    /ganpati bappa/i,
  );
});

test('the phrasing that was reported now works', () => {
  const command = detectDeviceCommand('Dante Vakratundaya youtube par play karo');
  assert.ok(command, 'the reported sentence still reaches nothing');
  assert.equal(command.action, 'youtube');
  assert.match(command.query, /Dante Vakratundaya/i);
});

test('a bare open request just opens it', () => {
  for (const phrase of shared.open_youtube_plain) {
    const command = detectDeviceCommand(phrase);
    assert.ok(command, `reached nothing: ${phrase}`);
    assert.equal(command.action, 'youtube');
    assert.ok(!command.query, `a bare open should carry no query: ${phrase}`);
  }
});

test('talking about YouTube is not an instruction to open it', () => {
  // The dangerous direction: reading a question as a command hijacks it, and
  // the user gets an app launch instead of an answer.
  for (const phrase of shared.not_a_device_command) {
    const command = detectDeviceCommand(phrase);
    const guarded = command === null || isBeingDiscussed(phrase);
    assert.ok(guarded, `wrongly treated as a command: ${phrase}`);
  }
});

test('an ordinary message is left alone', () => {
  for (const phrase of [
    'hello',
    'explain recursion to me',
    'write a python function that reverses a list',
  ]) {
    assert.equal(detectDeviceCommand(phrase), null, phrase);
  }
});

test('nothing crashes on rubbish input', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(detectDeviceCommand(value), null);
  }
});
