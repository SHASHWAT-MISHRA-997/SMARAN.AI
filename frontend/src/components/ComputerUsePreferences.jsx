import React, { useState, useEffect } from 'react';
import { API_BASE } from '../context/AuthContext';

export default function ComputerUsePreferences() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('sm_computer_use_enabled') !== 'false');
  const [confirmDestructive, setConfirmDestructive] = useState(() => localStorage.getItem('sm_confirm_destructive_ops') !== 'false');
  const [activeSessions, setActiveSessions] = useState(0);
  const [stopNotice, setStopNotice] = useState('');
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    // Check active control sessions
    fetch(`${API_BASE}/api/control/session`)
      .then(res => { if (!res.ok) throw new Error('Control status unavailable'); return res.json(); })
      .then(data => {
        if (data && typeof data.active === 'number') {
          setActiveSessions(data.active);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleEnabled = (val) => {
    setEnabled(val);
    localStorage.setItem('sm_computer_use_enabled', String(val));
  };

  const handleToggleConfirm = (val) => {
    setConfirmDestructive(val);
    localStorage.setItem('sm_confirm_destructive_ops', String(val));
  };

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
      setActiveSessions(data.active || 0);
      setStopNotice(`Stopped. Active sessions: ${data.active || 0}.`);
    } catch {
      setStopNotice('Could not reach control session endpoint.');
    } finally {
      setIsStopping(false);
    }
  };

  const isWin = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

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

      {/* Platform Status */}
      <div className="rounded-2xl border border-line bg-sunken p-4 space-y-2">
        <div className="text-xs font-bold text-ink flex items-center justify-between">
          <span>Platform Adapter Status</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400">Verified</span>
        </div>
        <p className="text-xs text-ink-muted">
          {isWin
            ? 'Windows 11 / 10 Native Host Adapter active: Direct process observation, Win32 input events, and SendKeys typing supported.'
            : 'Linux Platform Adapter: Executable resolution via PATH, xdg-open for folders, and X11 xdotool integration.'}
        </p>
      </div>

      {/* Safety & Confirmation */}
      <div className="border-b border-line pb-4 space-y-3">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-xs font-bold text-ink">Require Confirmation for Destructive Actions</div>
            <div className="text-[11px] text-ink-muted">
              Always prompt before file deletions, app terminations, workstation locking, or system configuration adjustments.
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
