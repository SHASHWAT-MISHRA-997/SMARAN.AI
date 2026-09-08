/**
 * What the Energy Core is showing, and what it should say it is showing.
 *
 * Pulled out of the canvas for two reasons. The colours had no way to be
 * checked, and the core fell back to the idle tint for any state it did not
 * recognise — so a state nobody had added, `offline` among them, drew a
 * healthy cyan core while nothing was reachable. A visual that cannot fail
 * looks the same when it is failing.
 *
 * And the canvas carried one fixed label, "energy core visualisation", so a
 * screen reader was told a picture existed and never what it showed. The core
 * is the only indicator on the call screen for several of these conditions.
 */

/** Every state the core can be asked to draw. */
export const CORE_STATES = [
  'idle', 'listening', 'capturing', 'thinking', 'uploading', 'speaking',
  'success', 'muted', 'permission', 'warning', 'error', 'critical', 'offline',
];

/**
 * Base tint per state.
 *
 * Failure states stay warm so that a fault never reads as a healthy core in a
 * different mood, and the two inert states are cold and dim so neither can be
 * mistaken for one that is working.
 */
export const STATE_TINT = {
  idle:       [0, 220, 255],
  listening:  [0, 255, 194],
  capturing:  [0, 255, 194],
  thinking:   [128, 150, 255],
  uploading:  [128, 150, 255],
  speaking:   [0, 220, 255],
  success:    [64, 255, 140],
  muted:      [110, 125, 145],
  permission: [255, 176, 32],
  warning:    [255, 205, 70],
  error:      [255, 150, 40],
  critical:   [255, 70, 70],
  // Colder and dimmer than muted: muted is a working core being held quiet,
  // offline is a core with nothing behind it.
  offline:    [78, 92, 118],
};

/** States that mean something is wrong, rather than something is happening. */
export const FAULT_STATES = new Set([
  'permission', 'warning', 'error', 'critical', 'offline',
]);

const LABELS = {
  // Read after "SMARAN.AI energy core.", so naming the core again stutters.
  idle: 'Ready',
  listening: 'Listening',
  capturing: 'Recording what you are saying',
  thinking: 'Thinking',
  uploading: 'Sending what you said',
  speaking: 'Speaking',
  success: 'Done',
  muted: 'Microphone muted',
  permission: 'Microphone permission is needed',
  warning: 'Something needs attention',
  error: 'Something went wrong',
  critical: 'Stopped by an error',
  offline: 'Offline. Nothing can be reached right now',
};

/**
 * What a screen reader is told the core is showing.
 *
 * @param {string} state
 * @returns {string} a sentence, never an empty string
 */
export function coreStateLabel(state) {
  return LABELS[state] || LABELS.idle;
}

/** The tint for a state, and the idle tint for anything unrecognised. */
export function coreStateTint(state) {
  return STATE_TINT[state] || STATE_TINT.idle;
}

/**
 * The state the core should draw.
 *
 * Being offline outranks whatever the call thinks it is doing: a core that
 * shows "thinking" while the network is gone is describing an intention, not
 * a state. It does not outrank the microphone conditions, because those are
 * local, still true, and still the thing the user has to act on.
 *
 * @param {{voiceState?: string, online?: boolean}} input
 * @returns {string} one of CORE_STATES
 */
export function resolveCoreState({ voiceState = 'idle', online = true } = {}) {
  const state = CORE_STATES.includes(voiceState) ? voiceState : 'idle';
  if (online) return state;
  if (state === 'muted' || state === 'permission') return state;
  return 'offline';
}
