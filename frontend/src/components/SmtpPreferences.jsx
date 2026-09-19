import React, { useCallback, useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * Where password-recovery emails are sent from.
 *
 * "Forgot password" generated a code and then had nowhere to send it, so the
 * screen said "SMTP is not configured or failed to connect. Please configure
 * free SMTP in .env." - an instruction that assumes a text editor and a file
 * on disk. On the Android build there is no .env to edit at all, which made
 * password recovery permanently unreachable there.
 *
 * The password is write-only across this boundary: the server never sends it
 * back, and an untouched field here means "keep what is saved" rather than
 * "clear it". That is why `password` starts as null instead of an empty
 * string - empty is a real instruction to remove it.
 */
const SmtpPreferences = () => {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({
    host: '', port: 587, user: '', from_address: '', from_name: '',
  });
  const [password, setPassword] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE || ''}/api/auth/smtp/config`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('unavailable');
      const data = await res.json();
      setConfig(data);
      setForm({
        host: data.host || '',
        port: data.port || 587,
        user: data.user || '',
        from_address: data.from_address || '',
        from_name: data.from_name || '',
      });
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth(`${API_BASE || ''}/api/auth/smtp/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, port: Number(form.port) || 587, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not save the mail server.');
      setConfig(data);
      setPassword(null);
      setMessage({ kind: 'ok', text: 'Saved. Password recovery can send codes now.' });
    } catch (err) {
      setMessage({ kind: 'err', text: err.message || 'Could not save the mail server.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-3 text-xs text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Checking email delivery…</span>
      </div>
    );
  }

  // Signed in locally with no backend reachable: nothing here can be saved,
  // and a form that silently fails is worse than no form.
  if (!config) return null;

  const field = (label, key, placeholder, type = 'text') => (
    <div className="min-w-0">
      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none focus:border-indigo-500"
      />
    </div>
  );

  return (
    <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-extrabold text-zinc-900 dark:text-white">
              Email delivery (SMTP)
            </span>
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
              Used only to send the 6-digit code for “Forgot password”.
            </span>
          </div>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
            config.configured
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
          }`}
        >
          {config.configured ? 'Ready' : 'Not set up'}
        </span>
      </div>

      {config.from_environment?.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Set by environment variables on this install and not editable here:{' '}
          <span className="font-semibold">{config.from_environment.join(', ')}</span>.
          Every other field below still applies.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('SMTP host', 'host', 'smtp.gmail.com')}
        {field('Port', 'port', '587', 'number')}
        {field('Username', 'user', 'you@gmail.com')}
        <div className="min-w-0">
          <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
            Password {config.has_password && password === null ? '(saved)' : ''}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password ?? ''}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={config.has_password ? '•••••••• (unchanged)' : 'App password'}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 pr-9 text-sm text-zinc-900 dark:text-white outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {field('From address', 'from_address', 'you@gmail.com')}
        {field('From name', 'from_name', 'SMARAN.AI Security')}
      </div>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        For Gmail use <span className="font-mono">smtp.gmail.com</span> port 587 with an
        app password, not your account password. Stored on this machine only.
      </p>

      {message && (
        <div
          className={`flex items-center gap-2 text-[11px] font-semibold ${
            message.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {message.kind === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          <span>{message.text}</span>
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-60"
      >
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        <span>{saving ? 'Saving…' : 'Save mail server'}</span>
      </button>
    </div>
  );
};

export default SmtpPreferences;
