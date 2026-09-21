import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowRight, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { PROVIDERS, enabledProviders, isNative, providerLabel, startOAuth } from '../utils/directAuth';
import { API_BASE } from '../context/AuthContext';

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

/** The event the gate listens for, so signing out does not need a reload. */
const SIGNED_OUT = 'smaran:signed-out';

export const clearSavedGoogleUser = () => {
  try {
    localStorage.removeItem(GOOGLE_STORAGE_KEY);
    // Written on sign-in and, until now, never taken back. It is a live
    // bearer token: leaving it behind meant "sign out" removed the name on
    // screen and kept the credential underneath it.
    localStorage.removeItem('sm_session_token');
  } catch {}
  window.dispatchEvent(new CustomEvent(SIGNED_OUT));
};

/**
 * Sign out of the session, not just out of the screen.
 *
 * What this used to do was clear one localStorage key and call
 * `window.location.reload()`, and everything depended on that reload: the
 * gate keeps its own `currentUser`, and nothing else ever cleared it. On
 * Android the reload does not take effect, so the app stayed open on a
 * session with no profile - "Session without a profile", still authenticated,
 * still usable. Sign out did not sign anyone out.
 *
 * Two things were also simply missing. The backend was never told, so the
 * session row and its http-only cookie stayed valid for their full thirty
 * days - `logoutUser` existed in AuthContext and had no callers at all. And
 * `sm_session_token`, a bearer token for that same session, was left in
 * localStorage.
 *
 * Now the server is told first, the local copies go, the gate is told
 * directly rather than through a page load, and the reload is a last tidy-up
 * that nothing depends on.
 */
export const signOutEverywhere = async () => {
  try {
    await fetch(`${API_BASE || ''}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* Offline, or no backend to tell. The local session still goes. */
  }
  clearSavedGoogleUser();
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
  return null;
};

/** The three things this screen can be doing. */
const SIGN_IN = 'signin';
const REGISTER = 'register';
const RECOVER = 'recover';

const FORM_COPY = {
  [SIGN_IN]: { title: 'Sign in', action: 'Sign in' },
  [REGISTER]: { title: 'Create an account', action: 'Create account' },
  [RECOVER]: { title: 'Use your recovery code', action: 'Set new password' },
};

const inputClass =
  'w-full rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-3 py-2.5 text-sm text-white '
  + 'placeholder:text-zinc-500 outline-none transition focus:border-red-500/60';

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
  const [copied, setCopied] = useState(false);

  /* The account form. Google is still one tap for anyone who wants it; this
     is the path that needs nothing but this machine. */
  const [mode, setMode] = useState(SIGN_IN);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [working, setWorking] = useState(false);

  /* A recovery code exists in readable form exactly once, on this screen. It
     is stored only as a hash, so there is no "show it to me again" - which is
     why the app is not entered until the person says they have written it
     down. */
  const [issued, setIssued] = useState(null);

  /* Put the code on the clipboard the moment it exists, and again on tap.
     navigator.clipboard needs a secure context, which the packaged app has
     (https://localhost) and a plain-http LAN page does not - hence the
     fallback, rather than a silent no-op. */
  const copyCode = useCallback((code) => {
    if (!code) return;
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(() => {});
      return;
    }
    try {
      const field = document.createElement('textarea');
      field.value = code;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;top:-1000px';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
      done();
    } catch { /* the code is on screen either way */ }
  }, []);

  useEffect(() => () => attempt.current?.abort(), []);

  useEffect(() => {
    if (currentUser) onUserChange?.(currentUser);
  }, [currentUser, onUserChange]);

  /* The gate holds the only copy of "who is signed in" that decides whether
     the app renders at all. Sign-out used to reset it by reloading the page,
     which does not happen on Android - so the app stayed open on a cleared
     session. Told directly now; the reload is no longer load-bearing. */
  useEffect(() => {
    const onSignedOut = () => {
      setCurrentUser(null);
      setError('');
      setBusyProvider('');
      setFinishing(false);
      setIssued(null);
      setPassword('');
      setRecoveryCode('');
      setMode(SIGN_IN);
      attempt.current?.abort();
    };
    window.addEventListener(SIGNED_OUT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT, onSignedOut);
  }, []);

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

  /** Register, sign in, or set a new password with the recovery code. */
  const submitAccount = async (event) => {
    event.preventDefault();
    if (working || busyProvider) return;
    setError('');
    setWorking(true);
    const endpoint = { [SIGN_IN]: 'login', [REGISTER]: 'register', [RECOVER]: 'recover' }[mode];
    const body = mode === SIGN_IN ? { email, password }
      : mode === REGISTER ? { email, password, display_name: displayName || undefined }
        : { email, recovery_code: recoveryCode, new_password: password };
    try {
      const res = await fetch(`${API_BASE || ''}/api/auth/${endpoint}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // FastAPI reports a validation failure as a list of objects; showing
        // "[object Object]" to someone who mistyped an address is not an error
        // message.
        const detail = Array.isArray(data.detail)
          ? (data.detail[0]?.msg || 'Please check the details and try again.')
          : data.detail;
        throw new Error(detail || 'That did not work. Please try again.');
      }
      const account = {
        id: data.user?.id, name: data.user?.username, email: data.user?.email || email,
        provider: 'password', access_token: data.access_token,
      };
      if (data.recovery_code) {
        setIssued({ code: data.recovery_code, notice: data.recovery_notice, account });
        copyCode(data.recovery_code);
      } else {
        handleSignInSuccess(account);
      }
    } catch (err) {
      setError(err.name === 'TimeoutError'
        ? 'The local engine did not answer. Is SMARAN.AI running?'
        : (err.message || 'That did not work. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  /** Keep a copy of the recovery code somewhere that is not this screen. */
  const downloadRecoveryCode = () => {
    if (!issued) return;
    const text = [
      'SMARAN.AI recovery code',
      '',
      `Account: ${issued.account.email}`,
      `Code:    ${issued.code}`,
      '',
      'This code sets a new password if the password for this account is',
      'forgotten. It works once, and SMARAN.AI cannot show it again - it is',
      'stored only as a hash. Keep it somewhere a stranger cannot reach.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'smaran-ai-recovery-code.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

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
    try {
      const data = await startOAuth(provider, { signal: controller.signal });
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
          ) : issued ? (
            /* Shown once, and the app is not entered until it is acknowledged.
               A code nobody wrote down is a locked account later. */
            <div className="space-y-4 text-sm">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] leading-relaxed text-amber-100">
                <p className="font-bold">Save your recovery code</p>
                <p className="mt-1">{issued.notice}</p>
              </div>
              <button
                type="button"
                onClick={() => copyCode(issued.code)}
                title="Copy the code"
                className="block w-full select-text rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 font-mono text-base font-bold tracking-wider text-white"
              >
                {issued.code}
              </button>
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>{copied ? 'Copied to clipboard' : 'Tap the code to copy'}</span>
                <button type="button" onClick={downloadRecoveryCode} className="underline hover:text-zinc-200">
                  Download as a file
                </button>
              </div>
              <button
                type="button"
                onClick={() => { const { account } = issued; setIssued(null); handleSignInSuccess(account); }}
                className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white transition hover:bg-red-500"
              >
                I have saved my recovery code
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={submitAccount} className="space-y-3">
                <p className="text-[13px] font-bold text-zinc-200">{FORM_COPY[mode].title}</p>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
                {mode === REGISTER && (
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name (optional)"
                    autoComplete="name"
                    maxLength={80}
                    className={inputClass}
                  />
                )}
                {mode === RECOVER && (
                  <input
                    type="text"
                    required
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    placeholder="Recovery code"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    className={`${inputClass} font-mono tracking-wider`}
                  />
                )}
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === SIGN_IN ? 'Password' : 'New password'}
                  autoComplete={mode === SIGN_IN ? 'current-password' : 'new-password'}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={working || Boolean(busyProvider)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-bold text-white transition hover:bg-red-500 disabled:opacity-60"
                >
                  {working && <Loader2 className="h-4 w-4 animate-spin" />}
                  {FORM_COPY[mode].action}
                </button>
              </form>

              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                {mode === SIGN_IN ? (
                  <>
                    <button type="button" className="underline hover:text-zinc-200"
                            onClick={() => { setMode(REGISTER); setError(''); }}>
                      Create an account
                    </button>
                    <button type="button" className="underline hover:text-zinc-200"
                            onClick={() => { setMode(RECOVER); setError(''); setPassword(''); }}>
                      Forgot password?
                    </button>
                  </>
                ) : (
                  <button type="button" className="underline hover:text-zinc-200"
                          onClick={() => { setMode(SIGN_IN); setError(''); setPassword(''); setRecoveryCode(''); }}>
                    Back to sign in
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-600">
                <span className="h-px flex-1 bg-zinc-800" />
                <span>or</span>
                <span className="h-px flex-1 bg-zinc-800" />
              </div>

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

          {busyProvider && !issued && (
            <div className="mt-4 space-y-2 text-center text-sm text-zinc-300" role="status">
              <p>Complete sign-in at {providerLabel(busyProvider)}, then return here.</p>
              <button type="button" className="text-zinc-300 underline" onClick={() => attempt.current?.abort()}>Cancel sign-in</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthGate;
