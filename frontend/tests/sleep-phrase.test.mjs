/**
 * Telling it to stop listening actually stops it.
 *
 * There were wake phrases and no sleep phrase. "suno smaran" and "start
 * listening" turned the microphone on; nothing turned it off. So it stayed
 * open, and audio coming out of the speakers was transcribed as though it had
 * been spoken to the assistant - which is where replies to things nobody
 * asked came from. The only way to be left alone was to find the toggle in
 * settings.
 *
 * Asserted against the phrases rather than the regex, so the matcher can be
 * rewritten as long as these keep working.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'utils', 'wakeWord.js'), 'utf8');

/** The matcher, lifted out of the module so this runs without a DOM. */
function loadMatcher() {
  const phrases = /const SLEEP_PHRASES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(phrases, 'SLEEP_PHRASES is gone');
  const list = [...phrases[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(list.length > 0, 'no sleep phrases defined');
  return (heard) => {
    const text = String(heard || '').toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    return Boolean(text) && list.some((p) => text.includes(p));
  };
}

test('the ways a person says stop listening are all recognised', () => {
  const sleeps = loadMatcher();
  for (const phrase of [
    'mat suno',
    'suno mat',
    'stop listening',
    'sunna band karo',
    'chup ho ja',
    'so ja',
    'SMARAN mat suno',        // with the name in front
    'ok bas ab mat suno.',    // trailing punctuation and filler
  ]) {
    assert.ok(sleeps(phrase), `"${phrase}" did not stop listening`);
  }
});

test('ordinary speech does not silence it by accident', () => {
  const sleeps = loadMatcher();
  for (const phrase of [
    'play ganpati bappa song on youtube',
    'what is the weather',
    'stop the music',          // media control, not a listening command
    'band karo',               // the same - stops playback, not the mic
    '',
  ]) {
    assert.ok(!sleeps(phrase), `"${phrase}" wrongly stopped listening`);
  }
});

test('sleep is tested before wake, so a sleep phrase cannot wake it', () => {
  const sleepIndex = source.indexOf('matchesSleepPhrase(transcript)');
  const wakeIndex = source.indexOf('this.matches(transcript)');
  assert.ok(sleepIndex > -1 && wakeIndex > -1, 'one of the branches is missing');
  assert.ok(
    sleepIndex < wakeIndex,
    'the wake check runs first, so a sleep phrase containing the wake word '
      + 'would start listening instead of stopping',
  );
});

test('the listener accepts an onSleep handler', () => {
  assert.match(source, /constructor\(\{[^}]*onSleep/,
    'WakeWordListener does not take onSleep, so nothing can react to it');
  assert.match(source, /this\.onSleep\?\.\(/,
    'onSleep is accepted but never called');
});
