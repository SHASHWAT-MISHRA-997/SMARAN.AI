/**
 * Sounds and haptics: a small, quiet response to everything you touch.
 *
 * Every sound is synthesised on the spot with Web Audio - nothing to ship,
 * nothing to download, no delay loading a file. On a phone the same moment
 * also gives a short vibration. Settings -> Appearance turns both on or off
 * and sets the volume; the choice is kept on this device.
 *
 *   haptic('tap')        any button, tab, link or menu item (automatic)
 *   haptic('toggle')     a switch or checkbox (automatic)
 *   haptic('send')       a message or task sent
 *   haptic('success')    a reply, task or page finished
 *   haptic('error')      something failed
 *   haptic('attention')  SMARAN is waiting for you (Allow / Deny)
 */

export const HAPTICS_KEY = 'sm_haptics';
export const HAPTICS_VOLUME_KEY = 'sm_haptics_volume';
export const HAPTICS_EVENT = 'smaran:haptics-changed';

const store = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};

export function hapticsEnabled(storage = store()) {
  try { return (storage?.getItem(HAPTICS_KEY) || 'on') !== 'off'; } catch { return true; }
}

export function hapticsVolume(storage = store()) {
  try {
    const value = Number(storage?.getItem(HAPTICS_VOLUME_KEY));
    return Number.isFinite(value) && storage?.getItem(HAPTICS_VOLUME_KEY) !== null ? Math.min(1, Math.max(0, value)) : 0.6;
  } catch { return 0.6; }
}

export function setHaptics({ enabled, volume } = {}, storage = store()) {
  try {
    if (enabled !== undefined) storage?.setItem(HAPTICS_KEY, enabled ? 'on' : 'off');
    if (volume !== undefined) storage?.setItem(HAPTICS_VOLUME_KEY, String(Math.min(1, Math.max(0, Number(volume) || 0))));
  } catch { /* private mode: the switch simply does not stick */ }
  try { globalThis.dispatchEvent?.(new CustomEvent(HAPTICS_EVENT)); } catch { /* not in a browser */ }
}

/* Each sound: notes of [frequency Hz, start s, length s, peak gain], a wave
   shape, and a vibration pattern in milliseconds for phones. Kept short and
   soft on purpose - these play many times a minute. */
export const SOUNDS = {
  tap: { wave: 'sine', notes: [[1650, 0, 0.035, 0.18]], vibrate: 8 },
  toggle: { wave: 'triangle', notes: [[880, 0, 0.04, 0.2], [1320, 0.045, 0.05, 0.18]], vibrate: 12 },
  send: { wave: 'sine', notes: [[660, 0, 0.06, 0.2], [990, 0.05, 0.08, 0.2]], sweep: 1.25, vibrate: 15 },
  success: { wave: 'sine', notes: [[784, 0, 0.1, 0.22], [1175, 0.09, 0.16, 0.2]], vibrate: [12, 40, 18] },
  error: { wave: 'square', notes: [[220, 0, 0.09, 0.12], [175, 0.11, 0.14, 0.12]], vibrate: [30, 50, 30] },
  attention: { wave: 'sine', notes: [[988, 0, 0.12, 0.2], [988, 0.18, 0.12, 0.2]], vibrate: [20, 60, 20] },
};

let context = null;
let last = { kind: '', at: 0 };

function audio() {
  if (context) return context;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  try { context = new Ctx(); } catch { context = null; }
  return context;
}

export function haptic(kind = 'tap') {
  const sound = SOUNDS[kind];
  if (!sound || !hapticsEnabled()) return false;
  // The same sound twice within a moment is one event reported twice.
  const now = Date.now();
  if (last.kind === kind && now - last.at < 60) return false;
  last = { kind, at: now };

  const volume = hapticsVolume();
  if (volume > 0) {
    const ctx = audio();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') ctx.resume();
        const start = ctx.currentTime + 0.005;
        for (const [freq, at, length, peak] of sound.notes) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = sound.wave;
          osc.frequency.setValueAtTime(freq, start + at);
          if (sound.sweep) osc.frequency.exponentialRampToValueAtTime(freq * sound.sweep, start + at + length);
          gain.gain.setValueAtTime(0.0001, start + at);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * volume), start + at + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start + at);
          osc.stop(start + at + length + 0.02);
        }
      } catch { /* audio unavailable: stay silent */ }
    }
  }
  try { globalThis.navigator?.vibrate?.(sound.vibrate); } catch { /* no vibration motor */ }
  return true;
}

const TOGGLES = 'input[type="checkbox"], input[type="radio"], [role="switch"], [aria-pressed]';
const TAPPABLE = `button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, select, ${TOGGLES}`;

/** What a press on this element should sound like, or '' for nothing. */
export function soundFor(target) {
  const el = target?.closest?.(TAPPABLE);
  if (!el || el.disabled || el.getAttribute?.('aria-disabled') === 'true' || el.closest?.('[data-no-haptics]')) return '';
  return el.matches?.(TOGGLES) ? 'toggle' : 'tap';
}

/** Once, at start-up: every control in the app answers a press. */
export function installHaptics(root = globalThis.document) {
  if (!root || root.__smaranHaptics) return;
  root.__smaranHaptics = true;
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const kind = soundFor(event.target);
    if (kind) haptic(kind);
  }, { capture: true, passive: true });
  // Keyboard presses of a focused control count too.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const kind = soundFor(event.target);
    const typing = event.target?.tagName === 'TEXTAREA' || event.target?.isContentEditable
      || (event.target?.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/i.test(event.target.type || ''));
    if (kind && !typing) haptic(kind);
  }, { capture: true, passive: true });
  globalThis.addEventListener?.('smaran:haptic', (event) => haptic(event.detail?.kind || 'tap'));
}
