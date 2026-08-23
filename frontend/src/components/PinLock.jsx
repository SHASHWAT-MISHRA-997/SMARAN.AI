import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Lock, ShieldCheck } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

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
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.detail || `Request failed (${response.status}).`);
  return payload;
};

const PinLock = ({ children }) => {
  const [state, setState] = useState('checking'); // checking | locked | open
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    request('/api/lock/status')
      .then((data) => {
        if (cancelled) return;
        setState(data.enabled ? 'locked' : 'open');
        if (data.locked_out_for) setCooldown(data.locked_out_for);
      })
      .catch(() => {
        // If the check itself cannot run, do not strand the user outside their
        // own app: a lock that fails open is better than one that never opens.
        if (!cancelled) setState('open');
      });
    return () => { cancelled = true; };
  }, []);

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

  if (state === 'checking') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07070b]">
        <Lock className="h-6 w-6 animate-pulse text-zinc-700" />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#07070b] px-6"
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
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 backdrop-blur-md">
            <Lock className="h-6 w-6 text-red-300" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-black tracking-wide text-white">SMARAN.AI is locked</h1>
            <p className="mt-1 text-[11px] text-zinc-500">Enter your PIN to continue.</p>
          </div>
        </div>

        {/* Filled dots rather than the digits themselves. */}
        <div className="flex items-center gap-2.5" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, index) => (
            <span
              key={index}
              className={`h-3 w-3 rounded-full border transition-all ${
                index < pin.length
                  ? 'border-red-400 bg-red-400 shadow-[0_0_10px_rgba(248,113,113,.7)]'
                  : 'border-zinc-700 bg-transparent'
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
                className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[.04] text-lg font-black text-zinc-100 backdrop-blur-md transition-all hover:border-red-400/40 hover:bg-red-500/10 active:scale-95 disabled:opacity-30"
              >
                {key === 'del' ? <Delete className="h-5 w-5 text-zinc-400" /> : key}
              </button>
            )
          ))}
        </div>

        <button
          type="button"
          onClick={() => submit(pin)}
          disabled={pin.length < 4 || busy || Boolean(cooldown)}
          className="w-full rounded-2xl border border-red-400/35 bg-red-500/15 px-6 py-3 text-xs font-black text-red-100 transition hover:bg-red-500/25 disabled:opacity-35"
        >
          {busy ? 'Checking…' : cooldown ? `Locked for ${cooldown}s` : 'Unlock'}
        </button>

        {error && (
          <p className="max-w-xs text-center text-[11px] leading-5 text-amber-300">{error}</p>
        )}

        <p className="flex items-center gap-1.5 text-[10px] text-zinc-600">
          <ShieldCheck className="h-3 w-3" />
          The PIN is stored only as a hash on this machine.
        </p>
      </div>
    </div>
  );
};

export default PinLock;
