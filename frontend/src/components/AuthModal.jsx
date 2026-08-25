import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Eye, EyeOff, Fingerprint, Loader2,
  Lock, Mail, ShieldCheck, User, X,
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import CyberFX from './CyberFX';

/**
 * Sign in, or create an account.
 *
 * One panel for both, because they differ by a single field and a heading —
 * two separate screens made people bounce between them looking for the other.
 *
 * The password is sent once, over the local connection, and never kept by the
 * page: the backend answers with an http-only session cookie, and that cookie
 * is what carries the session from then on.
 */

const request = async (path, body) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail;
    throw new Error(
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? String(detail[0].msg).replace(/^Value error,\s*/, '')
          : `That did not work (${response.status}).`,
    );
  }
  return payload;
};

/* Google Identity Services, loaded once and only when it is actually needed. */
const loadGoogleScript = () => new Promise((resolve, reject) => {
  if (window.google?.accounts?.id) return resolve(window.google);
  const existing = document.getElementById('gsi-client');
  if (existing) {
    existing.addEventListener('load', () => resolve(window.google));
    existing.addEventListener('error', reject);
    return;
  }
  const script = document.createElement('script');
  script.id = 'gsi-client';
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => resolve(window.google);
  script.onerror = () => reject(new Error('Google could not be reached.'));
  document.head.appendChild(script);
});

/* A field with its own scan line and focus glow. */
const Field = ({ icon: Icon, children, ...props }) => (
  <div className="group relative">
    <div
      className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300
                 group-focus-within:opacity-100"
      style={{ background: 'linear-gradient(120deg, rgba(239,68,68,.55), rgba(255,120,80,.15), rgba(239,68,68,.55))' }}
      aria-hidden="true"
    />
    <div className="relative overflow-hidden rounded-xl">
      <Icon
        className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-zinc-500
                   transition-colors duration-300 group-focus-within:text-red-400"
      />
      <input
        {...props}
        className="peer relative w-full rounded-xl border border-zinc-700/80 bg-black/60 py-3 pl-11 pr-11
                   text-sm text-zinc-100 outline-none backdrop-blur-sm transition-all duration-300
                   placeholder:text-zinc-600 focus:border-transparent focus:bg-black/80"
      />
      <span className="auth-field-scan pointer-events-none absolute inset-x-0 bottom-0 h-px" aria-hidden="true" />
      {children}
    </div>
  </div>
);

const AuthModal = ({ isOpen, onClose, onSignedIn }) => {
  const [mode, setMode] = useState('signin'); // signin | register
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [google, setGoogle] = useState({ configured: false, clientId: null });
  const googleSlot = useRef(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [offerPin, setOfferPin] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');

  const registering = mode === 'register';

  const finish = useCallback(async (user) => {
    setDone(true);

    /* Offer the lock once, and only when there is not one already. It is
       optional on purpose: a lock screen that was never asked for is a
       nuisance, and this is a personal machine, not a shared terminal. */
    let alreadyLocked = true;
    try {
      const status = await fetch(`${API_BASE}/api/lock/status`, { credentials: 'include' })
        .then((r) => r.json());
      alreadyLocked = Boolean(status?.enabled);
    } catch {
      // If the check fails, say nothing rather than offering twice.
    }

    setTimeout(() => {
      onSignedIn?.(user);
      setDone(false);
      setPassword('');
      if (alreadyLocked) onClose?.();
      else setOfferPin(true);
    }, 900);
  }, [onClose, onSignedIn]);

  /* Only offer the Google button if this installation has a client id. An
     always-visible button that cannot work is worse than no button. */
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/auth/google/config`, { credentials: 'include' })
      .then((r) => r.json())
      .then((cfg) => {
        if (!cancelled && cfg?.configured && cfg.client_id) {
          setGoogle({ configured: true, clientId: cfg.client_id });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen]);

  /* Render Google's own button. The credential it hands back is verified by
     the backend against Google, so nothing here has to be trusted. */
  useEffect(() => {
    if (!isOpen || !google.configured || !googleSlot.current) return;
    let cancelled = false;

    loadGoogleScript()
      .then((gsi) => {
        if (cancelled || !googleSlot.current) return;
        gsi.accounts.id.initialize({
          client_id: google.clientId,
          callback: async ({ credential }) => {
            setBusy(true);
            setError('');
            try {
              const data = await request('/api/auth/google', { credential });
              finish(data.user);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          },
        });
        gsi.accounts.id.renderButton(googleSlot.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 320,
        });
        setGoogleReady(true);
      })
      .catch(() => setGoogleReady(false));

    return () => { cancelled = true; };
  }, [isOpen, google, finish]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  /* Live strength read-out. Mirrors the backend's only rule — six characters —
     and then rewards going further, rather than inventing rules it will not
     actually enforce. */
  const strength = useMemo(() => {
    if (!password) return null;
    let score = 0;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (new Set(password).size >= 8) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
    const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
    const colours = ['#f43f5e', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6'];
    return { score, label: labels[score], colour: colours[score], pct: (score / 5) * 100 };
  }, [password]);

  if (!isOpen) return null;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = registering
        ? await request('/api/auth/register', { email, password, username: username || undefined })
        : await request('/api/auth/login', { email, password, remember_me: true });
      finish(data.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const savePin = async (event) => {
    event.preventDefault();
    setPinBusy(true);
    setPinError('');
    try {
      const response = await fetch(`${API_BASE}/api/lock/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pin: pinValue }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'That PIN was not accepted.');
      }
      onClose?.();
      setOfferPin(false);
      setPinValue('');
    } catch (err) {
      setPinError(err.message);
    } finally {
      setPinBusy(false);
    }
  };

  if (offerPin) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
        <form
          onSubmit={savePin}
          className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        >
          <div className="border-b border-zinc-800 px-6 py-5">
            <h2 className="text-lg font-black text-white">Lock the app with a PIN?</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              Optional. It asks for a PIN when the app starts, so whoever walks
              past your desk cannot read your conversations. You can add or
              change it later in Settings, and reset it with your account
              password if you forget it.
            </p>
          </div>

          <div className="space-y-3 p-6">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={12}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
              placeholder="4 to 12 digits"
              className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-3 text-center text-xl
                         tracking-[0.4em] text-zinc-100 outline-none placeholder:text-sm
                         placeholder:tracking-normal placeholder:text-zinc-600 focus:border-red-400/60"
            />

            {pinError && (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                {pinError}
              </p>
            )}

            <button
              type="submit"
              disabled={pinBusy || pinValue.length < 4}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm
                         font-black text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {pinBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Set PIN
            </button>

            <button
              type="button"
              onClick={() => { setOfferPin(false); onClose?.(); }}
              className="w-full rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400
                         transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Not now
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/90 p-4 backdrop-blur-md">
      {/* Grid floor, drifting motes and a scan sweep behind the panel. */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <CyberFX intensity={0.55} active hue="red" />
      </div>

      <div className="auth-panel-in relative w-full max-w-md">
        {/* Rotating conic border — the panel's own light source. */}
        <div className="auth-halo pointer-events-none absolute -inset-[1.5px] rounded-[20px]" aria-hidden="true" />

        <div className="relative overflow-hidden rounded-[19px] border border-red-500/20 bg-zinc-950/85 shadow-[0_0_60px_rgba(239,68,68,.16)] backdrop-blur-2xl">
          {/* Corner brackets — the HUD framing used elsewhere in the app. */}
          {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2',
            'left-0 bottom-0 border-l-2 border-b-2', 'right-0 bottom-0 border-r-2 border-b-2'].map((corner) => (
            <span
              key={corner}
              className={`pointer-events-none absolute h-5 w-5 border-red-500/50 ${corner}`}
              style={{ borderRadius: 3 }}
              aria-hidden="true"
            />
          ))}
          <span className="auth-sweep pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden="true" />

          <div className="relative border-b border-red-500/15 px-6 py-5">
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(80% 120% at 50% 0%, rgba(239,68,68,.16), transparent 70%)' }}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-500 transition-all duration-300
                         hover:rotate-90 hover:bg-red-500/15 hover:text-red-300"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative flex items-center gap-3">
              <span className="auth-crest relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-500/40 bg-red-500/10">
                <Fingerprint className="h-5 w-5 text-red-400" />
              </span>
              <div>
                <h2 className="auth-title text-lg font-black tracking-tight text-white">
                  {registering ? 'Create your account' : 'Welcome back'}
                </h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-red-400/70">
                  <span className="auth-dot h-1.5 w-1.5 rounded-full bg-red-400" />
                  Secure channel
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="relative space-y-3.5 p-6">
            <Field
              icon={Mail}
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {registering && (
              <div className="auth-row-in">
                <Field
                  icon={User}
                  type="text"
                  autoComplete="nickname"
                  placeholder="Display name (optional)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}

            <Field
              icon={Lock}
              type={showPassword ? 'text' : 'password'}
              required
              minLength={12}
              autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            >
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded p-1 text-zinc-500
                           transition-colors duration-200 hover:text-red-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            {registering && strength && (
              <div className="auth-row-in space-y-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${strength.pct}%`,
                      background: strength.colour,
                      boxShadow: `0 0 10px ${strength.colour}`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-zinc-500">
                  <span style={{ color: strength.colour }} className="font-bold">{strength.label}</span>
                  {' · 12 characters minimum, and not one from a known breach'}
                </p>
              </div>
            )}

            {error && (
              <p className="auth-row-in flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || done}
              className="btn-lightning-hover sheen relative flex w-full items-center justify-center gap-2
                         overflow-hidden rounded-xl bg-gradient-to-r from-red-700 via-red-600 to-red-700 py-3
                         text-sm font-black text-white transition-all duration-300
                         hover:shadow-[0_0_34px_rgba(239,68,68,.55)] disabled:opacity-60"
            >
              {done ? (
                <><CheckCircle2 className="h-4 w-4" /> Signed in</>
              ) : busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Working…</>
              ) : (
                registering ? 'Create account' : 'Sign in'
              )}
            </button>

            {/* Shown either way. Hiding it entirely made people think Google
                sign-in did not exist; saying what is missing is more use than
                silence, and the instruction is short. */}
            <div className="flex items-center gap-3 py-0.5">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-red-500/30" />
              <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-600">or</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-red-500/30" />
            </div>

            {!google.configured && (
              <div className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                <p className="flex items-center gap-2 text-xs font-bold text-zinc-300">
                  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
                    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z" />
                    <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z" />
                    <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
                  </svg>
                  Continue with Google
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                  Needs a Google OAuth client id, which is free to create. Add it
                  as <code className="rounded bg-zinc-900 px-1 text-[9px] text-zinc-400">SMARAN_GOOGLE_CLIENT_ID</code> and
                  this becomes a working button.
                </p>
              </div>
            )}

            {google.configured && (
              /* Hidden until Google's script has actually drawn its button,
                 so a blocked or offline load leaves a gap rather than a
                 labelled empty box. */
              <div className={googleReady ? '' : 'hidden'}>
                {/* Google renders its own button here — its branding rules
                    require the button be theirs, not a copy of it. */}
                <div ref={googleSlot} className="flex justify-center [color-scheme:dark]" />
              </div>
            )}

            <p className="pt-0.5 text-center text-[11px] text-zinc-500">
              {registering ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => { setMode(registering ? 'signin' : 'register'); setError(''); }}
                className="font-bold text-red-400 underline-offset-4 transition-colors hover:text-red-300 hover:underline"
              >
                {registering ? 'Sign in' : 'Create one'}
              </button>
            </p>

            <p className="flex items-center justify-center gap-1.5 text-[10px] text-zinc-600">
              <ShieldCheck className="h-3 w-3" />
              Your conversations and files stay on this machine.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
