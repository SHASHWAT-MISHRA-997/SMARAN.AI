/**
 * "Make a website for my bakery", "ek sunset ki image banao", "create a video
 * of rain" - said to the voice call, and done by the studio that makes it.
 *
 * These went to the chat model, which read HTML aloud or described a picture
 * it could not draw. The app has a studio for each; the request is handed to
 * it, with the words as the prompt, and it starts the job itself.
 */

const CREATE = '(?:make|create|build|design|generate|produce|craft|bana(?:o|\\s*do|iye|\\s*ke\\s*do|\\s*dijiye)|taiyar\\s*karo|बनाओ|बना\\s*दो|बनाइए)';
const KINDS = [
  { view: 'videos', noun: '(?:video|clip|animation|reel|वीडियो)' },
  { view: 'design', noun: '(?:website|web\\s*site|webpage|web\\s*page|landing\\s*page|site|वेबसाइट)' },
  { view: 'images', noun: '(?:image|picture|photo|pic|tasveer|tasvir|poster|logo|wallpaper|illustration|artwork|तस्वीर|फोटो|इमेज)' },
];
// Asking about one, or playing one, is not asking for a new one.
const NOT_CREATING = /\b(?:play|chalao|dikhao|open|kholo|watch|search|find|how\s+(?:do|to|can)|kaise|what\s+is|kya\s+hai)\b/i;
const WAKE = /^\s*(?:(?:hey|hi|ok|okay|hello)\s+)?(?:smaran|amarya|myra|jarvis)\b[\s,!.:-]*/i;

/**
 * The studio this sentence asks something of, and the prompt to give it.
 *
 * @returns {{view: 'design'|'images'|'videos', prompt: string}|null}
 */
export function detectCreateRequest(utterance) {
  const text = String(utterance || '').replace(WAKE, '').trim();
  if (text.length < 8 || text.length > 400) return null;
  if (NOT_CREATING.test(text) || !new RegExp(CREATE, 'i').test(text)) return null;
  // The kind named first wins: "an image for my website" is an image.
  let best = null;
  for (const kind of KINDS) {
    const at = text.search(new RegExp(`(?<![a-z])${kind.noun}(?![a-z])`, 'i'));
    if (at >= 0 && (!best || at < best.at)) best = { view: kind.view, at };
  }
  return best ? { view: best.view, prompt: text } : null;
}


let pending = null;
const FRESH_MS = 60000;

/** Open the studio and leave the prompt for it. */
export function handOffToStudio(view, prompt) {
  pending = { view, prompt, at: Date.now() };
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('smaran:navigate', { detail: { view } }));
  // A studio already on screen does not mount again; it hears this instead.
  window.dispatchEvent(new CustomEvent('smaran:studio-prompt', { detail: { view } }));
}

/** The prompt left for this studio, once, if it is fresh. */
export function takeStudioPrompt(view) {
  if (!pending || pending.view !== view || Date.now() - pending.at > FRESH_MS) return '';
  const { prompt } = pending;
  pending = null;
  return prompt;
}
