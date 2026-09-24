/* Whether SMARAN is speaking right now, for views that live outside the chat.
 *
 * The floating window (PipCompanion) is mounted by App, not by the chat that
 * speaks, so it drew the character standing still while the answer was being
 * read out. The chat sets this; the float reads it, and animates.
 */
const EVENT = 'smaran:speaking';
let speaking = false;

export function setSpeaking(value) {
  const next = Boolean(value);
  if (next === speaking) return;
  speaking = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { speaking } }));
  }
}

export const isSpeakingNow = () => speaking;

/** Call `fn(speaking)` on every change; returns the unsubscribe. */
export function onSpeaking(fn) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => fn(Boolean(event?.detail?.speaking));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
