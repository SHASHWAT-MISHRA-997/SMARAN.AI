// "Skip ad" presses the Skip button in the app in front (SmaranAccessibility).
// It must not be confused with "skip" - the next song - or the other way round.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDeviceCommand, describeOutcome } from '../src/utils/deviceCommands.js';

test('skip ad, however it is said', () => {
  for (const said of ['skip ad', 'Skip the ad', 'skip ads', 'ad skip karo', 'skip ads karo', 'ad hatao',
    'Hey SMARAN skip ad', 'विज्ञापन छोड़ो']) {
    assert.deepEqual(detectDeviceCommand(said), { action: 'skip_ad' }, said);
  }
});

test('skipping a song is still the next song', () => {
  for (const said of ['skip', 'skip this song', 'skip the track', 'skip it']) {
    assert.deepEqual(detectDeviceCommand(said), { action: 'media', control: 'next' }, said);
  }
});

test('what is said back comes from the phone', () => {
  assert.equal(describeOutcome({ action: 'skip_ad' }, { skipped: true, said: 'Skipped.' }), 'Skipped.');
  assert.match(describeOutcome({ action: 'skip_ad' }, { skipped: false }), /no Skip button/);
});
