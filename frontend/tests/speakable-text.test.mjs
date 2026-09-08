/**
 * What the assistant says out loud, as opposed to what it writes.
 *
 * The complaint these cover: the voice read the punctuation. Bullets, table
 * pipes, arrows, emoji and long dashes were all spoken, so a reply sounded
 * like a document being read rather than a person talking.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { speakableText } from '../src/utils/speakableText.js';

const say = (text) => speakableText(text);

test('markdown emphasis is not spoken', () => {
  assert.equal(say('This is **really** important'), 'This is really important');
  assert.equal(say('A _quiet_ word'), 'A quiet word');
});

test('bullet markers are dropped but the items are kept', () => {
  const spoken = say('- First point\n- Second point');
  assert.ok(!spoken.includes('-'), spoken);
  assert.ok(spoken.includes('First point'));
  assert.ok(spoken.includes('Second point'));
});

test('a numbered list keeps its numbers, which a person would say', () => {
  assert.ok(say('1. Open it\n2. Close it').includes('1.'));
});

test('table pipes become pauses rather than "vertical bar"', () => {
  const spoken = say('| Name | Role |\n| --- | --- |\n| Asha | Lead |');
  assert.ok(!spoken.includes('|'), spoken);
  assert.ok(!spoken.includes('---'), spoken);
  assert.ok(spoken.includes('Asha'));
  assert.ok(spoken.includes('Lead'));
});

test('arrows and emoji are not read out', () => {
  const spoken = say('Perceive → decide → act 🚀 ✅');
  assert.ok(!/[→🚀✅]/u.test(spoken), spoken);
  assert.ok(spoken.includes('Perceive'));
  assert.ok(spoken.includes('act'));
});

test('a long dash becomes a pause, not the word dash', () => {
  const spoken = say('It works — mostly');
  assert.ok(!spoken.includes('—'), spoken);
  assert.equal(spoken, 'It works, mostly');
});

test('a hyphen inside a word survives', () => {
  assert.equal(say('a well-known state-of-the-art result'),
               'a well-known state-of-the-art result');
});

test('a standalone hyphen does not', () => {
  assert.ok(!say('Ready - almost').includes('-'));
});

test('a horizontal rule is silent', () => {
  const spoken = say('Before\n\n---\n\nAfter');
  assert.ok(!spoken.includes('-'), spoken);
  assert.ok(spoken.includes('Before') && spoken.includes('After'));
});

test('code blocks are not read aloud', () => {
  const spoken = say('Try this:\n```js\nconst x = 1;\n```\nThat is all.');
  assert.ok(!spoken.includes('const'), spoken);
  assert.ok(spoken.includes('That is all.'));
});

test('inline code keeps its words', () => {
  assert.ok(say('Run `npm test` now').includes('npm test'));
});

test('a link is spoken as its text, never as its address', () => {
  const spoken = say('See [the guide](https://example.com/a/b?c=d)');
  assert.ok(spoken.includes('the guide'));
  assert.ok(!spoken.includes('example.com'), spoken);
});

test('a bare url is not spelled out', () => {
  const spoken = say('Docs at https://example.com/very/long/path here');
  assert.ok(!spoken.includes('example.com'), spoken);
  assert.ok(spoken.includes('Docs at') && spoken.includes('here'));
});

test('headings and quotes lose their marks', () => {
  const spoken = say('## Summary\n> a quoted line');
  assert.ok(!spoken.includes('#') && !spoken.includes('>'), spoken);
  assert.ok(spoken.includes('Summary') && spoken.includes('a quoted line'));
});

// The part that must never regress: this app answers in Indian languages, and
// a cleaner that removed "non-ASCII" would delete the entire reply.
test('Hindi survives untouched', () => {
  const hindi = 'नमस्ते! मैं आपकी किस प्रकार मदद कर सकता हूँ?';
  assert.equal(say(hindi), hindi);
});

test('Hinglish and mixed script survive', () => {
  const mixed = 'Aap **ready** hain? फिर चलिए शुरू करते हैं।';
  const spoken = say(mixed);
  assert.ok(spoken.includes('फिर चलिए शुरू करते हैं।'));
  assert.ok(spoken.includes('ready'));
  assert.ok(!spoken.includes('*'));
});

test('other Indian scripts survive', () => {
  for (const line of ['ગુજરાતી લખાણ', 'தமிழ் உரை', 'ಕನ್ನಡ ಪಠ್ಯ', 'বাংলা লেখা']) {
    assert.equal(say(line), line);
  }
});

test('sentence punctuation is kept so the voice still pauses', () => {
  const spoken = say('First. Second? Third!');
  assert.equal(spoken, 'First. Second? Third!');
});

test('a reply with nothing sayable produces nothing', () => {
  assert.equal(say('```\ncode only\n```'), '');
  assert.equal(say('🚀✅→'), '');
  assert.equal(say('---'), '');
  assert.equal(say(''), '');
});

test('non-strings do not throw', () => {
  assert.equal(say(null), '');
  assert.equal(say(undefined), '');
  assert.equal(say(42), '');
});

test('thinking blocks are never spoken', () => {
  assert.equal(say('<think>hmm, maybe</think>The answer is four.'),
               'The answer is four.');
});

test('a realistic mixed reply reads as prose', () => {
  const spoken = say([
    '## Result ✅',
    '',
    '- **Speed** — much faster',
    '- Uses `cache.get()`',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    '| Time | 1.2s |',
    '',
    'See [docs](https://example.com).',
  ].join('\n'));

  for (const symbol of ['#', '*', '|', '`', '—', '✅', '---', 'example.com']) {
    assert.ok(!spoken.includes(symbol), `${symbol} was left in: ${spoken}`);
  }
  assert.ok(spoken.includes('Speed'));
  assert.ok(spoken.includes('much faster'));
  assert.ok(spoken.includes('cache.get()'));
  assert.ok(spoken.includes('docs'));
});
