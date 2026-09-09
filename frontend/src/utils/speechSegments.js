/**
 * Which voice should say which part of a reply.
 *
 * The speaking language was taken from the reply-language picker, not from the
 * reply. So an answer containing Hindi was read by an English voice whenever
 * the picker said English - and a mixed answer, which is most of them here, was
 * always read by one wrong voice for half its length. That is the reported
 * "pronunciation is not right".
 *
 * Deciding from the text instead means a Devanagari sentence gets a Hindi voice
 * and an English sentence gets an English one, in the same reply, without
 * anybody touching a setting.
 *
 * WHAT THIS CANNOT FIX
 *
 * Romanised Hindi - "Chrome kholo" written in Latin letters - is
 * indistinguishable from English by script, and that is the only signal here.
 * An English voice will read "kholo" with English phonetics and it will sound
 * wrong. Fixing that needs transliteration into Devanagari before speaking,
 * which is a different and much larger problem; guessing at it from a word list
 * would mispronounce ordinary English words instead, which is worse. So this
 * fixes the script-mixing case and leaves the romanised case honestly alone.
 */

/**
 * Scripts the app offers a voice for, by the Unicode range that identifies
 * them. Ordered as tested; the first match wins, and Latin is the fallback
 * rather than an entry, because it is what everything else degrades to.
 */
const SCRIPTS = [
  { lang: 'hi-IN', test: /[ऀ-ॿ]/ },   // Devanagari - Hindi, Marathi
  { lang: 'bn-IN', test: /[ঀ-৿]/ },   // Bengali
  { lang: 'pa-IN', test: /[਀-੿]/ },   // Gurmukhi - Punjabi
  { lang: 'gu-IN', test: /[઀-૿]/ },   // Gujarati
  { lang: 'or-IN', test: /[଀-୿]/ },   // Odia
  { lang: 'ta-IN', test: /[஀-௿]/ },   // Tamil
  { lang: 'te-IN', test: /[ఀ-౿]/ },   // Telugu
  { lang: 'kn-IN', test: /[ಀ-೿]/ },   // Kannada
  { lang: 'ml-IN', test: /[ഀ-ൿ]/ },   // Malayalam
  { lang: 'ur-IN', test: /[؀-ۿ]/ },   // Arabic script - Urdu
  { lang: 'ja-JP', test: /[぀-ヿ一-鿿]/ },
  { lang: 'ko-KR', test: /[가-힯]/ },
];

/** The language of one character, or null when it does not choose one. */
const languageOf = (character) => {
  for (const script of SCRIPTS) {
    if (script.test.test(character)) return script.lang;
  }
  // Letters and digits with no script of their own are Latin; punctuation,
  // spaces and emoji return null so they join whichever run they fall in
  // rather than cutting it in two.
  return /[A-Za-z0-9]/.test(character) ? 'latin' : null;
};

/**
 * A reply split into runs, each with the voice that should say it.
 *
 * @param {string} text
 * @param {string} fallback  the voice for Latin text, e.g. 'en-IN'
 * @returns {{text: string, lang: string}[]}
 */
export function speechSegments(text, fallback = 'en-IN') {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return [];

  const runs = [];
  let current = null;

  for (const character of source) {
    const found = languageOf(character);
    // Punctuation and spaces belong to the run they are inside. Starting a new
    // run on a space would produce one segment per word, and each utterance
    // costs an engine round trip - the reply would come out in stutters.
    if (found === null) {
      if (current) current.text += character;
      else runs.push({ lang: null, text: character });
      continue;
    }
    const lang = found === 'latin' ? fallback : found;
    if (current && current.lang === lang) {
      current.text += character;
    } else {
      current = { lang, text: character };
      runs.push(current);
    }
  }

  // A leading run of pure punctuation has no language; give it to its
  // neighbour rather than speaking it alone.
  const merged = [];
  for (const run of runs) {
    if (run.lang === null) {
      if (merged.length) merged[merged.length - 1].text += run.text;
      else if (runs.length > 1) continue;      // dropped; the next run takes over
      else merged.push({ ...run, lang: fallback });
      continue;
    }
    if (merged.length && merged[merged.length - 1].lang === run.lang) {
      merged[merged.length - 1].text += run.text;
    } else {
      merged.push({ ...run });
    }
  }

  // A run of one or two characters is a fragment - an initial, a stray letter
  // inside a Hindi sentence - and switching voice for it sounds worse than
  // saying it in the wrong one. Fold it into its neighbour.
  const settled = [];
  for (const run of merged) {
    const tiny = run.text.trim().length <= 2;
    if (tiny && settled.length) {
      settled[settled.length - 1].text += run.text;
    } else if (tiny && merged.length > 1) {
      // First run and tiny: hold it for the next one.
      settled.push({ ...run, pendingTiny: true });
    } else {
      settled.push({ ...run });
    }
  }
  // Folding a fragment into its neighbour can leave two runs of the same
  // language side by side - "मैं " and "ठीक हूँ" either side of a stray "a".
  // They must become one: every run is a separate utterance, and each costs an
  // engine round trip, so a sentence split in half is heard as a hesitation in
  // the middle of it.
  const joined = [];
  for (const run of settled) {
    if (joined.length && joined[joined.length - 1].lang === run.lang) {
      joined[joined.length - 1].text += run.text;
    } else {
      joined.push({ text: run.text, lang: run.lang });
    }
  }
  return joined.filter((run) => run.text.trim().length > 0);
}

/**
 * The single best voice for a reply, when only one can be used.
 *
 * The web path speaks a whole chunk at a time and cannot switch mid-utterance,
 * so it needs one answer: whichever language covers the most characters.
 * Better than the picker, which was not looking at the text at all.
 */
export function dominantLanguage(text, fallback = 'en-IN') {
  const runs = speechSegments(text, fallback);
  if (!runs.length) return fallback;
  const totals = new Map();
  for (const run of runs) {
    const weight = run.text.replace(/\s/g, '').length;
    totals.set(run.lang, (totals.get(run.lang) || 0) + weight);
  }
  let best = fallback;
  let most = -1;
  for (const [lang, weight] of totals) {
    if (weight > most) { most = weight; best = lang; }
  }
  return best;
}

export default speechSegments;
