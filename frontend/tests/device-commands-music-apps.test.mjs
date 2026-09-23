// "Shiv Sadashiv Boliye Spotify par play karo" reached the language model,
// which answered with instructions and a search link instead of playing it.
// A named music service is now a command, addressed to that app.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDeviceCommand, describeOutcome } from '../src/utils/deviceCommands.js';

const cases = [
  ['Shiv Sadashiv Boliye Spotify par play karo', 'Shiv Sadashiv Boliye', 'Spotify'],
  ['play kesariya on spotify', 'kesariya', 'Spotify'],
  ['spotify pe tum hi ho bajao', 'tum hi ho', 'Spotify'],
  ['kesariya song spotify par chalao', 'kesariya', 'Spotify'],
  ['स्पॉटिफाई पर केसरिया चलाओ', 'केसरिया', 'Spotify'],
  ['play believer on youtube music', 'believer', 'YouTube Music'],
  ['arijit singh wynk par bajao', 'arijit singh', 'Wynk'],
];

for (const [said, query, app] of cases) {
  test(`"${said}" plays in ${app}`, () => {
    assert.deepEqual(detectDeviceCommand(said), { action: 'music', query, app });
  });
}

test('YouTube and plain app opening are unchanged', () => {
  assert.deepEqual(detectDeviceCommand('youtube par kesariya chalao'), { action: 'youtube', query: 'kesariya', play: true });
  assert.deepEqual(detectDeviceCommand('spotify kholo'), { action: 'app', name: 'spotify' });
});

test('talking about it is not a command', () => {
  assert.equal(detectDeviceCommand("don't play kesariya on spotify"), null);
});

test('what it says back names the app, and says so when it is missing', () => {
  const cmd = { action: 'music', query: 'kesariya', app: 'Spotify' };
  assert.equal(describeOutcome(cmd, { opened: true }), 'Playing kesariya on Spotify.');
  assert.equal(describeOutcome(cmd, { opened: true, mode: 'search' }),
    'Opened kesariya in Spotify. Tap it to play.');
  assert.equal(describeOutcome(cmd, { opened: false, reason: 'not-installed' }), "Spotify isn't installed on this phone.");
});

// Real control of whatever is playing - pause, resume, next, volume - and a
// song with no service named plays on YouTube rather than reaching the model.
test('media controls are commands, instantly', () => {
  const cases = { pause: 'pause', ruko: 'pause', 'gaana roko': 'pause', stop: 'stop', 'gaana band karo': 'stop',
    resume: 'play', play: 'play', chalao: 'play', next: 'next', 'agla gaana': 'next', previous: 'previous',
    'volume badhao': 'volume_up', 'awaz kam karo': 'volume_down', mute: 'mute', 'रुको': 'pause', 'अगला गाना': 'next' };
  for (const [said, control] of Object.entries(cases)) {
    assert.deepEqual(detectDeviceCommand(said), { action: 'media', control }, said);
  }
});

test('a song with no service named plays on YouTube', () => {
  assert.deepEqual(detectDeviceCommand('play despacito'), { action: 'youtube', query: 'despacito', play: true });
  assert.deepEqual(detectDeviceCommand('kesariya bajao'), { action: 'youtube', query: 'kesariya', play: true });
  assert.equal(detectDeviceCommand("don't play despacito"), null);
});
