/**
 * What the phone's floating window shows.
 *
 * When SMARAN opens another app it shrinks into a picture-in-picture window in
 * the corner. That window used to show whatever screen was underneath - from
 * the chat, a quarter-size slice of the conversation, a few clipped words
 * over YouTube - when the one thing anybody wants to see there is the
 * character. The character is now the default, and the choice is the user's.
 */

export const FLOAT_VIEW_KEY = 'sm_float_view';
export const FLOAT_VIEW_EVENT = 'smaran:float-view';

export const FLOAT_VIEWS = [
  { id: 'myra', label: 'Myra', hint: 'The animated character. Lightest on battery.' },
  { id: 'amarya', label: 'Amarya', hint: 'The 3D character.' },
  { id: 'core', label: 'Energy Core', hint: 'The glowing core, no character.' },
  { id: 'conversation', label: 'Conversation', hint: 'The chat, shrunk to fit.' },
  { id: 'off', label: 'Off', hint: 'Stay out of the way: opening an app does not float SMARAN.' },
];

const KNOWN = new Set(FLOAT_VIEWS.map((view) => view.id));

/* Nobody has chosen yet: follow the character they talk to in voice calls,
   so the float and the call agree without being told to. */
const FROM_CALL_CHARACTER = { 'anime-girl': 'myra', evelyn: 'amarya', core: 'core' };

const storage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked; defaults apply
  }
};

export function getFloatView() {
  const store = storage();
  const saved = store?.getItem(FLOAT_VIEW_KEY);
  if (KNOWN.has(saved)) return saved;
  return FROM_CALL_CHARACTER[store?.getItem('sm_avatar_id')] || 'myra';
}

export function setFloatView(id) {
  if (!KNOWN.has(id)) return;
  storage()?.setItem(FLOAT_VIEW_KEY, id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FLOAT_VIEW_EVENT, { detail: { view: id } }));
  }
}

/** False when the user has turned the floating window off. */
export function floatsAtAll() {
  return getFloatView() !== 'off';
}

/** True when the floating window should draw a character or core over the page. */
export function drawsFigure(view = getFloatView()) {
  return view === 'myra' || view === 'amarya' || view === 'core';
}
