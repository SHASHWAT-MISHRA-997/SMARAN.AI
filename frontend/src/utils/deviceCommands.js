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
//
// Devanagari sits beside the romanised spellings because the speech engine
// decides the script, not the speaker. Whisper transcribes Hindi speech in
// Devanagari - "यूट्यूब खोलो" rather than "youtube kholo" - so a person who
// speaks Hindi to the microphone produced text that matched none of these
// rules, and the request fell through to the language model. That is the
// exact failure this file was written to stop; it was only ever stopped for
// people typing in Latin script. One YouTube pattern already carried a few
// Devanagari words, which is why "यूट्यूब पर गाना चलाओ" worked while the
// plainer "यूट्यूब खोलो" did not.
const OPEN_FIRST = '(?:open|launch|start|run|kholo|khol\\s+do|chalu\\s+karo|start\\s+karo|open\\s+karo'
  + '|खोलो|खोल\\s+दो|चालू\\s+करो|शुरू\\s+करो|ओपन\\s+करो)';
const OPEN_LAST = '(?:kholo|khol\\s+do|chalu\\s+karo|start\\s+karo|open\\s+karo|kholna'
  + '|खोलो|खोल\\s+दो|चालू\\s+करो|शुरू\\s+करो|ओपन\\s+करो|खोलना)';
// "lagao" belongs here as much as "bajao" does - "tum hi ho youtube par lagao"
// is how people actually ask - and it was missing, so that sentence reached
// the model instead of the player.
const PLAY_FIRST = '(?:play|bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do|lagao|laga\\s+do'
  + '|बजाओ|बजा\\s+दो|चलाओ|चला\\s+दो|सुनाओ|सुना\\s+दो|लगाओ|लगा\\s+दो)';
const PLAY_LAST = '(?:bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do|lagao|laga\\s+do|play\\s+karo|play\\s+kar\\s+do'
  + '|बजाओ|बजा\\s+दो|चलाओ|चला\\s+दो|सुनाओ|सुना\\s+दो|लगाओ|लगा\\s+दो)';

// The site's own name, and the particles that mean "on". Both scripts in one
// place: the Devanagari was previously in one YouTube pattern and missing from
// the other two, so "यूट्यूब पर X चलाओ" worked and "यूट्यूब खोलो" did not.
const YT = '(?:youtube|यूट्यूब)';
const ON = '(?:pe|par|per|mein|mai|men|पर|पे|में)';

/* Music in a service the person names: "kesariya Spotify par play karo",
   "play X on Spotify", "Spotify pe X bajao".

   None of these matched: the music rules want the word "gaana" or "song".
   So "Shiv Sadashiv Boliye Spotify par play karo" went to the language model,
   which replied "I cannot directly open Spotify" and a link to search it
   yourself - on a phone that has Spotify installed. Named, it now goes to
   that app, which plays the top match. Checked before YouTube, because
   "YouTube Music" would otherwise be read as YouTube. */
const MUSIC_SERVICES = [
  { name: 'Spotify', spoken: 'spotify|स्पॉटिफाई|स्पोटिफाई' },
  { name: 'YouTube Music', spoken: 'youtube\\s*music|yt\\s*music|यूट्यूब\\s*म्यूजिक' },
  { name: 'Wynk', spoken: 'wynk(?:\\s*music)?|विंक' },
  { name: 'JioSaavn', spoken: 'jio\\s*saavn|saavn|सावन' },
  { name: 'Apple Music', spoken: 'apple\\s*music' },
];
const ON_ANY = '(?:on|in|pe|par|per|mein|mai|men|पर|पे|में)';

/* Play, pause, stop, next, previous and volume - of whatever is playing.

   Said while Spotify or YouTube played, "pause" reached the language model,
   which explained how to pause it. Media keys are how Android lets one app
   control another's playback (DeviceActions.performMedia), instantly and with
   no permission. Anchored, short phrases only: "play despacito" is still a
   request for a song, not a press of the play key. */
const CONTROLS = [
  ['pause', /^(?:pause(?:\s+karo|\s+kar\s+do|\s+it)?|pause\s+(?:the\s+)?(?:music|song|video|gaana)|ruko|ruk\s+jao|roko|rok\s+do|(?:gaana|music|song|video)\s+(?:roko|rok\s+do|pause\s+karo)|रुको|रोको|रोक\s+दो|पॉज़?(?:\s+करो)?)$/i],
  ['stop', /^(?:stop(?:\s+(?:the\s+)?(?:music|song|video|playing))?|(?:gaana|music|song|video)\s+band\s+karo|band\s+karo\s+(?:gaana|music)|गाना\s+बंद\s+करो)$/i],
  ['play', /^(?:resume|continue|play|play\s+karo|resume\s+karo|chalao|chalu\s+karo\s+(?:gaana|music)|phir\s+se\s+chalao|wapas\s+chalao|(?:gaana|music|song|video)\s+(?:chalao|resume\s+karo|play\s+karo|wapas\s+chalao)|चलाओ|फिर\s+से\s+चलाओ)$/i],
  ['next', /^(?:next(?:\s+(?:song|track|video|gaana))?|skip(?:\s+(?:this|it|(?:this\s+|the\s+)?(?:song|track|video|gaana)))?|agla(?:\s+(?:gaana|song|video))?|next\s+karo|अगला(?:\s+गाना)?)$/i],
  ['previous', /^(?:previous(?:\s+(?:song|track|video))?|pichla(?:\s+(?:gaana|song|video))?|last\s+song|पिछला(?:\s+गाना)?)$/i],
  ['volume_up', /^(?:volume\s+(?:up|badhao|increase|tez\s+karo|zyada\s+karo)|(?:increase|raise|turn\s+up)\s+(?:the\s+)?volume|a+wa+z\s+(?:badhao|tez\s+karo)|louder|आवाज़?\s+बढ़ाओ)$/i],
  ['volume_down', /^(?:volume\s+(?:down|kam\s+karo|ghatao|decrease|dheere\s+karo)|(?:decrease|lower|turn\s+down)\s+(?:the\s+)?volume|a+wa+z\s+(?:kam\s+karo|dheere\s+karo|ghatao)|quieter|आवाज़?\s+कम\s+करो)$/i],
  ['mute', /^(?:mute|mute\s+karo|volume\s+mute\s+karo)$/i],
];

export function detectMediaControl(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  for (const [control, pattern] of CONTROLS) {
    if (pattern.test(t)) return { action: 'media', control };
  }
  return null;
}

// "... YouTube par chalao" means play it, "... YouTube par search karo" means
// look for it. Same words either way until now, and both only searched.
const WANTS_PLAY = /\b(?:play|bajao|baja\s+do|chalao|chala\s+do|sunao|lagao|laga\s+do)\b|बजाओ|चलाओ|सुनाओ|लगाओ/i;

/* A request for music that names none: "music", "some songs", "koi gaana",
   "music for me". */
const GENERIC_MUSIC = /^(?:(?:some|a|any|my|the|koi|kuch|कोई|कुछ)\s+)?(?:music|songs?|gaana|gana|gaane|gane|something|गाना|गाने|गीत|संगीत)(?:\s+(?:for\s+me|mere\s+liye|मेरे\s+लिए))?$/i;

/** Which of the three ways the request was said: Hindi, Hinglish or English. */
export function spokenLanguage(text) {
  const t = String(text || '');
  if (/[\u0900-\u097F]/.test(t)) return 'hi';
  if (/\b(?:karo|kar\s+do|bajao|chalao|sunao|lagao|par|pe|mein|mere|liye|koi|kuch|gaana|gana|gaane|kholo|suno)\b/i.test(t)) return 'hinglish';
  return 'en';
}

/* The question back, in the language of the request - the way an assistant
   asks "which song?" rather than guessing or reciting instructions. */
function askForSong(text, app = '') {
  const lang = spokenLanguage(text);
  const question = lang === 'hi'
    ? (app ? `${app} पर कौन सा गाना चलाऊँ?` : 'कौन सा गाना सुनना है?')
    : lang === 'hinglish'
      ? (app ? `${app} par kaunsa gaana chalaun?` : 'Kaunsa gaana sunna hai?')
      : (app ? `Which song should I play on ${app}?` : 'Which song would you like to hear?');
  return app
    ? { action: 'ask', about: 'song', app, question, lang }
    : { action: 'ask', about: 'song', question, lang };
}

export function detectMusicInService(text) {
  for (const service of MUSIC_SERVICES) {
    const app = `(?:${service.spoken})`;
    const shapes = [
      new RegExp(`^(.+?)\\s+(?:${ON_ANY}\\s+)?${app}\\s+(?:${ON_ANY}\\s+)?(?:${PLAY_LAST}|play|${OPEN_LAST})\\s*$`, 'i'),
      new RegExp(`^(?:${PLAY_FIRST}|play)\\s+(.+?)\\s+${ON_ANY}\\s+${app}\\s*$`, 'i'),
      new RegExp(`^(.+?)\\s+(?:${PLAY_LAST})\\s+${app}\\s+${ON_ANY}\\s*$`, 'i'),
      new RegExp(`^${app}\\s+${ON_ANY}\\s+(.+?)\\s+(?:${PLAY_LAST}|play)\\s*$`, 'i'),
    ];
    for (const shape of shapes) {
      const match = shape.exec(text);
      if (!match) continue;
      // "Play music on Spotify" names no song. It used to search Spotify
      // for the word "music"; an assistant asks which one. Checked before
      // the trailing "gaana" comes off, or "Spotify par gaana bajao" is
      // left with nothing and loses the app it named.
      const said = tidy(match[1]);
      if (GENERIC_MUSIC.test(said)) return askForSong(text, service.name);
      const query = said.replace(/\s*(?:song|gaana|gana|gaane|गाना)\s*$/i, '').trim();
      if (query) return { action: 'music', query, app: service.name };
    }
  }
  return null;
}

/* Money and shopping: opened, never done.

   "Hey SMARAN, open GPay" opens GPay. "Send 500 to Rahul on GPay", "buy this",
   "add to cart" - SMARAN opens the app if one is named and says, every time,
   that sending and buying are the user's to do. Nothing here can press a
   button inside another app, and this makes that a promise rather than an
   accident. Checked before every other rule, so "paytm par 500 bhejo" can
   never become a search, a song, or anything else. */
const MONEY_APPS = [
  ['Google Pay', /\b(?:g\s*pay|google\s*pay|tez)\b|जीपे|गूगल\s*पे/i],
  ['Paytm', /\bpaytm\b|पेटीएम/i],
  ['PhonePe', /\bphone\s*pe\b|फोनपे/i],
  ['BHIM', /\bbhim\b/i],
  ['PayZapp', /\bpay\s*zapp\b/i],
  ['Amazon', /\bamazon\b|अमेज़?न/i],
  ['Flipkart', /\bflipkart\b|फ्लिपकार्ट/i],
  ['Swiggy', /\bswiggy\b/i],
  ['Zomato', /\bzomato\b/i],
  ['Myntra', /\bmyntra\b/i],
  ['Meesho', /\bmeesho\b/i],
];
const MONEY_ACT = new RegExp([
  // send / pay / transfer an amount, or to someone
  '\\b(?:send|pay|transfer|bhejo|bhej\\s+do|de\\s+do)\\b.*(?:\\b(?:rs|inr|rupees?|rupaye|rupay|rupiya)\\b|₹|\\d)',
  // the amount first, as Hinglish says it: "Rahul ko 500 bhejo", "paytm par 200 bhej do"
  '(?:₹|\\d).*\\b(?:bhejo|bhej\\s+do|send\\s+karo|send\\s+kar\\s+do|transfer\\s+karo|de\\s+do|pay\\s+karo)\\b',
  '\\b(?:pay|send\\s+money|transfer\\s+money)\\s+(?:to\\s+)?\\w+',
  '\\b(?:paise|paisa|money|payment|amount)\\s+(?:ko\\s+)?(?:bhejo|bhej\\s+do|send\\s+karo|transfer\\s+karo|kar\\s*do|karo)\\b',
  // buy / order / cart / recharge
  '\\b(?:buy|purchase|order|checkout|kharido|khareed\\s*(?:lo|do)|mangwa\\s*do|mangao)\\b',
  '\\badd\\s+(?:it\\s+|this\\s+)?to\\s+(?:the\\s+|my\\s+)?cart\\b|\\bcart\\s+(?:me|mein|mai)\\s+(?:daalo|dalo|daal\\s+do|add\\s+karo)\\b',
  '\\brecharge\\s+(?:karo|kar\\s*do|kardo|my|the)\\b|\\brecharge\\b.*\\d',
  'पैसे\\s+भेजो|भेज\\s+दो|खरीदो|ऑर्डर\\s+करो',
].join('|'), 'i');

const SKIP_AD = /^(?:skip\s+(?:the\s+|this\s+)?ads?|ads?\s+skip\s*(?:karo|kar\s*do|kardo)?|skip\s+ads?\s+karo|ads?\s+hatao|ads?\s+band\s+karo|विज्ञापन\s+(?:छोड़ो|हटाओ)|ऐड\s+स्किप\s+करो)[.!]?$/i;

export function detectMoneyRequest(text) {
  if (!MONEY_ACT.test(text)) return null;
  const app = MONEY_APPS.find(([, pattern]) => pattern.test(text))?.[0] || '';
  return app ? { action: 'app', name: app, money: true } : { action: 'say', money: true };
}

/* "gpay" is what people say; "Google Pay" is what the phone calls it. */
const APP_ALIASES = [
  [/^(?:g\s*pay|gpay|tez)$/i, 'Google Pay'],
  [/^phone\s*pe$/i, 'PhonePe'],
  [/^(?:insta)$/i, 'Instagram'],
  [/^(?:fb)$/i, 'Facebook'],
  [/^(?:yt)$/i, 'YouTube'],
];
const canonicalApp = (name) => APP_ALIASES.find(([pattern]) => pattern.test(name))?.[1] || name;

const RULES = [
  // YouTube, before the generic "play", so "YouTube pe X chalao" is a video
  // and not a song handed to the music app.
  {
    action: 'youtube',
    patterns: [
      /^(.+?)\s+(?:youtube|यूट्यूब)\s+(?:pe|par|per|पर|पे)\s+(?:channel|चैनल)\s+(?:(?:ko|को)\s+)?(?:open\s+karo|kholo|khol\s+do|खोलो|खोल\s+दो)$/i,
      new RegExp(`(?:${OPEN_FIRST}|${PLAY_FIRST}|search|dikhao)\\s+(?:on\\s+|pe\\s+|par\\s+|per\\s+)?${YT}\\s+(.+)$`, 'i'),
      // "sada shiv boliye ko play karo youtube per": the verb before the place.
      // It reached the model, which answered with a made-up video link.
      new RegExp(`^(.+?)\\s+(?:${PLAY_LAST})\\s+(?:on\\s+)?${YT}(?:\\s+${ON})?$`, 'i'),
      new RegExp(`${YT}\\s+${ON}\\s+(.+?)\\s+(?:${PLAY_LAST}|${OPEN_LAST}|dikhao|search\\s+karo)$`, 'i'),
      new RegExp(`(?:${PLAY_FIRST})\\s+(.+?)\\s+(?:on|pe|par|per|पर|पे)\\s+${YT}$`, 'i'),
      // What is being played, then where, then the verb:
      // "ganpati bappa song youtube par play karo".
      //
      // The single most common way this is said, and the one shape that was
      // missing. Four of the seven phrasings the desktop handles reached
      // nothing here, so the phone answered "I have no tool that can open apps
      // on your device" to a request it was perfectly able to carry out. The
      // desktop had this exact gap once and it was fixed there and not here.
      new RegExp(`^(.+?)\\s+(?:youtube|यूट्यूब)\\s+(?:pe|par|per|mein|mai|men|पर|पे)\\s+(?:${PLAY_LAST}|${OPEN_LAST}|dikhao|search\\s+karo)$`, 'i'),
    ],
    argument: 'query',
  },
  // A bare "open youtube" with nothing to search for.
  {
    action: 'youtube',
    patterns: [
      new RegExp(`^\\s*${OPEN_FIRST}\\s+${YT}\\s*$`, 'i'),
      new RegExp(`^\\s*${YT}\\s+${OPEN_LAST}\\s*$`, 'i'),
    ],
    argument: null,
  },
  // Music. "gaana bajao", "play despacito", "koi gaana chalao".
  {
    action: 'music',
    patterns: [
      new RegExp(`^\\s*(?:koi\\s+|kuch\\s+|कोई\\s+|कुछ\\s+)?(?:gaana|gana|song|music|gaane|गाना|गाने|गीत|संगीत)\\s+${PLAY_LAST}\\s*$`, 'i'),
      new RegExp(`^\\s*${PLAY_FIRST}\\s+(?:koi\\s+|kuch\\s+|कोई\\s+|कुछ\\s+)?(?:gaana|gana|song|music|गाना|गीत|संगीत)\\s*$`, 'i'),
      new RegExp(`^\\s*${PLAY_FIRST}\\s+(?:the\\s+)?song\\s+(.+)$`, 'i'),
      new RegExp(`^\\s*(.+?)\\s+(?:gaana|gana|song|गाना|गीत)\\s+${PLAY_LAST}\\s*$`, 'i'),
      new RegExp(`^\\s*${PLAY_FIRST}\\s+(.+?)\\s+(?:gaana|gana|song|गाना|गीत)\\s*$`, 'i'),
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

/* "Hey SMARAN, play music on Spotify": the name is how it was addressed,
   not part of the instruction, and left on it matched nothing. */
const WAKE_PREFIX = /^\s*(?:(?:hey|hi|hello|ok|okay|oye|suno|हे|सुनो)\s+)?(?:smaran|samaran|amarya|amariya|amaria|myra|myraa|jarvis|स्मरण|अमार्या|मायरा|जार्विस)(?:\s+ai)?[\s,!.:-]*/i;
export const stripWakePhrase = (text) => String(text || '').replace(WAKE_PREFIX, '').trim();

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
  const text = stripPoliteness(stripWakePhrase(raw));
  if (!text) return null;

  // "Skip ad": the phone presses the Skip button in the app in front.
  if (SKIP_AD.test(text)) return { action: 'skip_ad' };

  const money = detectMoneyRequest(text);
  if (money) return money;

  const control = detectMediaControl(text);
  if (control) return control;

  const inService = detectMusicInService(text);
  if (inService) return inService;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      // A rule can hold both shapes of the same instruction: "gaana bajao" has
      // nothing to capture while "kesariya gaana bajao" names a song. An
      // undefined group means the wordless shape matched, not that the rule
      // failed - reading it as failure is what made "gaana bajao" do nothing.
      if (!rule.argument || match[1] === undefined) {
        // "Gaana bajao", "play some music": which one? Asked, not guessed.
        if (rule.action === 'music') return askForSong(text);
        return { action: rule.action };
      }
      let value = tidy(match[1]);
      // "sada shiv boliye ko ...": "ko" marks the object, it is not the title.
      if (rule.action === 'youtube') value = value.replace(/\s+(?:ko|को)$/i, '').trim();
      if (!value) continue;
      // A single letter or a stray number is not an app anybody named.
      if (rule.action === 'app' && value.length < 2) continue;
      if (rule.action === 'youtube' && WANTS_PLAY.test(text)) {
        return { action: 'youtube', query: value, play: true };
      }
      if (rule.action === 'app') return { action: 'app', name: canonicalApp(value) };
      return { action: rule.action, [rule.argument]: value };
    }
  }

  // "Play despacito", "kesariya bajao", "tum hi ho sunao" - a song with no
  // service named. It went to the model, which offered instructions. YouTube is
  // the one service another app can actually start on a chosen song
  // (DeviceActions.firstYouTubeVideo), so that is where it plays - the way an
  // assistant picks a default rather than asking where.
  const song = /^(?:play|सुनाओ)\s+(.+)$/i.exec(text)
    || /^(.+?)\s+(?:bajao|baja\s+do|sunao|suna\s+do|play\s+karo|play\s+kar\s+do|बजाओ|सुनाओ)$/i.exec(text);
  if (song) {
    // "Play some music", "play a song for me": nothing named, so ask.
    if (GENERIC_MUSIC.test(tidy(song[1]))) return askForSong(text);
    const query = tidy(song[1]).replace(/\s*(?:song|gaana|gana|गाना)\s*$/i, '').trim();
    if (query.length > 1 && !/^(?:koi|kuch|कोई|कुछ)$/i.test(query)) {
      return { action: 'youtube', query, play: true };
    }
  }
  return null;
}

const CANCEL = /^(?:cancel|never\s*mind|nothing|no|nahi|nahin|kuch\s+nahi|rehne\s+do|rahne\s+do|chhodo|chodo|jane\s+do|रहने\s+दो|छोड़ो|कुछ\s+नहीं|नहीं)$/i;
const ANYTHING = /^(?:any(?:thing)?|any\s+song|whatever|your\s+choice|you\s+choose|surprise\s+me|kuch\s+bhi|koi\s+bhi(?:\s+gaana)?|kuchh\s+bhi|tum\s+(?:choose|chuno)\s+karo|कुछ\s+भी|कोई\s+भी)$/i;
const NOT_AN_ANSWER = /^(?:what|why|how|when|where|who|kya|kyu|kyon|kaise|kab|kahan|kaun\s+hai|tell\s+me|explain|batao)\b/i;

/**
 * The reply to a question SMARAN asked - "which song?".
 *
 * Returns the command to carry out, `{action: 'cancelled'}` when they
 * called it off, or null when what was said is plainly not an answer (a
 * new question), so the caller forgets the question and carries on.
 */
export function answerFollowUp(asked, answer) {
  const raw = String(answer || '').trim();
  if (!raw || !asked) return null;
  const text = tidy(stripWakePhrase(raw));
  if (!text) return null;
  if (CANCEL.test(text)) return { action: 'cancelled' };
  if (ANYTHING.test(text)) {
    return asked.app ? { action: 'music', query: '', app: asked.app } : { action: 'music' };
  }
  // A whole instruction instead of an answer: "pause", "open WhatsApp".
  // A song said with a verb - "kesariya bajao" - still goes to the app
  // that was asked about.
  const direct = detectDeviceCommand(text);
  if (direct && direct.action === 'youtube' && direct.play && asked.app) {
    return { action: 'music', query: direct.query, app: asked.app };
  }
  if (direct && direct.action !== 'ask') return direct;
  if (raw.length > 80 || /\?\s*$/.test(raw) || NOT_AN_ANSWER.test(text)) return null;
  const query = text
    .replace(/^(?:play|bajao|chalao|sunao|लगाओ)\s+/i, '')
    .replace(/\s+(?:bajao|baja\s+do|chalao|chala\s+do|sunao|suna\s+do|lagao|laga\s+do|play\s+karo|play\s+kar\s+do|बजाओ|चलाओ|सुनाओ)$/i, '')
    .replace(/\s+(?:song|gaana|gana|गाना|wala|waala|वाला)$/i, '')
    .trim();
  if (query.length < 2) return null;
  return asked.app
    ? { action: 'music', query, app: asked.app }
    : { action: 'youtube', query, play: true };
}

/** What to say when a question is called off. */
export function cancelledLine(asked) {
  if (asked?.lang === 'hi') return 'ठीक है।';
  if (asked?.lang === 'hinglish') return 'Theek hai.';
  return 'Okay.';
}

/**
 * What to say back, in the language of the request.
 *
 * Short, because it is spoken aloud while something is already opening, and
 * honest about failure: an app that is not installed is said plainly rather
 * than reported as if it had opened.
 */
const MONEY_LINE = 'I don\'t send money or buy anything myself - that part is always yours.';

export function describeOutcome(command, result) {
  const ok = Boolean(result?.opened);
  switch (command?.action) {
    case 'say':
      return MONEY_LINE;
    case 'skip_ad':
      return result?.said || (result?.skipped ? 'Skipped.' : 'There\'s no Skip button yet.');
    case 'app':
      if (ok && command.money) return `Opened ${result.label || command.name}. ${MONEY_LINE}`;
      if (ok) return `Opening ${result.label || command.name}.`;
      if (result?.reason === 'not-installed') {
        return `I can't find ${command.name} on this phone.`;
      }
      return `I couldn't open ${command.name}.`;
    case 'media':
      return result?.said || (ok ? 'Done.' : 'Nothing is playing right now.');
    case 'youtube':
      if (!ok) return 'I couldn\'t open YouTube.';
      if (result?.mode === 'play') return `Playing ${command.query} on YouTube.`;
      return command.query
        ? `Searching YouTube for ${command.query}.`
        : 'Opening YouTube.';
    case 'music':
      if (command.app) {
        // Spotify will not let another app start a song; it opens on the
        // search with the song on top. Said as it is, not as "playing".
        if (ok && result?.mode === 'search') return `Opened ${command.query} in ${command.app}. Tap it to play.`;
        if (ok) return command.query ? `Playing ${command.query} on ${command.app}.` : `Opening ${command.app}.`;
        return `${command.app} isn't installed on this phone.`;
      }
      if (ok) return command.query ? `Playing ${command.query}.` : 'Playing music.';
      return 'No music app answered on this phone.';
    case 'url':
      return ok ? 'Opening that page.' : 'I couldn\'t open that address.';
    default:
      return '';
  }
}

export default detectDeviceCommand;
