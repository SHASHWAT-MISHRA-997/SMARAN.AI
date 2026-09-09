import test from 'node:test';
import assert from 'node:assert/strict';
import { speechSegments, dominantLanguage } from '../src/utils/speechSegments.js';

test('a plain English reply is one run in the fallback voice', () => {
  const runs = speechSegments('Opening Chrome now.', 'en-IN');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].lang, 'en-IN');
});

test('a Hindi reply gets a Hindi voice, whatever the picker says', () => {
  // This is the reported fault: the language came from the picker, so a Hindi
  // answer was read by an English voice whenever the picker said English.
  const runs = speechSegments('नमस्ते, मैं ठीक हूँ।', 'en-IN');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].lang, 'hi-IN');
});

test('a mixed reply is split, each part to its own voice', () => {
  const runs = speechSegments('Chrome खोल रहा हूँ now', 'en-IN');
  assert.ok(runs.length >= 2, `expected a split, got ${runs.length}`);
  assert.equal(runs[0].lang, 'en-IN');
  assert.ok(runs.some((r) => r.lang === 'hi-IN'));
});

test('punctuation and spaces do not cut a run in two', () => {
  // One segment per word would mean one engine round trip per word, and the
  // reply would come out in stutters.
  const runs = speechSegments('Hello, there. How are you?', 'en-IN');
  assert.equal(runs.length, 1);
});

test('a stray letter inside a Hindi sentence does not flip the voice', () => {
  const runs = speechSegments('मैं a ठीक हूँ', 'en-IN');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].lang, 'hi-IN');
});

test('other Indian scripts are recognised, not lumped into Hindi', () => {
  assert.equal(speechSegments('வணக்கம்')[0].lang, 'ta-IN');
  assert.equal(speechSegments('નમસ્તે')[0].lang, 'gu-IN');
  assert.equal(speechSegments('ನಮಸ್ಕಾರ')[0].lang, 'kn-IN');
  assert.equal(speechSegments('বাংলা')[0].lang, 'bn-IN');
});

test('the fallback is used for Latin, and is configurable', () => {
  assert.equal(speechSegments('hello', 'en-GB')[0].lang, 'en-GB');
});

test('nothing sayable produces no runs rather than an empty utterance', () => {
  assert.deepEqual(speechSegments(''), []);
  assert.deepEqual(speechSegments('   '), []);
  assert.deepEqual(speechSegments(null), []);
  assert.deepEqual(speechSegments('!!! ...'), []);
});

test('every run carries text; none is blank', () => {
  const runs = speechSegments('नमस्ते! Hello. कैसे हैं?', 'en-IN');
  for (const run of runs) assert.ok(run.text.trim().length > 0);
});

test('the whole reply survives the split', () => {
  // Nothing may be dropped: a segmenter that loses a clause would silently
  // shorten the answer being read out.
  const source = 'Chrome खोल रहा हूँ, ठीक है now.';
  const joined = speechSegments(source, 'en-IN').map((r) => r.text).join('');
  assert.equal(joined.replace(/\s/g, ''), source.replace(/\s/g, ''));
});

// ---- picking one voice, for the path that can only use one ------------------

test('the dominant language is the one covering most of the text', () => {
  assert.equal(dominantLanguage('मैं ठीक हूँ, thanks', 'en-IN'), 'hi-IN');
  assert.equal(dominantLanguage('I am fine, धन्यवाद', 'en-IN'), 'en-IN');
});

test('an empty reply falls back rather than returning nothing', () => {
  assert.equal(dominantLanguage('', 'en-IN'), 'en-IN');
});

test('romanised Hindi is left as English, and that is deliberate', () => {
  // "Chrome kholo" is Latin script and indistinguishable from English here.
  // Recorded so the limit is visible rather than looking like an oversight:
  // fixing it needs transliteration, and guessing from a word list would
  // mispronounce ordinary English words instead.
  assert.equal(dominantLanguage('Chrome kholo', 'en-IN'), 'en-IN');
});
