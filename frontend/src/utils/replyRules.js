/**
 * The language and code rules the model is given, for the path that does not
 * go through the backend.
 *
 * A phone with no desktop paired never reaches `/api/chat`; it calls the
 * provider straight from the app. Everything the backend adds to a prompt -
 * the language instruction, the rule keeping code in English - simply does not
 * exist on that path. The result was an English question about a Python
 * function coming back with Hindi prose and a Hindi comment inside the code,
 * on a build whose language picker was set to English the whole time.
 *
 * These are kept here rather than inline so both are one definition, and so
 * the English default can be tested rather than assumed.
 */

/** Names the model actually recognises. A code like "gu" is not an instruction. */
const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi',
  gu: 'Gujarati',
  mr: 'Marathi',
  pa: 'Punjabi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  bn: 'Bengali',
  ur: 'Urdu',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  zh: 'Chinese',
  ar: 'Arabic',
  ru: 'Russian',
  pt: 'Portuguese',
};

export const languageName = (code) => LANGUAGE_NAMES[String(code || '').toLowerCase()] || '';

/**
 * English is the default and says so.
 *
 * Every other language got a named instruction while English got silence, and
 * a model left without one drifts - reliably, on an India-context prompt, into
 * Hindi. Choosing a language still wins; it just has to be chosen.
 */
export function languageRule(selected) {
  const name = languageName(selected);
  if (name && name !== 'English') {
    return (
      `LANGUAGE INSTRUCTION: Respond entirely in ${name}, using its native script. ` +
      'Keep code, commands, URLs and product names unchanged.'
    );
  }
  return (
    'LANGUAGE INSTRUCTION: Respond entirely in English. Do not switch to Hindi, ' +
    'Hinglish or any other language, and do not mix languages, unless the person ' +
    'writes to you in that language.'
  );
}

/**
 * Code is not prose and must not follow the language rule above.
 *
 * "Complete" is spelled out because the usual failure is a snippet missing its
 * imports or with the body elided to `...`, which is useless to somebody who
 * pastes it into an editor and presses run.
 */
export const CODE_OUTPUT_RULE = [
  'CODE OUTPUT RULE:',
  'The language instruction governs your explanation, never the code. Inside a',
  'code block always write identifiers, keywords, comments and string literals',
  'in English, whatever language you are answering in. Never translate code.',
  'Write code that runs as pasted, in any editor or IDE: include every import',
  'it needs, keep it syntactically complete, and never elide a body with "..."',
  'or a placeholder comment. If the reader must supply something - a key, a',
  'path, a URL - make it a named constant at the top rather than hiding it',
  'mid-file. Tag every fenced block with its language, and say outside the',
  'block which runtime version and which packages it needs.',
].join(' ');
