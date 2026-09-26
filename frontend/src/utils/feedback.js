/* Haptics and interface sounds - off until the person turns them on.
 *
 * Settings -> Appearance has the two switches. When on, every button press
 * gives a short tick (sound) and a short buzz (vibration, on devices that
 * have one: Android phones, some tablets; desktops simply ignore it).
 * The sounds are synthesised with Web Audio, so there are no files to ship
 * and nothing to download. Kept on this device only. */

const KEY = 'smaran.feedback.v1';
const DEFAULTS = { haptics: false, sounds: false };

export function loadFeedback() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveFeedback(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...prefs })); } catch { /* private mode */ }
  current = { ...DEFAULTS, ...prefs };
}

let current = loadFeedback();
let audio = null;

// kind -> [frequency Hz, duration ms, vibration pattern]
const KINDS = {
  tap: [880, 28, 8],
  success: [1180, 70, [10, 40, 16]],
  warn: [300, 110, [30, 50, 30]],
};

function tone(freq, ms) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + ms / 1000 + 0.02);
  } catch { /* no audio device */ }
}

/** Give feedback of a kind ('tap' | 'success' | 'warn'), as the settings allow. */
export function feedback(kind = 'tap') {
  const [freq, ms, buzz] = KINDS[kind] || KINDS.tap;
  if (current.sounds) tone(freq, ms);
  if (current.haptics && typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(buzz); } catch { /* not allowed here */ }
  }
}

/** Once, at start: a tick for every button, link-button and switch pressed. */
export function installFeedback() {
  if (typeof document === 'undefined' || installFeedback.done) return;
  installFeedback.done = true;
  document.addEventListener('pointerdown', (e) => {
    if (!current.sounds && !current.haptics) return;
    const hit = e.target?.closest?.('button, [role="button"], [role="switch"], [role="tab"], a, input[type="checkbox"], select');
    if (!hit || hit.disabled || hit.getAttribute('aria-disabled') === 'true') return;
    feedback('tap');
  }, { capture: true, passive: true });
}
