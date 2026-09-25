/* Keyboard shortcuts: one list, read by the app and edited in Settings.
 *
 * Settings -> Shortcuts saved edited combinations that nothing read: the app
 * listened for three hard-coded ones, and "Open Terminal", "Start/End Voice
 * Call", "Stop Desktop Agent" and "Toggle Mute" did nothing at all. The app now
 * applies whatever is saved here, and every action is wired.
 */

export const SHORTCUTS_KEY = 'sm_shortcuts';
export const SHORTCUTS_EVENT = 'smaran:shortcuts-changed';

export const DEFAULT_SHORTCUTS = [
  { id: 'new_chat', name: 'New Conversation', keys: 'Ctrl + Alt + N', scope: 'In-App', description: 'Start a fresh chat session.' },
  { id: 'open_settings', name: 'Open Settings', keys: 'Ctrl + Alt + S', scope: 'In-App', description: 'Open or close the settings panel.' },
  { id: 'toggle_panel', name: 'Toggle Right Panel', keys: 'Ctrl + Alt + P', scope: 'In-App', description: 'Show or hide the right performance panel.' },
  { id: 'toggle_terminal', name: 'Open Terminal', keys: 'Ctrl + `', scope: 'In-App', description: 'Open or close the terminal.' },
  { id: 'voice_speak', name: 'Start/End Voice Call', keys: 'Ctrl + Alt + V', scope: 'In-App', description: 'Start or end a hands-free voice call.' },
  { id: 'stop_control', name: 'Stop Desktop Agent', keys: 'Ctrl + Alt + X', scope: 'In-App', description: 'Immediately stop anything controlling the computer.' },
  { id: 'mute_audio', name: 'Toggle Mute', keys: 'Ctrl + Alt + M', scope: 'System', description: "Mute or unmute this computer's sound." },
];

/** The saved list, with any shortcut added since it was saved filled in. */
export function loadShortcuts(storage = globalThis.localStorage) {
  let saved = [];
  try { saved = JSON.parse(storage?.getItem(SHORTCUTS_KEY) || '[]'); } catch { saved = []; }
  const byId = new Map((Array.isArray(saved) ? saved : []).map((s) => [s.id, s]));
  return DEFAULT_SHORTCUTS.map((d) => ({ ...d, keys: byId.get(d.id)?.keys || d.keys }));
}

export function saveShortcuts(list, storage = globalThis.localStorage) {
  storage?.setItem(SHORTCUTS_KEY, JSON.stringify(list.map(({ id, keys }) => ({ id, keys }))));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT));
}

const NAMES = { ' ': 'Space', escape: 'Esc', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right' };

/** "Ctrl + Alt + N" -> {ctrl, alt, shift, meta, key}. */
export function parseCombo(text) {
  const parts = String(text || '').split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const combo = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') combo.ctrl = true;
    else if (part === 'alt' || part === 'option') combo.alt = true;
    else if (part === 'shift') combo.shift = true;
    else if (part === 'meta' || part === 'cmd' || part === 'win') combo.meta = true;
    else combo.key = part;
  }
  return combo;
}

function eventKey(e) {
  // With Alt held, e.key can be a special character; the physical key is steadier.
  if (e.code?.startsWith('Key')) return e.code.slice(3).toLowerCase();
  if (e.code?.startsWith('Digit')) return e.code.slice(5);
  if (e.code === 'Backquote') return '`';
  return String(e.key || '').toLowerCase();
}

export function matches(e, text) {
  const c = parseCombo(text);
  if (!c.key) return false;
  return e.ctrlKey === c.ctrl && e.altKey === c.alt && e.shiftKey === c.shift && e.metaKey === c.meta
    && eventKey(e) === c.key;
}

/** The combination a key press makes, for recording a new shortcut; null for a bare modifier. */
export function comboFromEvent(e) {
  const key = eventKey(e);
  if (['control', 'alt', 'shift', 'meta', 'os'].includes(key)) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;   // a lone letter would fire while typing
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(NAMES[key] || (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)));
  return parts.join(' + ');
}
