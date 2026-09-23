/**
 * "Hey SMARAN", always listening - the phone's switch for it.
 *
 * Off until the user turns it on: it keeps the microphone open (offline, and
 * nothing leaves the phone before the wake phrase), and Android shows a
 * notification for as long as it does. Both are the user's call, not ours.
 */

export const HEY_SMARAN_KEY = 'sm_hey_smaran';
export const HEY_SMARAN_EVENT = 'smaran:hey-smaran';

export function heySmaranOn() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(HEY_SMARAN_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setHeySmaran(on) {
  try {
    localStorage.setItem(HEY_SMARAN_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked: the switch simply does not persist
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HEY_SMARAN_EVENT, { detail: { on: Boolean(on) } }));
  }
}

/** What the voice call says when "Hey SMARAN" opens it with nothing else said. */
export const WAKE_GREETING = 'How may I help you?';
