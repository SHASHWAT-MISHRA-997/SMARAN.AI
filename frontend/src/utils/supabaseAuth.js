import { createClient } from '@supabase/supabase-js';
import { API_BASE } from '../context/AuthContext';

/**
 * Sign-in, which now happens at Supabase rather than here.
 *
 * The app still issues and authorises against its own session token. All
 * Supabase does is vouch for who someone is; `/api/auth/supabase` checks that
 * claim with Supabase and then mints the local session every other endpoint
 * already understands. Moving providers therefore changes who does the
 * vouching and nothing about what a signed-in person can do.
 */

/* The project these builds ship against. The backend serves the same pair
   from /api/auth/supabase/config and wins when it answers, so a self-hoster
   can point their build at their own project without rebuilding; this is the
   fallback for the moment before that request returns, and for a phone with
   no backend to ask. Both values are public by design - the publishable key
   is meant to live in clients and authorises nothing row level security does
   not already allow. */
const DEFAULT_URL = 'https://abwzfxlyzwcnetogifwb.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_FpdKwtY3FBYbZPFYREMA8w_0WP8UfQZ';

export const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
  // Supabase calls LinkedIn's current OpenID Connect integration
  // `linkedin_oidc`; the older `linkedin` provider is deprecated and rejects
  // apps created today.
  { id: 'linkedin_oidc', label: 'Continue with LinkedIn' },
];

export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

/* Where the provider sends the person back to.
 *
 * On the desktop that is simply the page they started on. On Android it
 * cannot be: the OAuth flow leaves the app for the system browser, and
 * `https://localhost` there is the browser's own idea of localhost, not this
 * app - the person would land on an error page and the app would wait
 * forever. A custom scheme is the only thing that comes back, which is why
 * AndroidManifest.xml carries an intent filter for it. */
export const redirectTarget = () =>
  (isNative() ? 'ai.smaran.app://auth-callback' : window.location.origin);

let clientPromise;

const resolveConfig = async () => {
  try {
    const res = await fetch(`${API_BASE || ''}/api/auth/supabase/config`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.url && data?.anon_key) {
        return { url: data.url, key: data.anon_key };
      }
      // An install that has deliberately cleared its project is not
      // misconfigured, it has switched sign-in off. Say so rather than
      // quietly falling back to somebody else's project.
      if (data && data.configured === false) return null;
    }
  } catch {
    // No backend to ask - an unpaired phone. The built-in pair still works,
    // because Supabase is reached directly and not through this backend.
  }
  return { url: DEFAULT_URL, key: DEFAULT_ANON_KEY };
};

export const getSupabase = () => {
  if (!clientPromise) {
    clientPromise = resolveConfig().then((config) => {
      if (!config) return null;
      return createClient(config.url, config.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          /* The desktop lands back on its own URL carrying the result, so the
             client should read it. The Android build is handed the callback
             URL by the deep-link listener instead, and letting the client
             also scan its own address there makes it race itself. */
          detectSessionInUrl: !isNative(),
          flowType: 'pkce',
        },
      });
    });
  }
  return clientPromise;
};

export const providerLabel = (id) =>
  (id === 'linkedin_oidc' ? 'LinkedIn' : id === 'github' ? 'GitHub' : 'Google');

/**
 * Which providers the project actually has switched on.
 *
 * Worth asking before navigating anywhere. `signInWithOAuth` does not fail
 * for a disabled provider - it redirects, and Supabase answers the redirect
 * with a bare JSON body:
 *
 *     {"code":400,"error_code":"validation_failed",
 *      "msg":"Unsupported provider: provider is not enabled"}
 *
 * rendered as text in the window, with no way back. The person is left
 * staring at a JSON blob where a sign-in page should be, and the app never
 * hears about it because the app is no longer the page. Checking first costs
 * one small GET and keeps the failure inside the app, where it can be
 * explained.
 */
export const enabledProviders = async () => {
  const supabase = await getSupabase();
  if (!supabase) return [];
  const config = await resolveConfig();
  if (!config) return [];
  try {
    const res = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const external = data?.external || {};
    return PROVIDERS.map((p) => p.id).filter((id) => external[id]);
  } catch {
    // Unreachable is not the same as disabled. Returning nothing here would
    // grey out every button over a flaky moment; let the click try.
    return null;
  }
};

/** Start the hosted flow for one provider. */
export const startOAuth = async (provider) => {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Sign-in is switched off on this installation.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTarget() },
  });
  if (error) throw new Error(friendlyProviderError(error, provider));
};

/**
 * What a redirect carried back when it did not carry a session.
 *
 * Denying consent at the provider returns here with the reason in the URL
 * fragment. Without reading it the person simply arrives back at the
 * sign-in screen with no explanation, which looks like the button failed.
 */
export const redirectError = () => {
  const read = (text) => {
    if (!text) return null;
    const params = new URLSearchParams(text.replace(/^[#?]/, ''));
    const code = params.get('error') || params.get('error_code');
    if (!code) return null;
    const described = params.get('error_description');
    return (described || code).replace(/\+/g, ' ');
  };
  return read(window.location.hash) || read(window.location.search);
};

/**
 * Supabase says "Unsupported provider: provider is not enabled" when the
 * provider exists but nobody switched it on in the dashboard. That reads as
 * a bug in the app, and it is not - it is one checkbox in a console.
 */
export const friendlyProviderError = (error, provider) => {
  const text = String(error?.message || error || '');
  if (/not enabled|unsupported provider/i.test(text)) {
    const name = provider === 'linkedin_oidc' ? 'LinkedIn'
      : provider === 'github' ? 'GitHub' : 'Google';
    return `${name} sign-in is not switched on for this installation yet. `
      + 'Enable it under Authentication > Providers in the Supabase project.';
  }
  return text || 'Sign-in could not start.';
};

/** Trade a Supabase session for this installation's own session. */
export const exchangeForLocalSession = async (accessToken) => {
  const res = await fetch(`${API_BASE || ''}/api/auth/supabase`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'This installation could not verify that sign-in.');
  }
  return data;
};
