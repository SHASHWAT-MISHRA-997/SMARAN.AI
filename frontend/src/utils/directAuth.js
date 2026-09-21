import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
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

/**
 * "Continue with GitHub" in one tap, the way Google already is.
 *
 * GitHub OAuth Apps have no PKCE, so an app with no secret cannot finish a
 * sign-in by itself - which is why this used to be the device-code flow, with
 * eight characters carried from one screen to another. The site holds the
 * secret instead (website/netlify/functions/github-auth.mjs) and hands back an
 * identity rather than a token.
 *
 * The verifier below is what makes that safe. Any app on the phone may claim
 * ai.smaran.app://, so what comes back through the browser is sealed against
 * the SHA-256 sent at the start, and opening it needs the verifier that never
 * left here. An app that intercepts the redirect catches something it cannot
 * read.
 */
const SITE = 'https://smaran-ai.netlify.app';
const APP_REDIRECT = 'ai.smaran.app://auth-callback';
const GITHUB_TROUBLE = {
  denied: 'GitHub sign-in was cancelled.',
  exchange: 'GitHub could not complete sign-in. The server OAuth configuration needs checking.',
  profile: 'GitHub could not return your profile. Please try again.',
  scope: 'GitHub could not return your email addresses. Please allow email access when signing in.',
  unverified: 'Verify an email address in your GitHub account, then try again.',
  unknown: 'GitHub sign-in could not finish. Please start again from SMARAN.AI.',
};

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function makeVerifier() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

/** Resolve when the browser steps back into the app, or when it never does. */
function waitForAppReturn(signal) {
  return new Promise((resolve, reject) => {
    let handle;
    const finish = (outcome, error) => {
      handle?.remove?.();
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(outcome);
    };
    const cancel = () => finish(null, new DOMException('Sign-in cancelled.', 'AbortError'));

    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true });

    CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (!url || !url.startsWith(APP_REDIRECT)) return;
      const params = new URLSearchParams(url.slice(url.indexOf('#') + 1));
      finish({ sealed: params.get('result'), error: params.get('error') });
    }).then((listener) => { handle = listener; if (signal?.aborted) cancel(); });
  });
}

async function nativeGitHubDirect(signal) {
  const { verifier, challenge } = await makeVerifier();
  const returned = waitForAppReturn(signal);
  await device.openUrl({
    url: `${SITE}/api/github/start?challenge=${challenge}&redirect=${encodeURIComponent(APP_REDIRECT)}`,
  });

  const { sealed, error } = await returned;
  if (error || !sealed) throw new Error(GITHUB_TROUBLE[error] || GITHUB_TROUBLE.unknown);

  signal.throwIfAborted();
  const { user } = await nativeRequest(`${SITE}/api/github/exchange`, 'POST', { sealed, verifier },
    { 'Content-Type': 'application/json' });
  if (!user?.id || !user.email) throw new Error('GitHub sign-in could not be confirmed. Please start again.');
  return { provider: 'github', user };
}

async function nativeGitHub(signal, onProgress) {
  // The device-code flow stays as the fallback, not as the path. It needs no
  // secret anywhere, so it still works if the site has none configured, or is
  // simply unreachable from wherever this phone is.
  const ready = await nativeRequest(`${SITE}/api/github/config`).catch(() => null);
  if (ready?.configured) return nativeGitHubDirect(signal);

  const flow = await nativeForm('https://github.com/login/device/code',
    { client_id: GITHUB_CLIENT_ID, scope: 'read:user user:email' });
  if (flow.error || !flow.device_code) throw new Error('GitHub Device Flow is unavailable.');
  const verify = flow.verification_uri || 'https://github.com/login/device';
  // ?code= prefills GitHub's device page, so this is one confirm rather than
  // eight characters retyped from one app into another.
  const prefilled = `${verify}?code=${encodeURIComponent(flow.user_code)}`;
  onProgress({ url: prefilled, plain_url: verify, user_code: flow.user_code });
  await device.openUrl({ url: prefilled });
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
