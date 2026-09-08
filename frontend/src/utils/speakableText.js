/**
 * Turning a written reply into something a person would actually say.
 *
 * A model writes for the eye: bullet points, bold, tables, arrows, emoji, a
 * link in brackets. Handed to a speech engine, all of it is read out. Android
 * says "asterisk", "vertical bar", "rightwards arrow" and "rocket"; long
 * dashes come out as "dash". The result does not sound like a person
 * explaining something, it sounds like a machine reading a document aloud,
 * which is exactly what it is doing.
 *
 * So the layout is removed and the sentence kept. Two rules run through this:
 *
 * Nothing here may touch letters. The app answers in Hindi, Gujarati, Tamil
 * and more, so anything that strips "non-ASCII" would delete the reply. Emoji
 * and symbols are removed by naming their ranges, never by excluding a script.
 *
 * Punctuation that carries speech is kept or converted rather than dropped. A
 * long dash is a pause, so it becomes a comma; a full stop stays a full stop.
 * Deleting them would run the sentences together into one breathless line.
 */

// Pictographs, dingbats, arrows and flags. Listed by range so that letters in
// every script fall outside it.
const SYMBOLS = new RegExp(
  '[' +
  '\\u2190-\\u21FF' +   // arrows: → ← ⇒
  '\\u2300-\\u23FF' +   // technical: ⌘ ⏎
  '\\u2500-\\u257F' +   // box drawing, from tables
  '\\u2580-\\u259F' +   // block elements
  '\\u25A0-\\u25FF' +   // geometric shapes: ■ ▶
  '\\u2600-\\u27BF' +   // dingbats: ✅ ✗ ➔ ☀
  '\\u2B00-\\u2BFF' +   // more arrows and stars: ⭐ ⬅
  '\\uFE0F\\uFE0E' +    // variation selectors
  '\\u200D' +           // zero-width joiner, between emoji parts
  '\\u20E3' +           // keycap
  ']',
  'gu',
);

// Everything in the astral planes that is emoji rather than text.
const EMOJI = /[\u{1F000}-\u{1FAFF}]/gu;

const RULES = [
  // Whole blocks first, so their contents never reach the later rules.
  [/<think>[\s\S]*?<\/think>/gi, ''],
  [/```[\s\S]*?```/g, ' '],
  [/~~~[\s\S]*?~~~/g, ' '],

  // Inline code and images: keep what was written, drop the markup.
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'],
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  [/`([^`]+)`/g, '$1'],

  // A spoken URL is a string of letters, never useful. The link text above has
  // already been kept, so this only removes bare ones.
  [/\bhttps?:\/\/\S+/gi, ' '],
  [/\bwww\.\S+/gi, ' '],

  // Table rulers, then the cell separators. The ruler has to go first or it
  // becomes a line of loose dashes.
  [/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, ' '],
  [/\|/g, ', '],

  // Horizontal rules, before the dash handling below sees them.
  [/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, ' '],

  // List markers at the start of a line. The number in an ordered list is
  // left alone: "1." is read as "one", which is what a person would say.
  [/^\s*[-*+•·]\s+/gm, ' '],

  // Headings, emphasis, quotes, checkboxes.
  [/^#{1,6}\s*/gm, ' '],
  [/^\s*>\s?/gm, ' '],
  [/\[[ xX]\]/g, ' '],
  [/[*_~#^]/g, ''],

  [SYMBOLS, ' '],
  [EMOJI, ' '],

  // Dashes are pauses when they stand alone and part of the word when they do
  // not: "well-known" must survive, " - " must not be read as "dash".
  [/[—–]/g, ', '],
  [/(\s)-+(\s)/g, '$1, '],
  [/\s+-+$/gm, ' '],

  // Leftover brackets and braces, which are read out as words.
  [/[<>{}[\]]/g, ' '],

  // HTML entities that survive in model output.
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, ' and '],
  [/&[a-z]+;/gi, ' '],

  // A blank line ends a thought; a single newline continues one.
  [/\n{2,}/g, '. '],
  [/\n/g, ', '],

  // Tidy up what the rules above left behind.
  [/\s*,\s*(?=[.,;:!?])/g, ''],
  [/([.!?])\s*[,;:]/g, '$1'],
  [/,{2,}/g, ','],
  [/\.{3,}/g, '.'],
  [/\s*\.\s*\.\s*/g, '. '],
  [/[ \t]{2,}/g, ' '],
  [/\s+([.,;:!?])/g, '$1'],
  [/^[\s.,;:]+/, ''],
];

/**
 * The spoken form of a written reply.
 *
 * @param {string} text the reply as it is displayed
 * @returns {string} what to hand a speech engine, or '' if nothing is sayable
 */
export function speakableText(text) {
  if (typeof text !== 'string' || !text) return '';

  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  out = out.trim();

  // A reply that was only a code block or only emoji leaves punctuation and
  // nothing to say. Speaking that is worse than staying quiet.
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
}

export default speakableText;
