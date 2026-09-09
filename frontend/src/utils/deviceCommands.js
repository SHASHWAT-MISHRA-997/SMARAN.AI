/**
 * Turning something said out loud into something the phone should do.
 *
 * The desktop build has done this for a while in `backend/app/desktop_agent.py`
 * and `backend/app/web_intents.py`. On the phone the same sentences were
 * reaching a language model, which answered "I can't launch apps for you, but
 * here's how to open WhatsApp on Windows" - instructions for a different
 * machine than the one in your hand.
 *
 * This is deliberately a separate implementation rather than a call to the
 * backend, because the phone often has no backend: a standalone install has no
 * paired desktop, and asking a server to parse "Chrome kholo" before the phone
 * can open Chrome would make a local action depend on the network.
 *
 * The rules below are kept in step with the desktop patterns on purpose. Where
 * they differ it is because the phone differs - there is no Task Manager, and
 * "play a song" means the music app rather than a browser tab.
 */

/**
 * Talking *about* a command instead of giving one.
 *
 * The same three shapes the backend refuses, and for the same reason: a
 * refusal, a question about the command, and a command inside quotation marks.
 *
 * `stop`, `cancel` and "band karo" are deliberately absent. They read like
 * refusals and are not - "awaz band karo" is a real instruction to be quiet,
 * and an earlier version of the backend list broke exactly that.
 */
const REFUSAL = /\b(?:do\s*n[o']?t|don'?t|doesn'?t|never|instead\s+of|nahi|mat|nako)\b/i;
const ABOUT_IT = /^\s*(?:how|what|why|when|where|which|who|kaise|kya|kyun|kyu)\b/i;
const QUOTED = /["'‘’“”]/;

export function isBeingDiscussed(utterance) {
  const text = typeof utterance === 'string' ? utterance : '';
  if (!text.trim()) return false;
  return REFUSAL.test(text) || ABOUT_IT.test(text) || QUOTED.test(text);
}

// Verb-first and verb-last both, because Hinglish puts the verb at the end:
// "open Chrome" and "Chrome kholo" are the same instruction.
const OPEN_FIRST = '(?:open|launch|start|run|kholo|khol\\s+do|chalu\\s+karo|start\\s+karo|open\\s+karo)';
const OPEN_LAST = '(?:kholo|khol\\s+do|chalu\\s+karo|start\\s+karo|open\\s+karo|kholna)';
const PLAY_FIRST = '(?:play|bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do)';
const PLAY_LAST = '(?:bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do|play\\s+karo)';

const RULES = [
  // YouTube, before the generic "play", so "YouTube pe X chalao" is a video
  // and not a song handed to the music app.
  {
    action: 'youtube',
    patterns: [
      /^(.+?)\s+(?:youtube|यूट्यूब)\s+(?:pe|par|पर|पे)\s+(?:channel|चैनल)\s+(?:(?:ko|को)\s+)?(?:open\s+karo|kholo|khol\s+do|खोलो|खोल\s+दो)$/i,
      new RegExp(`(?:${OPEN_FIRST}|${PLAY_FIRST}|search|dikhao)\\s+(?:on\\s+|pe\\s+|par\\s+)?youtube\\s+(.+)$`, 'i'),
      new RegExp(`youtube\\s+(?:pe|par|mein|mai|men)\\s+(.+?)\\s+(?:${PLAY_LAST}|${OPEN_LAST}|dikhao|search\\s+karo)$`, 'i'),
      new RegExp(`(?:${PLAY_FIRST})\\s+(.+?)\\s+(?:on|pe|par)\\s+youtube$`, 'i'),
    ],
    argument: 'query',
  },
  // A bare "open youtube" with nothing to search for.
  {
    action: 'youtube',
    patterns: [
      new RegExp(`^\\s*${OPEN_FIRST}\\s+youtube\\s*$`, 'i'),
      new RegExp(`^\\s*youtube\\s+${OPEN_LAST}\\s*$`, 'i'),
    ],
    argument: null,
  },
  // Music. "gaana bajao", "play despacito", "koi gaana chalao".
  {
    action: 'music',
    patterns: [
      new RegExp(`^\\s*(?:koi\\s+|kuch\\s+)?(?:gaana|gana|song|music|gaane)\\s+${PLAY_LAST}\\s*$`, 'i'),
      new RegExp(`^\\s*${PLAY_FIRST}\\s+(?:koi\\s+|kuch\\s+)?(?:gaana|gana|song|music)\\s*$`, 'i'),
      new RegExp(`^\\s*${PLAY_FIRST}\\s+(?:the\\s+)?song\\s+(.+)$`, 'i'),
      new RegExp(`^\\s*(.+?)\\s+(?:gaana|gana|song)\\s+${PLAY_LAST}\\s*$`, 'i'),
      new RegExp(`^\\s*${PLAY_FIRST}\\s+(.+?)\\s+(?:gaana|gana|song)\\s*$`, 'i'),
    ],
    argument: 'query',
  },
  // A web address said aloud, or a site by name.
  {
    action: 'url',
    patterns: [
      new RegExp(`(?:${OPEN_FIRST})\\s+(https?://\\S+)$`, 'i'),
      new RegExp(`^\\s*(https?://\\S+)\\s+${OPEN_LAST}\\s*$`, 'i'),
    ],
    argument: 'url',
  },
  // Anything else named as an app.
  {
    action: 'app',
    patterns: [
      new RegExp(`^\\s*${OPEN_FIRST}\\s+(?:the\\s+)?(.+?)(?:\\s+app)?\\s*$`, 'i'),
      new RegExp(`^\\s*(.+?)(?:\\s+app)?\\s+${OPEN_LAST}\\s*$`, 'i'),
    ],
    argument: 'name',
  },
];

// Politeness, which can land after the verb as easily as before it: English
// puts it last ("open Chrome please") and so does Hinglish ("Chrome kholo
// zara"). In the verb-last form it sits beyond the verb the pattern anchors
// on, so it has to come off the sentence before matching rather than off the
// captured name afterwards.
//
// `karo` and `kar do` are NOT in this list even though they trail politely
// elsewhere, because they are the verb in "chalu karo" and "open karo".
// Stripping them here would leave "calculator chalu", which matches nothing.
const POLITENESS = /\s*(?:please|plz|zara|jara|thoda|abhi|now)\s*$/i;

const stripPoliteness = (text) => {
  let out = String(text || '').trim();
  let previous;
  do { previous = out; out = out.replace(POLITENESS, '').trim(); } while (out !== previous);
  return out;
};

const tidy = (value) => stripPoliteness(String(value || ''))
  .replace(/[.!?,;:]+$/, '')
  .trim();

/**
 * What the phone should do about this sentence, if anything.
 *
 * @param {string} utterance
 * @returns {{action: string, query?: string, name?: string, url?: string}|null}
 */
export function detectDeviceCommand(utterance) {
  const raw = typeof utterance === 'string' ? utterance.trim() : '';
  if (!raw) return null;
  // Long sentences are prose, not instructions. "Open the door and tell me
  // about the history of the building" is not a request to launch anything.
  if (raw.length > 120) return null;
  // Checked on the original: politeness never makes a sentence a command, but
  // stripping first could in principle remove a word a refusal relies on.
  if (isBeingDiscussed(raw)) return null;
  const text = stripPoliteness(raw);
  if (!text) return null;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      // A rule can hold both shapes of the same instruction: "gaana bajao" has
      // nothing to capture while "kesariya gaana bajao" names a song. An
      // undefined group means the wordless shape matched, not that the rule
      // failed - reading it as failure is what made "gaana bajao" do nothing.
      if (!rule.argument || match[1] === undefined) return { action: rule.action };
      const value = tidy(match[1]);
      if (!value) continue;
      // A single letter or a stray number is not an app anybody named.
      if (rule.action === 'app' && value.length < 2) continue;
      return { action: rule.action, [rule.argument]: value };
    }
  }
  return null;
}

/**
 * What to say back, in the language of the request.
 *
 * Short, because it is spoken aloud while something is already opening, and
 * honest about failure: an app that is not installed is said plainly rather
 * than reported as if it had opened.
 */
export function describeOutcome(command, result) {
  const ok = Boolean(result?.opened);
  switch (command?.action) {
    case 'app':
      if (ok) return `Opening ${result.label || command.name}.`;
      if (result?.reason === 'not-installed') {
        return `I can't find ${command.name} on this phone.`;
      }
      return `I couldn't open ${command.name}.`;
    case 'youtube':
      if (!ok) return 'I couldn\'t open YouTube.';
      return command.query
        ? `Searching YouTube for ${command.query}.`
        : 'Opening YouTube.';
    case 'music':
      if (ok) return command.query ? `Playing ${command.query}.` : 'Playing music.';
      return 'No music app answered on this phone.';
    case 'url':
      return ok ? 'Opening that page.' : 'I couldn\'t open that address.';
    default:
      return '';
  }
}

export default detectDeviceCommand;
