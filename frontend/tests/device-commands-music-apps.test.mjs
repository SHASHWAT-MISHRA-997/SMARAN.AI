// "Shiv Sadashiv Boliye Spotify par play karo" reached the language model,
// which answered with instructions and a search link instead of playing it.
// A named music service is now a command, addressed to that app.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDeviceCommand, describeOutcome, answerFollowUp } from '../src/utils/deviceCommands.js';

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
    "Opened kesariya in Spotify. Tap it to play - or turn on SMARAN.AI in Android's Accessibility settings, and I'll press play for you.");
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

// The follow-up: a request with no song asks for one, in the language it
// was asked in, and the answer completes it in the app that was named.
test('music with no song named asks which one', () => {
  const spotify = detectDeviceCommand('play music for me on spotify');
  assert.equal(spotify.action, 'ask');
  assert.equal(spotify.app, 'Spotify');
  assert.equal(spotify.question, 'Which song should I play on Spotify?');
  assert.equal(detectDeviceCommand('Hey SMARAN, play music for me on Spotify').app, 'Spotify');
  assert.equal(detectDeviceCommand('spotify par gaana bajao').question, 'Spotify par kaunsa gaana chalaun?');
  assert.equal(detectDeviceCommand('gaana bajao').question, 'Kaunsa gaana sunna hai?');
  assert.equal(detectDeviceCommand('play some music').question, 'Which song would you like to hear?');
  assert.equal(detectDeviceCommand('गाना बजाओ').question, 'कौन सा गाना सुनना है?');
  // A song that is named still plays at once.
  assert.deepEqual(detectDeviceCommand('play kesariya on spotify'), { action: 'music', query: 'kesariya', app: 'Spotify' });
});

test('the answer completes the question', () => {
  const asked = detectDeviceCommand('play music on spotify');
  assert.deepEqual(answerFollowUp(asked, 'Kesariya'), { action: 'music', query: 'Kesariya', app: 'Spotify' });
  assert.deepEqual(answerFollowUp(asked, 'tum hi ho bajao'), { action: 'music', query: 'tum hi ho', app: 'Spotify' });
  assert.deepEqual(answerFollowUp(asked, 'kuch bhi'), { action: 'music', query: '', app: 'Spotify' });
  assert.deepEqual(answerFollowUp(asked, 'rehne do'), { action: 'cancelled' });
  assert.deepEqual(answerFollowUp(asked, 'pause'), { action: 'media', control: 'pause' });
  // A new question is not an answer: forgotten, and it goes to the model.
  assert.equal(answerFollowUp(asked, 'what is the weather today?'), null);
  // Asked with no app: it plays where a song can actually be started.
  const anywhere = detectDeviceCommand('gaana bajao');
  assert.deepEqual(answerFollowUp(anywhere, 'kesariya'), { action: 'youtube', query: 'kesariya', play: true });
});

// Reported: each of these reached the model, which answered with a made-up
// video link. "per" is how many people spell "par".
test('YouTube requests with "per", "ko" and the verb before the place', () => {
  const want = { action: 'youtube', query: 'Sada Shiv boliye', play: true };
  assert.deepEqual(detectDeviceCommand('Sada Shiv boliye ko play karo YouTube per'), want);
  assert.deepEqual(detectDeviceCommand('Sada Shiv boliye YouTube per play karo'), want);
  assert.deepEqual(detectDeviceCommand('Sada Shiv boliye ko YouTube par chalao'), want);
  assert.deepEqual(detectDeviceCommand('YouTube per kesariya chalao'), { action: 'youtube', query: 'kesariya', play: true });
});

// Reported: "Shiv Sadashiv Boliye Spotify par open karo aur play karo" went
// to YouTube as a search for "... spotify par open karo and".
test('opening and playing in one sentence is one request', () => {
  const want = { action: 'music', query: 'shiv sadashiv boliye', app: 'Spotify' };
  assert.deepEqual(detectDeviceCommand('shiv sadashiv boliye spotify par open karo aur play karo'), want);
  assert.deepEqual(detectDeviceCommand('shiv sadashiv boliye spotify par open karo and play karo'), want);
  assert.deepEqual(detectDeviceCommand('open spotify and play shiv sadashiv boliye'), want);
  assert.deepEqual(detectDeviceCommand('spotify kholo aur kesariya chalao'), { action: 'music', query: 'kesariya', app: 'Spotify' });
  assert.deepEqual(detectDeviceCommand('spotify kholo'), { action: 'app', name: 'spotify' });
});
