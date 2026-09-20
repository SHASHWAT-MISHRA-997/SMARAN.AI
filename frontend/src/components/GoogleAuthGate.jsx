import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowRight, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { PROVIDERS, enabledProviders, isNative, providerLabel, startOAuth } from '../utils/directAuth';

export const GOOGLE_STORAGE_KEY = 'smaran_google_user';

/**
 * Check if there is an active authenticated user session.
 *
 * The key is still called smaran_google_user because an installed build has
 * one under that name and renaming it would sign everybody out for nothing.
 */
export const getSavedGoogleUser = () => {
  try {
    const raw = localStorage.getItem(GOOGLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      parsed.email.includes('@') &&
      parsed.id !== 'local' &&
      parsed.id !== 'local_guest'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const clearSavedGoogleUser = () => {
  try {
    localStorage.removeItem(GOOGLE_STORAGE_KEY);
  } catch {}

};

const INGEST_URL = 'https://smaran-analytics.netlify.app/ingest';
const INGEST_KEY = 'lYZFdOrxV90mCKl6DHP53YTJuU0pFOja';

const analyticsPlatform = () => {
  if (isNative()) return 'android';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
};

const sendSignInAnalytics = (user) => {
  if (!window.fetch) return;
  try {
    const installId =
      localStorage.getItem('sm_install_id') ||
      'desk_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('sm_install_id', installId);
    fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({
        install_id: installId,
        // The collector accepts a fixed vocabulary; anything else is a 400.
        event: user.provider === 'google' ? 'google_signin' : 'login',
        platform: analyticsPlatform(),
        app_version: import.meta.env.VITE_APP_VERSION,
        user_email: user.email || '',
        user_name: user.name || '',
      }),
    }).catch(() => {});
  } catch {}
};

const providerIcon = (id) => {
  if (id === 'google') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    );
  }
  if (id === 'github') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
        <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.4 4.9 18.4 5.2 18.4 5.2c.7 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z" />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
};

const GoogleAuthGate = ({ children, onUserChange }) => {
  const [currentUser, setCurrentUser] = useState(getSavedGoogleUser);
  const [busyProvider, setBusyProvider] = useState('');
  const [error, setError] = useState('');
  // Held between the redirect landing and the local session coming back, so
  // the screen shows something other than a bare sign-in form during it.
  const [finishing, setFinishing] = useState(false);
  // null means "not known yet, or could not ask" - every button stays live.
  const [available, setAvailable] = useState(null);
  const attempt = useRef(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => () => attempt.current?.abort(), []);

  useEffect(() => {
    if (currentUser) onUserChange?.(currentUser);
  }, [currentUser, onUserChange]);

  useEffect(() => {
    if (currentUser) return undefined;
    let cancelled = false;
    enabledProviders().then((ids) => { if (!cancelled) setAvailable(ids); });
    return () => { cancelled = true; };
  }, [currentUser]);

  const handleSignInSuccess = useCallback((userData) => {
    const user = {
      id: userData.id || 'user_' + Date.now(),
      name: userData.name || 'SMARAN User',
      email: (userData.email || '').toLowerCase().trim(),
      avatar: userData.avatar || null,
      provider: userData.provider,
      signedInAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(GOOGLE_STORAGE_KEY, JSON.stringify(user));
      localStorage.removeItem('sm_auth_logged_out');
      if (userData.access_token) localStorage.setItem('sm_session_token', userData.access_token);
    } catch {}
    setCurrentUser(user);
    onUserChange?.(user);
    setBusyProvider('');
    setFinishing(false);
    sendSignInAnalytics(user);
  }, [onUserChange]);

  const onProviderClick = async (provider) => {
    if (attempt.current) return;
    setError('');
    if (available && !available.includes(provider)) {
      setError(`${providerLabel(provider)} sign-in is not configured on this installation.`);
      return;
    }
    const controller = new AbortController();
    attempt.current = controller;
    setBusyProvider(provider);
    setProgress(null);
    try {
      const data = await startOAuth(provider, { signal: controller.signal, onProgress: setProgress });
      if (controller.signal.aborted) return;
      setFinishing(true);
      handleSignInSuccess({ id: data.user?.id, name: data.user?.username,
        email: data.user?.email, avatar: data.user?.avatar,
        provider, access_token: data.access_token });
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Sign-in could not finish.');
    } finally {
      if (attempt.current === controller) {
        attempt.current = null;
        setBusyProvider('');
        setFinishing(false);
        setProgress(null);
      }
    }
  };

  if (currentUser) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050508] text-zinc-100 overflow-y-auto select-none font-sans py-6">
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full opacity-20 blur-[90px]"
          style={{ background: 'radial-gradient(circle, #ef4444 0%, #7f1d1d 60%, transparent 80%)' }}
        />
        <div
          className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[380px] h-[380px] rounded-full opacity-15 blur-[80px]"
          style={{ background: 'radial-gradient(circle, #dc2626 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[460px] mx-4 my-auto">
        <div className="relative rounded-2xl border border-red-500/25 bg-zinc-950/95 p-7 sm:p-8 shadow-[0_0_60px_rgba(239,68,68,0.18)] backdrop-blur-md">
          <span className="pointer-events-none absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2 border-red-500/60 rounded-tl-xl" />
          <span className="pointer-events-none absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2 border-red-500/60 rounded-tr-xl" />
          <span className="pointer-events-none absolute left-0 bottom-0 h-4 w-4 border-l-2 border-b-2 border-red-500/60 rounded-bl-xl" />
          <span className="pointer-events-none absolute right-0 bottom-0 h-4 w-4 border-r-2 border-b-2 border-red-500/60 rounded-br-xl" />

          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3 flex items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 via-red-700 to-zinc-900 p-[1.5px] shadow-[0_0_25px_rgba(239,68,68,0.4)]">
                <div className="w-full h-full rounded-[14px] bg-zinc-950 flex items-center justify-center overflow-hidden">
                  <img
                    src="/smaran-logo.png"
                    alt="SMARAN.AI Logo"
                    className="w-10 h-10 object-contain drop-shadow-[0_0_10px_rgba(239,68,68,0.6)]"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 ring-4 ring-zinc-950">
                <Lock className="h-2.5 w-2.5 text-white" />
              </div>
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span>SMARAN</span>
              <span className="text-red-500">.</span>
              <span>AI</span>
            </h1>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-0.5 text-[11px] font-semibold text-red-300">
              <Sparkles className="h-3 w-3 text-red-400" />
              <span>Autonomous Intelligence Runtime</span>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {finishing ? (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-zinc-300">
              <Loader2 className="h-6 w-6 animate-spin text-red-500" />
              <span>Finishing sign-in…</span>
            </div>
          ) : (
            <div className="space-y-3">
              {PROVIDERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onProviderClick(id)}
                  disabled={Boolean(busyProvider)}
                  className="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700/80 bg-zinc-900/90 px-4 py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 hover:border-red-500/50 hover:bg-zinc-800 hover:shadow-[0_0_20px_rgba(239,68,68,0.25)] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {busyProvider === id ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin text-red-500 shrink-0" />
                      <span className="text-zinc-200">Opening…</span>
                    </>
                  ) : (
                    <>
                      {providerIcon(id)}
                      <span>{label}</span>
                      {available && !available.includes(id) && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          not set up
                        </span>
                      )}
                      <ArrowRight className="h-4 w-4 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-red-400" />
                    </>
                  )}
                </button>
              ))}
            </div>
          )}

          {busyProvider && (
            <div className="mt-4 space-y-3 text-center text-sm text-zinc-300" role="status">
              {progress?.user_code && <p>Enter this code on GitHub: <strong className="block select-text text-xl tracking-widest text-white">{progress.user_code}</strong></p>}
              {progress?.url && <a className="block text-red-300 underline" href={progress.url} target="_blank" rel="noreferrer">Open {providerLabel(busyProvider)} sign-in</a>}
              <p>Complete sign-in, then return here.</p>
              <button type="button" className="text-zinc-300 underline" onClick={() => attempt.current?.abort()}>Cancel sign-in</button>
            </div>
          )}
          <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-500">
            SMARAN.AI has no password of its own. Signing in happens at Google,
            or GitHub, and only your profile and verified email are requested.
          </p>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthGate;
