/**
 * The two numbers the animated surfaces share.
 *
 * Both the Energy Core and the stage behind it read the same microphone level
 * and the same spoken line, and both had their own idea of what those meant.
 * Keeping the conversion here means one definition to test and one place to be
 * wrong, rather than two that drift.
 *
 * This file is plain JavaScript on purpose: the components are JSX, which a
 * bare Node test runner cannot import, and these are the parts worth testing.
 */

/**
 * Microphone level as a 0..1 unit value.
 *
 * The voice assistant reports level on a 0..100 scale. Both surfaces treated
 * it as though it were already 0..1 - the core multiplied by 1.6 and clamped,
 * the stage clamped directly - so any sound at all pinned both at maximum. A
 * whisper and a shout drew the identical frame.
 *
 * Values above 1 are read as percentages and values at or below 1 as unit
 * scale, so this stays correct whichever way a caller supplies it.
 */
export function normalizeLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, unit));
}

/**
 * A stylistic tint bias read from the line the assistant just said.
 *
 * Literal pattern matching on punctuation and a short word list. It is not
 * sentiment analysis, it does not model emotion, and nothing downstream should
 * describe it as either. It exists so a long answer does not sit under one
 * unchanging colour.
 *
 * Returns a hue nudge in degrees, a small energy bias, and the label that
 * produced them so a test can assert on the reason rather than the numbers.
 */
export function analyseTone(text) {
  const line = String(text || '').slice(0, 400).toLowerCase();
  if (!line.trim()) return { hue: 0, energy: 0, label: 'neutral' };
  // Checked before the punctuation rules: "Sorry, I could not find that?"
  // is an apology that happens to end in a question mark.
  if (/\b(sorry|cannot|can't|could not|couldn't|unable|failed|error|not found|denied)\b/.test(line)) {
    return { hue: -46, energy: -0.1, label: 'apologetic' };
  }
  if (/\b(done|ready|complete|completed|installed|saved|success|works|worked|working|fixed)\b/.test(line)) {
    return { hue: 42, energy: 0.16, label: 'affirmative' };
  }
  if (line.includes('?')) return { hue: 26, energy: 0.08, label: 'inquisitive' };
  if (line.includes('!')) return { hue: 14, energy: 0.2, label: 'emphatic' };
  return { hue: 0, energy: 0, label: 'neutral' };
}
