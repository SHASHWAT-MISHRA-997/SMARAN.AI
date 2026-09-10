import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { isNativeApp, loadLink } from '../utils/hostLink';

/**
 * The launch screen lock.
 *
 * Behaves like a phone: the workspace is not rendered at all until the PIN is
 * accepted, so nothing behind it is briefly visible. The PIN itself never
 * leaves as plaintext beyond the local request, and the backend rate-limits
 * guesses — a four-digit code would otherwise fall in seconds.
 *
 * When no PIN is configured the gate is transparent and renders its children
 * immediately.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(10000),
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.detail || `Request failed (${response.status}).`);
  return payload;
};

const PinLock = ({ children }) => {
  const [state, setState] = useState('checking'); // checking | unavailable | locked | open
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /* Forgetting the PIN used to mean the app was shut for good. Recovery asks
     for the account password rather than an email link: it proves the owner
     is the one asking without involving anybody else, and it works offline. */
  const [recovering, setRecovering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [recoverError, setRecoverError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    // An unpaired phone has no lock endpoint. A desktop with an unreachable
    // endpoint must keep its private workspace hidden until the check succeeds.
    if (isNativeApp() && !loadLink()?.url && !API_BASE) {
      setState('open');
      return undefined;
    }
    setState('checking');
    request('/api/lock/status')
      .then((data) => {
        if (cancelled) return;
        if (typeof data.enabled !== 'boolean') throw new Error('Invalid lock status.');
        setLockEnabled(data.enabled);
        setState(data.enabled ? 'locked' : 'open');
        if (data.locked_out_for) setCooldown(data.locked_out_for);
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => { cancelled = true; };
  }, [checkAttempt]);

  /* Locking itself again after a while, the way a phone does.

     The lock only ran at startup, so once opened it stayed open until the app
     was restarted - which is no protection at all for someone who walks away
     from an unlocked machine. It now watches for activity and shuts after a
     quiet period.

     A PIN that is not set means there is nothing to shut, so the timer does
     not run at all rather than locking someone out of an app they never
     secured. */
  const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60];
  const [autoLockMinutes] = useState(() => {
    const saved = Number(localStorage.getItem('sm_autolock_minutes'));
    return AUTO_LOCK_CHOICES.includes(saved) ? saved : 5;
  });
  const [lockEnabled, setLockEnabled] = useState(false);

  useEffect(() => {
    localStorage.setItem('sm_autolock_minutes', String(autoLockMinutes));
  }, [autoLockMinutes]);

  useEffect(() => {
    if (state !== 'open' || !lockEnabled || !autoLockMinutes) return undefined;

    let timer;
    const lockNow = () => {
      setPin('');
      setError('');
      setState('locked');
    };
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lockNow, autoLockMinutes * 60 * 1000);
    };

    // Typing counts as much as moving; a long reply being read is not idleness,
    // but a keyboard that has not been touched for minutes is.
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((name) => window.addEventListener(name, restart, { passive: true }));

    // Hiding the window is a stronger signal than silence: a phone locks when
    // it goes in a pocket rather than waiting out the timer.
    const onHidden = () => { if (document.hidden) lockNow(); };
    document.addEventListener('visibilitychange', onHidden);

    restart();
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, restart));
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [state, lockEnabled, autoLockMinutes]);

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (state === 'locked') inputRef.current?.focus();
  }, [state]);

  const submit = useCallback(async (value) => {
    if (busy || cooldown) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/lock/verify', {
        method: 'POST',
        body: JSON.stringify({ pin: value }),
      });
      setLockEnabled(true);
      setState('open');
    } catch (err) {
      setError(err.message);
      setPin('');
      const wait = /in (\d+) seconds/.exec(err.message);
      if (wait) setCooldown(Number(wait[1]));
    } finally {
      setBusy(false);
    }
  }, [busy, cooldown]);

  const recover = async (event) => {
    event.preventDefault();
    setBusy(true);
    setRecoverError('');
    try {
      await request('/api/lock/reset', {
        method: 'POST',
        body: JSON.stringify({ email, password, new_pin: newPin }),
      });
      // Straight in, rather than making someone type the PIN they just chose.
      setLockEnabled(true);
      setState('open');
    } catch (err) {
      setRecoverError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const press = (key) => {
    if (key === 'del') {
      setPin((value) => value.slice(0, -1));
      return;
    }
    if (!key) return;
    setPin((value) => {
      const next = (value + key).slice(0, 12);
      return next;
    });
  };

  // Physical keyboard, because most people will just type.
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && pin.length >= 4) submit(pin);
    else if (event.key === 'Backspace') { event.preventDefault(); press('del'); }
    else if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
  };

  if (state === 'open') return children;

  if (state === 'unavailable') {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white" role="alert">
        <Lock className="h-8 w-8 text-zinc-500" aria-hidden="true" />
        <p className="text-sm font-semibold">Cannot check the app lock. Reconnect to the local engine and retry.</p>
        <button className="rounded-xl bg-indigo-600 px-5 py-2 text-white font-bold text-xs hover:bg-indigo-500 cursor-pointer" onClick={() => setCheckAttempt((value) => value + 1)}>Retry lock check</button>
      </div>
    );
  }

  if (state === 'checking') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white dark:bg-zinc-950">
        <Lock className="h-7 w-7 animate-pulse text-zinc-400 dark:text-zinc-600" />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface px-6"
      onKeyDown={onKeyDown}
      tabIndex={-1}
      ref={inputRef}
    >
      {/* A quiet red bloom, matching the rest of the app's identity. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(55% 45% at 50% 38%, rgba(239,68,68,.10), transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl border-2 border-red-500/30 bg-red-500/10 dark:bg-red-500/20 p-3.5 shadow-md shadow-red-500/10 backdrop-blur-md">
            <Lock className="h-7 w-7 text-red-600 dark:text-red-400" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-black tracking-tight text-zinc-950 dark:text-white">SMARAN.AI is locked</h1>
            <p className="mt-1 text-xs font-bold text-zinc-600 dark:text-zinc-400">Enter your PIN to continue</p>
          </div>
        </div>

        {/* Filled dots with vivid highlight */}
        <div className="flex items-center gap-3 py-1" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, index) => (
            <span
              key={index}
              className={`h-4 w-4 rounded-full border-2 transition-all duration-200 ${
                index < pin.length
                  ? 'border-red-500 bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)] scale-110'
                  : 'border-zinc-400 dark:border-zinc-600 bg-zinc-200/80 dark:bg-zinc-800'
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key, index) => (
            key === '' ? <span key={index} /> : (
              <button
                key={index}
                type="button"
                onClick={() => press(key)}
                disabled={Boolean(cooldown)}
                className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white text-2xl font-black shadow-sm transition-all hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:shadow-md hover:shadow-red-500/15 active:scale-95 disabled:opacity-30 cursor-pointer select-none"
              >
                {key === 'del' ? <Delete className="h-6 w-6 text-zinc-800 dark:text-zinc-200" /> : key}
              </button>
            )
          ))}
        </div>

        <button
          type="button"
          onClick={() => submit(pin)}
          disabled={pin.length < 4 || busy || Boolean(cooldown)}
          className={`w-full rounded-2xl border-2 py-3.5 px-6 font-black text-sm transition-all select-none ${
            pin.length >= 4 && !busy && !cooldown
              ? 'border-red-600 bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 active:scale-[0.98] cursor-pointer'
              : 'border-zinc-300 dark:border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 cursor-not-allowed opacity-90'
          }`}
        >
          {busy ? 'Checking…' : cooldown ? `Locked for ${cooldown}s` : 'Unlock'}
        </button>

        {error && (
          <p className="max-w-xs text-center text-xs font-bold leading-5 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/20">{error}</p>
        )}

        <button
          type="button"
          onClick={() => { setRecovering(true); setRecoverError(''); }}
          className="text-xs font-bold text-zinc-600 dark:text-zinc-400 underline-offset-4 transition hover:text-red-600 dark:hover:text-red-400 hover:underline cursor-pointer"
        >
          Forgotten your PIN?
        </button>

        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          The PIN is stored only as a hash on this machine.
        </p>
      </div>

      {recovering && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-veil p-6 backdrop-blur-sm">
          <form
            onSubmit={recover}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl"
          >
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-sm font-black text-ink">Set a new PIN</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                Sign in with your account to choose a new one. Nobody else can do
                this for you, and nothing is sent anywhere.
              </p>
            </div>

            <div className="space-y-3 p-5">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-xl border border-line bg-sunken px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-red-400/60"
              />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Account password"
                autoComplete="current-password"
                className="w-full rounded-xl border border-line bg-sunken px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-red-400/60"
              />
              <input
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={12}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="New PIN (4 to 12 digits)"
                className="w-full rounded-xl border border-line bg-sunken px-3 py-2.5 text-center text-lg tracking-[0.4em] text-ink outline-none placeholder:text-sm placeholder:tracking-normal placeholder:text-ink-faint focus:border-red-400/60"
              />

              {recoverError && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  {recoverError}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || newPin.length < 4}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-black text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Set new PIN
              </button>

              <button
                type="button"
                onClick={() => setRecovering(false)}
                className="w-full rounded-xl border border-line py-2 text-[11px] font-bold text-ink-muted transition hover:bg-sunken hover:text-ink"
              >
                Back
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default PinLock;
