import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wordSpans, spokenWordCount, displayOffsetForWords, captionSplit,
} from '../src/utils/spokenProgress.js';

// The engines report a character offset into the *stripped* string. These
// check that the offset still lands in the right place in the displayed one.

test('words are found with their positions', () => {
  const spans = wordSpans('Hello there');
  assert.deepEqual(spans.map(s => s.key), ['hello', 'there']);
  assert.deepEqual(spans.map(s => [s.start, s.end]), [[0, 5], [6, 11]]);
});

test('punctuation and case do not make a different word', () => {
  assert.deepEqual(wordSpans('**Chrome**,').map(s => s.key), ['chrome']);
  assert.deepEqual(wordSpans("don't").map(s => s.key), ["don't"]);
});

test('scripts other than Latin are words too', () => {
  // The mistake this guards against is treating "not ASCII" as "not a word",
  // which has already happened once in this project.
  assert.deepEqual(wordSpans('नमस्ते दोस्त').length, 2);
});

test('the regex does not carry state between calls', () => {
  // A shared /g regex would resume from lastIndex and lose the first word.
  const first = wordSpans('one two');
  const second = wordSpans('one two');
  assert.deepEqual(first, second);
});

test('a word counts as spoken once it has started', () => {
  const spoken = 'Opening Chrome now';
  assert.equal(spokenWordCount(spoken, 0), 1);    // "Opening"
  assert.equal(spokenWordCount(spoken, 8), 2);    // "Chrome"
  assert.equal(spokenWordCount(spoken, 15), 3);   // "now"
});

test('nothing has been spoken before the voice starts', () => {
  assert.equal(spokenWordCount('anything', -1), 0);
  assert.equal(spokenWordCount('anything', undefined), 0);
});

test('the highlight closes on a word boundary, never mid-word', () => {
  const displayText = 'Opening Chrome now.';
  const offset = displayOffsetForWords({
    displayText, spokenText: 'Opening Chrome now', spokenWords: 2,
  });
  assert.equal(displayText.slice(0, offset), 'Opening Chrome');
});

test('symbols stripped for speech do not shift the highlight', () => {
  // This is the whole point. The voice never says the asterisks or the arrow,
  // so its offsets are short of the displayed ones by a growing amount.
  const displayText = '**Opening** Chrome -> now';
  const spokenText = 'Opening Chrome now';
  const { spoken } = captionSplit({
    displayText, spokenText, charIndex: spokenText.indexOf('Chrome'),
  });
  assert.equal(spoken, '**Opening** Chrome');
});

test('display words the voice never says are skipped, not highlighted twice', () => {
  const displayText = 'Run `npm install` first';
  const spokenText = 'Run first';
  const { spoken } = captionSplit({
    displayText, spokenText, charIndex: spokenText.indexOf('first'),
  });
  assert.ok(spoken.endsWith('first'), `highlight ended at: ${JSON.stringify(spoken)}`);
});

test('the highlight only ever moves forward', () => {
  // A repeated word must not drag the highlight back to its first occurrence.
  const displayText = 'open the door and open the window';
  const spokenText = 'open the door and open the window';
  let previous = 0;
  for (let i = 0; i < spokenText.length; i += 1) {
    const { offset } = captionSplit({ displayText, spokenText, charIndex: i });
    assert.ok(offset >= previous, `went backwards at ${i}: ${offset} < ${previous}`);
    previous = offset;
  }
});

test('before speaking and after it stops, the caption is plain', () => {
  const displayText = 'All done.';
  const before = captionSplit({ displayText, spokenText: 'All done', charIndex: -1 });
  assert.equal(before.spoken, '');
  assert.equal(before.pending, displayText);
});

test('an empty caption produces nothing rather than throwing', () => {
  assert.deepEqual(captionSplit({}), { spoken: '', pending: '', offset: 0 });
  assert.deepEqual(captionSplit({ displayText: null, spokenText: null, charIndex: 3 }),
    { spoken: '', pending: '', offset: 0 });
});

test('a spoken word with no match on screen holds the highlight still', () => {
  // Some engines expand abbreviations - "Dr" spoken as "Doctor". That word is
  // not on screen; the highlight should wait rather than run to the end.
  const displayText = 'Ask Dr Rao about it';
  const spokenText = 'Ask Doctor Rao about it';
  const { spoken } = captionSplit({
    displayText, spokenText, charIndex: spokenText.indexOf('Doctor'),
  });
  assert.equal(spoken, 'Ask');
});

test('the last word can be reached', () => {
  const displayText = 'one two three';
  const spokenText = 'one two three';
  const { offset } = captionSplit({
    displayText, spokenText, charIndex: spokenText.lastIndexOf('three'),
  });
  assert.equal(offset, displayText.length);
});
