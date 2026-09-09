/**
 * Where the voice has reached in the line on screen.
 *
 * The caption should move the way song lyrics do: the words already spoken
 * behind the voice, the rest still ahead of it.
 *
 * The difficulty is that the text being spoken is not the text on screen.
 * `speakableText` strips markdown, symbols and stray punctuation before the
 * engine ever sees it, through a chain of regular expressions. Both the Web
 * Speech API (`onboundary`) and Android TTS (`onRangeStart`) report progress as
 * a character offset into the string *they* were given - the stripped one - and
 * that offset points at the wrong place in the displayed string, drifting
 * further with every symbol removed.
 *
 * Threading an index map through those replacements would be fragile: every
 * future rule in `speakableText` would have to maintain it, and one that
 * forgot would misplace the highlight rather than fail loudly.
 *
 * So the two strings are aligned by *word* instead. Stripping changes the
 * punctuation around words, not the words themselves or their order, which
 * makes the word sequence the stable thing to match on. Alignment walks both
 * sequences forward and skips display words that are not in the spoken text -
 * the contents of a code fence, say. It never walks backwards, so the
 * highlight cannot jump back mid-sentence even when a match is missed.
 */

// Matching ignores case, punctuation and the marks around a word, so
// "**Chrome**," and "chrome" are one word. Devanagari and other scripts are
// covered by \p{L} rather than by an ASCII range - an earlier bug in this
// project came from treating "not ASCII" as "not speakable".
//
// \p{M} is in the continuation class and not there by decoration. Indic vowel
// signs and the virama are combining marks, not letters, so without it
// "नमस्ते" is five words rather than one and the highlight crawls through a
// Hindi reply a syllable at a time. A word still has to *begin* with a letter
// or a digit, since a combining mark alone never starts one.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu;

/**
 * Every word in a string, with where it sits.
 *
 * @param {string} text
 * @returns {{start: number, end: number, key: string}[]}
 */
export function wordSpans(text) {
  if (typeof text !== 'string' || !text) return [];
  const spans = [];
  // A fresh regex each call: /g state is per-object and would otherwise leak
  // between calls and skip the first words of the second string.
  const pattern = new RegExp(WORD.source, WORD.flags);
  let match = pattern.exec(text);
  while (match) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      key: match[0].toLowerCase(),
    });
    match = pattern.exec(text);
  }
  return spans;
}

/**
 * How far into the spoken string a character offset has reached, in words.
 *
 * The engines differ: Web Speech reports the offset of the word starting, and
 * Android reports the range of the word being spoken. Both mean "this word is
 * being said now", so the count is of words that have *started*.
 *
 * @returns {number} how many spoken words have begun, 0 when none have
 */
export function spokenWordCount(spokenText, charIndex) {
  const index = Number(charIndex);
  if (!Number.isFinite(index) || index < 0) return 0;
  const spans = wordSpans(spokenText);
  let count = 0;
  for (const span of spans) {
    if (span.start <= index) count += 1;
    else break;
  }
  return count;
}

/**
 * Map "n spoken words have begun" onto a character offset in the display text.
 *
 * Returns the end of the matching display word, so the highlight closes on a
 * word boundary rather than mid-word.
 *
 * @param {{displayText: string, spokenText: string, spokenWords: number}} input
 * @returns {number} characters of `displayText` that have been spoken
 */
export function displayOffsetForWords({ displayText = '', spokenText = '', spokenWords = 0 } = {}) {
  if (spokenWords <= 0) return 0;
  const display = wordSpans(displayText);
  const spoken = wordSpans(spokenText);
  if (!display.length || !spoken.length) return 0;

  const wanted = Math.min(spokenWords, spoken.length);
  let d = 0;
  let reached = 0;

  for (let s = 0; s < wanted; s += 1) {
    const key = spoken[s].key;
    // Look ahead for this spoken word among the display words not yet used.
    // Bounded, so a word the engine invented - an expanded abbreviation, say -
    // costs one short scan and not a walk to the end of a long reply.
    let found = -1;
    for (let probe = d; probe < display.length && probe < d + 24; probe += 1) {
      if (display[probe].key === key) { found = probe; break; }
    }
    if (found === -1) continue;   // spoken word is not on screen; hold position
    reached = display[found].end;
    d = found + 1;
  }
  return reached;
}

/**
 * The caption split at the voice: what has been said, and what has not.
 *
 * Given straight to a renderer, so the component holds no alignment logic.
 *
 * @returns {{spoken: string, pending: string, offset: number}}
 */
export function captionSplit({ displayText = '', spokenText = '', charIndex = -1 } = {}) {
  const text = typeof displayText === 'string' ? displayText : '';
  if (!text) return { spoken: '', pending: '', offset: 0 };
  // -1 means nothing is being spoken - before the voice starts, and after it
  // stops. The whole caption stays plain rather than fully highlighted, so a
  // finished reply does not look like it is still being read out.
  if (!Number.isFinite(Number(charIndex)) || Number(charIndex) < 0) {
    return { spoken: '', pending: text, offset: 0 };
  }
  const words = spokenWordCount(spokenText, charIndex);
  const offset = displayOffsetForWords({ displayText: text, spokenText, spokenWords: words });
  return { spoken: text.slice(0, offset), pending: text.slice(offset), offset };
}

/**
 * Where the caption box should be scrolled to keep the voice in view.
 *
 * The caption already scrolled itself to the bottom when new text arrived, and
 * that is the wrong motion for this: while a reply is being spoken the text
 * does not grow at all, so nothing fired, and the voice simply walked out of
 * the visible area and kept going. Following the *bottom* would also be wrong
 * once it did fire, because the voice starts at the top of a long answer.
 *
 * So this follows the boundary between the spoken and unspoken halves, and
 * only when that boundary has drifted out of a comfortable band. Scrolling on
 * every word would fight the reader and jitter the line; letting it leave the
 * box entirely is the reported problem. The band gives it room to move a few
 * lines before the box catches up, which is how a lyric view behaves.
 *
 * @param {{boxHeight: number, boxScrollTop: number, scrollHeight: number,
 *          edgeOffset: number}} input  edgeOffset is measured from the top of
 *          the scrollable content, not from the viewport
 * @returns {number|null} the scrollTop to move to, or null to leave it alone
 */
export function captionScrollTop({
  boxHeight = 0, boxScrollTop = 0, scrollHeight = 0, edgeOffset = -1,
} = {}) {
  if (!(boxHeight > 0) || !(scrollHeight > 0)) return null;
  if (!Number.isFinite(edgeOffset) || edgeOffset < 0) return null;
  // Nothing to scroll: the whole caption already fits.
  if (scrollHeight <= boxHeight) return null;

  const visibleTop = edgeOffset - boxScrollTop;
  const comfortableTop = boxHeight * 0.25;
  const comfortableBottom = boxHeight * 0.7;
  if (visibleTop >= comfortableTop && visibleTop <= comfortableBottom) return null;

  // Put the current word a bit above the middle, so the words about to be
  // spoken are the ones with room beneath them.
  const wanted = Math.round(edgeOffset - boxHeight * 0.42);
  const clamped = Math.max(0, Math.min(wanted, Math.round(scrollHeight - boxHeight)));
  // A move of a pixel or two is not worth a scroll event.
  return Math.abs(clamped - boxScrollTop) < 4 ? null : clamped;
}

export default captionSplit;
