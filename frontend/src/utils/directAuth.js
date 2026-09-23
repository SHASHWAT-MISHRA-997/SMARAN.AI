import { CapacitorHttp } from '@capacitor/core';
import { device } from './devicePlugin';
import { API_BASE } from '../context/AuthContext';

/**
 * Signing in at Google, with no secret held anywhere in this app.
 *
 * GitHub used to be here too and has been removed on purpose. Its OAuth Apps
 * have no PKCE, so finishing a sign-in needs a client secret, which an app
 * installed on someone else's machine cannot keep. The two ways round that
 * were a device code typed by hand, or a secret parked on the website - the
 * first is two screens and a transcription, the second is one more credential
 * to hold correctly forever. Neither earns its place next to an account you
 * can simply make here.
 *
 * What replaced it is in app/password_auth.py: an account on this machine,
 * with security answers stored as salted hashes.
 */
export const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
];
export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());
export const providerLabel = () => 'Google';
const WEB_CLIENT_ID = '656427300466-jqr94suucdutmjerm0i096i87p1cpctf.apps.googleusercontent.com';

async function api(path, body, signal) {
  const res = await fetch(`${API_BASE}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Sign-in could not finish. Please retry.');
  return data;
}

export async function enabledProviders() {
  if (isNative() && !API_BASE) return ['google'];
  try {
    const config = await api('direct/config');
    return PROVIDERS.filter(() => (isNative() ? config.google_client_id : config.google_desktop_client_id))
      .map(({ id }) => id);
  } catch { return null; }
}

export function waitForPoll(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Sign-in cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

async function nativeRequest(url, method = 'GET', data, headers = {}) {
  const result = await CapacitorHttp.request({ url, method, data,
    headers: { Accept: 'application/json', ...headers }, connectTimeout: 15000, readTimeout: 15000 });
  const body = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
  if (result.status >= 400) throw new Error('The provider could not verify your sign-in. Please retry.');
  return body;
}

async function nativeGoogle(signal) {
  const config = API_BASE ? await api('direct/config', undefined, signal) : { google_client_id: WEB_CLIENT_ID };
  const result = await device.chooseGoogleAccount({ clientId: config.google_client_id });
  signal.throwIfAborted();
  if (API_BASE) return { ...await api('google', { credential: result.credential }, signal), provider: 'google' };
  // A standalone phone has no local server. Verify with Google before saving its local profile.
  const claims = await nativeRequest(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(result.credential)}`);
  if (claims.aud !== config.google_client_id || !claims.sub || !claims.email ||
      ![true, 'true'].includes(claims.email_verified) ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      Number(claims.exp) * 1000 <= Date.now()) throw new Error('Google could not verify this account for SMARAN.AI.');
  signal.throwIfAborted();
  return { provider: 'google', user: { id: `google_${claims.sub}`, email: claims.email,
    username: claims.name, avatar: claims.picture } };
}

export async function startOAuth(provider, { signal = new AbortController().signal, onProgress = () => {} } = {}) {
  if (!PROVIDERS.some(({ id }) => id === provider)) throw new Error('Unknown sign-in provider.');
  if (isNative()) return nativeGoogle(signal);
  // Open synchronously on the click so popup blockers do not eat an async window.open.
  const desktopBrowser = window.pywebview?.api?.open_sign_in;
  const popup = desktopBrowser ? null : window.open('about:blank', 'smaran-sign-in', 'width=560,height=720');
  if (!desktopBrowser && !popup) {
    throw new Error('Google sign-in window was blocked. Allow popups for SMARAN.AI and try again.');
  }
  if (popup) popup.opener = null;
  let flow;
  try {
    flow = await api(`direct/${provider}/start`, {}, signal);
    onProgress(flow);
    if (desktopBrowser) await desktopBrowser(flow.url);
    else if (popup) popup.location.href = flow.url;
    const deadline = Date.now() + flow.expires_in * 1000;
    let interval = flow.interval;
    while (Date.now() < deadline) {
      if (popup?.closed) {
        throw new Error('Google sign-in window was closed before sign-in completed.');
      }
      await waitForPoll(interval * 1000, signal);
      const result = await api('direct/poll', { ticket: flow.ticket }, signal);
      if (result.status === 'complete') return { ...result, provider };
      interval = result.interval || interval;
    }
    throw new Error('Sign-in expired. Please start again.');
  } finally {
    popup?.close();
    if (flow) api('direct/cancel', { ticket: flow.ticket }).catch(() => {});
  }
}
