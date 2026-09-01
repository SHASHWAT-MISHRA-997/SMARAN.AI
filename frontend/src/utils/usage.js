/**
 * Counting installs and launches of the phone app.
 *
 * The desktop app has reported this since it shipped; the phone never has,
 * because reporting lived in the Python backend and a phone has none. So the
 * dashboard could only ever say "windows", however many people were using the
 * Android build.
 *
 * What is sent is four fields and nothing else: a random id for this
 * installation, the word "install" or "launch", the platform, and the version.
 * No conversation, no prompt, no file, no key, no address. The id is generated
 * on this device, is not derived from anything about you or the phone, and is
 * the only thing that links two events together.
 *
 * It can be turned off, and when it is nothing is sent at all.
 */

const ID_KEY = 'sm_install_id';
const STATE_KEY = 'sm_usage_state';
const OFF_KEY = 'sm_usage_off';

/* Baked at build time, the same way the desktop app bakes them. With neither
   set - which is what a plain source checkout has - this is inert and no
   request is ever made. */
const ENDPOINT = (import.meta.env.VITE_ANALYTICS_URL || '').trim();
const KEY = (import.meta.env.VITE_ANALYTICS_KEY || '').trim();

const randomId = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const installId = () => {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
};

export const isEnabled = () => localStorage.getItem(OFF_KEY) !== '1';

export const setEnabled = (on) => {
  localStorage.setItem(OFF_KEY, on ? '0' : '1');
};

const loadState = () => {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

/**
 * Send one event. Never throws, never blocks, never retries.
 *
 * A counter is not worth a single millisecond of the app's startup, so a
 * failure here is swallowed on purpose - being offline, or the endpoint being
 * down, must not be something the person notices.
 */
export function report(event, platform, appVersion) {
  if (!ENDPOINT || !KEY || !isEnabled()) return;

  try {
    fetch(`${ENDPOINT.replace(/\/+$/, '')}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': KEY },
      body: JSON.stringify({
        install_id: installId(),
        event,
        platform,
        app_version: appVersion,
        os_version: (navigator.userAgent.match(/Android\s+([\d.]+)/) || [])[1] || '',
      }),
      // The answer is of no interest, and keepalive lets it finish if the
      // person closes the app in the same second.
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* storage or network unavailable */
  }
}

/**
 * Called once when the app starts.
 *
 * "install" goes out the first time only; every start after that is a
 * "launch". Both are held behind the same switch.
 */
export function reportStartup({ platform, appVersion }) {
  if (!ENDPOINT || !KEY || !isEnabled()) return;

  const state = loadState();
  if (!state.installed) {
    state.installed = true;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch { /* nothing to do */ }
    report('install', platform, appVersion);
    return;
  }
  report('launch', platform, appVersion);
}
