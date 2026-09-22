import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDeviceCommand, isBeingDiscussed, describeOutcome,
} from '../src/utils/deviceCommands.js';

// ---- the two word orders ---------------------------------------------------

test('verb first, in English', () => {
  assert.deepEqual(detectDeviceCommand('open Chrome'), { action: 'app', name: 'Chrome' });
  assert.deepEqual(detectDeviceCommand('launch WhatsApp'), { action: 'app', name: 'WhatsApp' });
});

test('verb last, in Hinglish', () => {
  // The reported shape. Hindi puts the verb at the end and the desktop build
  // already had to learn this.
  assert.deepEqual(detectDeviceCommand('Chrome kholo'), { action: 'app', name: 'Chrome' });
  assert.deepEqual(detectDeviceCommand('WhatsApp khol do'), { action: 'app', name: 'WhatsApp' });
  assert.deepEqual(detectDeviceCommand('calculator chalu karo'), { action: 'app', name: 'calculator' });
});

test('a trailing politeness is not part of the app name', () => {
  assert.deepEqual(detectDeviceCommand('open Chrome please'), { action: 'app', name: 'Chrome' });
  assert.deepEqual(detectDeviceCommand('Chrome kholo zara'), { action: 'app', name: 'Chrome' });
});

test('the word "app" is not part of the name', () => {
  assert.deepEqual(detectDeviceCommand('open the Zomato app'), { action: 'app', name: 'Zomato' });
});

// ---- YouTube beats the generic rules ---------------------------------------

test('a YouTube search is a YouTube search, not a song', () => {
  assert.deepEqual(detectDeviceCommand('play on youtube arijit singh'),
    { action: 'youtube', query: 'arijit singh' });
  assert.deepEqual(detectDeviceCommand('youtube pe arijit singh chalao'),
    { action: 'youtube', query: 'arijit singh' });
  assert.deepEqual(detectDeviceCommand('play despacito on youtube'),
    { action: 'youtube', query: 'despacito' });
});

test('opening YouTube with nothing to search for', () => {
  assert.deepEqual(detectDeviceCommand('open youtube'), { action: 'youtube' });
  assert.deepEqual(detectDeviceCommand('youtube kholo'), { action: 'youtube' });
});

// ---- music -----------------------------------------------------------------
test('spoken channel request routes to YouTube instead of an app name', () => {
  for (const sentence of ['Shashwat Mishra Techie youtube par channel ko open karo',
    'Shashwat Mishra Techie यूट्यूब पर चैनल को खोलो']) {
    assert.deepEqual(detectDeviceCommand(sentence), { action: 'youtube', query: 'Shashwat Mishra Techie' });
  }
  assert.equal(detectDeviceCommand('Shashwat Mishra Techie youtube par channel ko open karo mat'), null);
});

test('a song, named or not', () => {
  assert.deepEqual(detectDeviceCommand('gaana bajao'), { action: 'music' });
  assert.deepEqual(detectDeviceCommand('koi gaana chalao'), { action: 'music' });
  assert.deepEqual(detectDeviceCommand('play music'), { action: 'music' });
  assert.deepEqual(detectDeviceCommand('kesariya gaana bajao'),
    { action: 'music', query: 'kesariya' });
});

// ---- a spoken web address --------------------------------------------------

test('a full address opens as a page, not as an app named http', () => {
  assert.deepEqual(detectDeviceCommand('open https://example.com'),
    { action: 'url', url: 'https://example.com' });
});

// ---- what must NOT run -----------------------------------------------------

test('a refusal is not an instruction', () => {
  assert.equal(detectDeviceCommand("don't open Chrome"), null);
  assert.equal(detectDeviceCommand('Chrome mat kholo'), null);
  assert.equal(detectDeviceCommand('nahi Chrome kholo'), null);
});

test('a question about the command is not the command', () => {
  assert.equal(detectDeviceCommand('how do I open Chrome'), null);
  assert.equal(detectDeviceCommand('Chrome kaise kholte hain'), null);
  assert.equal(detectDeviceCommand('kya Chrome kholo'), null);
});

test('a quoted command is being talked about', () => {
  assert.equal(detectDeviceCommand('I said "open Chrome"'), null);
});

test('"band karo" is a real instruction and must not be read as a refusal', () => {
  // Removing stop/cancel/band karo from the refusal list was a fix in the
  // backend; the same mistake must not be reintroduced here.
  assert.equal(isBeingDiscussed('awaz band karo'), false);
  assert.equal(isBeingDiscussed('stop'), false);
});

test('ordinary conversation is left alone', () => {
  assert.equal(detectDeviceCommand('tell me about photosynthesis'), null);
  assert.equal(detectDeviceCommand('hello'), null);
  assert.equal(detectDeviceCommand(''), null);
  assert.equal(detectDeviceCommand(null), null);
});

test('a long sentence is prose, not an instruction', () => {
  const essay = 'open the door and then explain in detail how the building was '
    + 'constructed and who the architect was and what year it happened';
  assert.equal(detectDeviceCommand(essay), null);
});

test('a single stray letter is not an app', () => {
  assert.equal(detectDeviceCommand('open a'), null);
});

// ---- what is said back -----------------------------------------------------

test('an app that is not installed is said plainly, not reported as opened', () => {
  const command = { action: 'app', name: 'Photoshop' };
  const said = describeOutcome(command, { opened: false, reason: 'not-installed' });
  assert.match(said, /can't find Photoshop/i);
});

test('the label the phone actually launched is what gets said', () => {
  const said = describeOutcome({ action: 'app', name: 'chrome' },
    { opened: true, label: 'Google Chrome' });
  assert.match(said, /Google Chrome/);
});

test('a YouTube search is described as a search', () => {
  // The honesty fix from the desktop build: a search is not "playing a song".
  const said = describeOutcome({ action: 'youtube', query: 'lofi' }, { opened: true });
  assert.match(said, /Searching YouTube/i);
  assert.doesNotMatch(said, /playing/i);
});

/**
 * Hindi spoken aloud arrives in Devanagari, not in Latin.
 *
 * The speech engine picks the script, not the speaker. Whisper transcribes
 * Hindi as "यूट्यूब खोलो", never as "youtube kholo", so a person who talks to
 * the microphone in Hindi produced text that matched none of these rules and
 * the request fell through to the language model - which is the exact failure
 * this module exists to prevent. It was only ever prevented for people typing
 * in Latin script.
 *
 * Found by synthesising speech, transcribing it through the app's own
 * endpoint, and feeding the result back in.
 */
test('a command spoken in Hindi is recognised in Devanagari', () => {
  const cases = [
    ['यूट्यूब खोलो', 'youtube'],
    ['सेटिंग्स खोलो', 'app'],
    ['कैलकुलेटर खोलो', 'app'],
    ['व्हाट्सएप खोलो', 'app'],
    ['गाना बजाओ', 'music'],
    ['कोई गाना चलाओ', 'music'],
    ['संगीत चलाओ', 'music'],
    ['यूट्यूब पर तुम ही हो चलाओ', 'youtube'],
  ];
  for (const [utterance, action] of cases) {
    const got = detectDeviceCommand(utterance);
    assert.ok(got, `${utterance} was not recognised at all`);
    assert.equal(got.action, action, `${utterance} became ${got.action}`);
  }
});

test('the romanised spellings still work, unchanged', () => {
  // The Devanagari was added beside them, not instead of them.
  for (const [utterance, action] of [
    ['youtube kholo', 'youtube'],
    ['settings kholo', 'app'],
    ['open calculator', 'app'],
    ['gaana bajao', 'music'],
    ['koi gaana chalao', 'music'],
    ['tum hi ho youtube par lagao', 'youtube'],
  ]) {
    assert.equal(detectDeviceCommand(utterance)?.action, action, utterance);
  }
});
