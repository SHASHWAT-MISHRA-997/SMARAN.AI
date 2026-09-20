import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { API_BASE } from '../context/AuthContext';

export const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
];
export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());
export const providerLabel = (id) => id === 'github' ? 'GitHub' : 'Google';
const device = registerPlugin('SmaranDevice');
const WEB_CLIENT_ID = '656427300466-jqr94suucdutmjerm0i096i87p1cpctf.apps.googleusercontent.com';
const GITHUB_CLIENT_ID = 'Ov23livgXVI30gGhq3wQ';

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
  if (isNative() && !API_BASE) return ['google', 'github'];
  try {
    const config = await api('direct/config');
    return PROVIDERS.filter(({ id }) => id === 'google'
      ? (isNative() ? config.google_client_id : config.google_desktop_client_id)
      : config.github_client_id).map(({ id }) => id);
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

const nativeForm = (url, body) => nativeRequest(url, 'POST', new URLSearchParams(body).toString(),
  { 'Content-Type': 'application/x-www-form-urlencoded' });

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

async function nativeGitHub(signal, onProgress) {
  const flow = await nativeForm('https://github.com/login/device/code',
    { client_id: GITHUB_CLIENT_ID, scope: 'read:user user:email' });
  if (flow.error || !flow.device_code) throw new Error('GitHub Device Flow is unavailable.');
  onProgress({ url: 'https://github.com/login/device', user_code: flow.user_code });
  await device.openUrl({ url: 'https://github.com/login/device' });
  let interval = Math.max(5, Number(flow.interval) || 5);
  const deadline = Date.now() + Math.min(900, Number(flow.expires_in) || 900) * 1000;
  while (Date.now() < deadline) {
    await waitForPoll(interval * 1000, signal);
    const token = await nativeForm('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID, device_code: flow.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') { interval += 5; continue; }
    if (token.error || !token.access_token) throw new Error('GitHub sign-in was denied or expired.');
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const profile = await nativeRequest('https://api.github.com/user', 'GET', undefined, headers);
    const emails = await nativeRequest('https://api.github.com/user/emails', 'GET', undefined, headers);
    const verified = emails.filter((e) => e.verified && e.email);
    const email = (verified.find((e) => e.primary) || verified[0])?.email;
    if (!email || !profile.id) throw new Error('GitHub did not return a verified email address.');
    signal.throwIfAborted();
    return { provider: 'github', user: { id: `github_${profile.id}`, email,
      username: profile.name || profile.login, avatar: profile.avatar_url } };
  }
  throw new Error('GitHub sign-in expired. Please start again.');
}

export async function startOAuth(provider, { signal = new AbortController().signal, onProgress = () => {} } = {}) {
  if (!PROVIDERS.some(({ id }) => id === provider)) throw new Error('Unknown sign-in provider.');
  if (isNative() && provider === 'google') return nativeGoogle(signal);
  if (isNative() && !API_BASE) return nativeGitHub(signal, onProgress);
  // Open synchronously on the click so popup blockers do not eat an async window.open.
  const desktopBrowser = window.pywebview?.api?.open_sign_in;
  const popup = isNative() || desktopBrowser ? null : window.open('about:blank', 'smaran-sign-in', 'width=560,height=720');
  if (popup) popup.opener = null;
  let flow;
  try {
    flow = await api(`direct/${provider}/start`, {}, signal);
    onProgress(flow);
    if (desktopBrowser) await desktopBrowser(flow.url);
    else if (isNative()) await device.openUrl({ url: flow.url });
    else if (popup) popup.location.href = flow.url;
    const deadline = Date.now() + flow.expires_in * 1000;
    let interval = flow.interval;
    while (Date.now() < deadline) {
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
