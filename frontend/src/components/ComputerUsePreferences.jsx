import React, { useState, useEffect } from 'react';
import { API_BASE } from '../context/AuthContext';

export default function ComputerUsePreferences() {
  // Stored and enforced by the backend (app/control_prefs.py). These used to
  // be written to the browser's storage, where nothing ever read them.
  const [enabled, setEnabled] = useState(true);
  const [confirmDestructive, setConfirmDestructive] = useState(true);
  const [caps, setCaps] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [activeSessions, setActiveSessions] = useState(0);
  const [stopNotice, setStopNotice] = useState('');
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    // Check active control sessions
    fetch(`${API_BASE}/api/control/session`)
      .then(res => { if (!res.ok) throw new Error('Control status unavailable'); return res.json(); })
      .then(data => {
        if (data) {
          const count = Array.isArray(data.active) ? data.active.length : (typeof data.active === 'number' ? data.active : 0);
          setActiveSessions(count);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/control/preferences`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.preferences) return;
        setEnabled(d.preferences.computer_use_enabled);
        setConfirmDestructive(d.preferences.confirm_changes);
      }).catch(() => {});
    fetch(`${API_BASE}/api/control/capabilities`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null)).then(setCaps).catch(() => {});
  }, []);

  const savePrefs = async (update) => {
    setSaveError('');
    try {
      const res = await fetch(`${API_BASE}/api/control/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setEnabled(data.preferences.computer_use_enabled);
      setConfirmDestructive(data.preferences.confirm_changes);
    } catch (e) {
      setSaveError(`Not saved: ${e.message}`);
    }
  };

  const handleToggleEnabled = (val) => { setEnabled(val); savePrefs({ computer_use_enabled: val }); };
  const handleToggleConfirm = (val) => { setConfirmDestructive(val); savePrefs({ confirm_changes: val }); };

  const emergencyStop = async () => {
    setIsStopping(true);
    setStopNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/control/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Control stop failed (${res.status})`);
      const data = await res.json();
      const count = Array.isArray(data?.active) ? data.active.length : (typeof data?.active === 'number' ? data.active : 0);
      setActiveSessions(count);
      setStopNotice(`Stopped. Active sessions: ${count}.`);
    } catch {
      setStopNotice('Could not reach control session endpoint.');
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <section className="space-y-6 text-ink" aria-label="Computer use preferences">
      <div>
        <h3 className="text-lg font-bold text-ink">Computer Use & Desktop Control</h3>
        <p className="text-sm text-ink-muted">
          Manage natural-language desktop automation, mouse clicking, window control, and safety boundaries.
        </p>
      </div>

      {/* Main Enable Toggle */}
      <div className="border-b border-line pb-4">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-xs font-bold text-ink">Enable Autonomous Computer Use</div>
            <div className="text-[11px] text-ink-muted">
              Allow SMARAN to launch applications, open websites, navigate, click, and type upon voice or chat requests.
            </div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => handleToggleEnabled(e.target.checked)}
            className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
          />
        </label>
      </div>

      {/* Platform status: tested now, not a fixed "Verified". */}
      <div className="rounded-2xl border border-line bg-sunken p-4 space-y-2">
        <div className="text-xs font-bold text-ink flex items-center justify-between">
          <span>What works on this {caps?.platform || 'computer'}</span>
          {caps && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${caps.ready ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {caps.ready ? 'All checks passed' : 'Some checks failed'}
            </span>
          )}
        </div>
        {!caps && <p className="text-xs text-ink-muted">Checking…</p>}
        {caps?.checks.map((c) => (
          <p key={c.name} className="text-xs text-ink-muted">
            <span className={c.ok ? 'text-green-400' : 'text-amber-400'}>{c.ok ? '✓' : '✗'}</span> {c.name}{c.note ? ` - ${c.note}` : ''}
          </p>
        ))}
      </div>

      {/* Safety & Confirmation */}
      <div className="border-b border-line pb-4 space-y-3">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-xs font-bold text-ink">Require Confirmation for Destructive Actions</div>
            <div className="text-[11px] text-ink-muted">
              Ask before actions that change files, apps or settings. Sleep, restart, shut down and other high-risk actions always ask, even when this is off.
            </div>
          </div>
          <input
            type="checkbox"
            checked={confirmDestructive}
            onChange={e => handleToggleConfirm(e.target.checked)}
            className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
          />
        </label>
      </div>

      {saveError && <p className="text-xs text-rose-400">{saveError}</p>}

      {/* Active Session & Emergency Stop */}
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-ink">Emergency Control Stop</h4>
            <p className="text-[11px] text-ink-muted">
              Immediately halts any in-progress multi-step computer use tasks.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-ink-muted">
            {activeSessions} active {activeSessions === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={isStopping}
            onClick={emergencyStop}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-md transition disabled:opacity-50"
          >
            {isStopping ? 'Stopping…' : 'Stop All Computer Actions'}
          </button>
          {stopNotice && <span className="text-xs text-red-400">{stopNotice}</span>}
        </div>
      </div>
    </section>
  );
}
