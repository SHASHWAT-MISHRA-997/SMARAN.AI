export const defaults = { uiSize: 14, codeSize: 13, motion: 'system' };
export function normalizeAppearance(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  // null, undefined and '' are rejected before Number() sees them, because
  // Number(null) and Number('') are both 0 - perfectly finite - so they passed
  // the check and were then clamped up to the 12px minimum. Clearing the font
  // size box shrank the entire interface to its smallest size instead of
  // restoring the default.
  const size = (v, fallback) => {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(12, Math.min(24, n)) : fallback;
  };
  return { uiSize: size(value.uiSize, 14), codeSize: size(value.codeSize, 13),
    motion: ['system', 'on', 'off'].includes(value.motion) ? value.motion : 'system' };
}
export function loadAppearance() {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem('sm_ui_preferences') || '{}')); }
  catch { return { ...defaults }; }
}
export function applyAppearance(value) {
  const prefs = normalizeAppearance(value);
  const root = document.documentElement;
  root.style.fontSize = `${prefs.uiSize}px`;
  root.style.setProperty('--sm-code-size', `${prefs.codeSize}px`);
  root.dataset.reduceMotion = prefs.motion;
}
export function saveAppearance(value) {
  const prefs = normalizeAppearance(value);
  localStorage.setItem('sm_ui_preferences', JSON.stringify(prefs));
  applyAppearance(prefs);
}
