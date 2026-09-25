import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * Settings -> SMARAN Code -> Safety: commands Smart mode may run without
 * asking, and whether secrets are masked before the model sees them. The
 * approval mode itself is switched from the Approval button in Code, so it
 * has one control, not two.
 */
export default function AgentSafetySettings() {
  const [prefs, setPrefs] = useState(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}/api/agent/safety`)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.detail || `HTTP ${r.status}`)))))
      .then((d) => { setPrefs(d.preferences); setDraft(d.preferences.allowlist.join('\n')); })
      .catch((e) => setError(`Could not load: ${e.message}`));
  }, []);

  const save = async (update) => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/agent/safety`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setPrefs(data.preferences);
      setNotice('Saved.');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setNotice(''), 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!prefs) return <section aria-label="SMARAN Code safety" className="text-sm text-ink-muted">{error || 'Loading…'}</section>;

  return (
    <section className="space-y-5 text-ink" aria-label="SMARAN Code safety">
      <div>
        <h3 className="text-lg font-bold text-ink">Safety</h3>
        <p className="text-sm text-ink-muted">
          Approval mode is <b className="text-ink">{{ manual: 'Manual', smart: 'Smart', off: 'Off' }[prefs.approval_mode]}</b> - switch it
          with the Approval button in Code. Manual asks before every change; Smart runs reading, file edits (each run can be undone)
          and known-safe commands such as tests and builds, and asks about the rest; Off asks about nothing. Commands that could
          wipe a drive, format a disk or shut the computer down are refused in every mode.
        </p>
      </div>

      <div className="space-y-2 border-b border-line pb-4">
        <label htmlFor="sm-allowlist" className="block text-xs font-bold text-ink">Commands Smart mode may run without asking</label>
        <textarea
          id="sm-allowlist"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'npm run dev\nmake test'}
          className="w-full max-w-lg rounded-xl border border-line bg-sunken px-3 py-2 font-mono text-xs text-ink outline-none focus:border-indigo-500"
        />
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => save({ allowlist: draft.split('\n') })}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">Save list</button>
          <span className="text-[11px] text-ink-faint">One per line. A command is allowed when it starts with one of these.</span>
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="text-xs font-bold text-ink">Hide secrets from the model</div>
          <div className="text-[11px] text-ink-muted">API keys, tokens, passwords and private keys found in files or command output are replaced with [REDACTED] before they are sent to the model - which matters most with cloud models.</div>
        </div>
        <input type="checkbox" checked={prefs.redact_secrets} onChange={(e) => save({ redact_secrets: e.target.checked })}
               className="h-4 w-4 cursor-pointer rounded accent-indigo-600" />
      </label>

      {notice && <p className="text-xs text-indigo-400">{notice}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </section>
  );
}
