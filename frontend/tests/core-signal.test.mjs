import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyseTone, normalizeLevel } from '../src/utils/coreSignal.js';

test('a 0..100 microphone level keeps its range instead of pinning at maximum', () => {
  // The regression this exists for: both animated surfaces treated the
  // assistant's 0..100 level as though it were 0..1, so every sound above a
  // fraction of one percent produced an identical frame.
  assert.equal(normalizeLevel(0), 0);
  assert.equal(normalizeLevel(25), 0.25);
  assert.equal(normalizeLevel(50), 0.5);
  assert.equal(normalizeLevel(100), 1);

  // Quiet speech and loud speech must not land on the same number.
  assert.ok(normalizeLevel(12) < normalizeLevel(70));
  assert.ok(normalizeLevel(12) > 0);
});

test('unit-scale callers are still read correctly', () => {
  assert.equal(normalizeLevel(0.4), 0.4);
  assert.equal(normalizeLevel(1), 1);
});

test('unusable levels are silence, not a crash or a full-power core', () => {
  for (const value of [undefined, null, '', NaN, Infinity, -5, 'loud']) {
    assert.equal(normalizeLevel(value), 0, `expected silence for ${String(value)}`);
  }
});

test('levels above the reported maximum still clamp', () => {
  assert.equal(normalizeLevel(140), 1);
  assert.equal(normalizeLevel(1e9), 1);
});

test('tone mapping reads punctuation and wording, and nothing more', () => {
  assert.equal(analyseTone('').label, 'neutral');
  assert.equal(analyseTone('   ').label, 'neutral');
  assert.equal(analyseTone('The file is at the top of the folder.').label, 'neutral');
  assert.equal(analyseTone('Would you like me to open it?').label, 'inquisitive');
  assert.equal(analyseTone('That worked perfectly!').label, 'affirmative');
  assert.equal(analyseTone('Watch out!').label, 'emphatic');
  assert.equal(analyseTone('Sorry, I could not find that file.').label, 'apologetic');
});

test('an apology that ends in a question mark is still an apology', () => {
  // Punctuation is checked after wording for exactly this case; the other
  // order made every failure read as a cheerful question.
  assert.equal(analyseTone('Sorry, could you say that again?').label, 'apologetic');
});

test('tone output stays within the small bias the visual expects', () => {
  const lines = ['', 'hello', 'done!', 'why?', 'failed to connect', 'Amazing!'];
  for (const line of lines) {
    const tone = analyseTone(line);
    assert.ok(Math.abs(tone.hue) <= 60, `hue out of range for ${line}`);
    assert.ok(Math.abs(tone.energy) <= 0.25, `energy out of range for ${line}`);
    assert.equal(typeof tone.label, 'string');
  }
});

test('a very long answer is bounded before matching', () => {
  // The tint is a decoration; it must not turn into an unbounded regex scan
  // over an entire essay on every spoken line.
  const long = `${'a'.repeat(5000)} sorry`;
  assert.equal(analyseTone(long).label, 'neutral');
});
