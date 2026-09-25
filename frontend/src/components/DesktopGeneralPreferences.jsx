import React, { useEffect, useState } from 'react';
import { Laptop, Check } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';
import { comboFromEvent } from '../utils/shortcuts';

/**
 * Settings -> General (Desktop). Every switch is applied by the backend
 * (app/desktop_prefs.py) and this shows what is actually in effect. It used
 * to save a file nothing read - and showed a made-up version when offline.
 */

function Toggle({ on, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
            onClick={() => onChange(!on)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'} disabled:cursor-not-allowed disabled:opacity-40`}>
      <span className={`absolute top-1 block h-4 w-4 rounded-full bg-white transition-transform ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function Row({ title, children, note, control }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-zinc-200 py-4 dark:border-zinc-800/80">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{children}</p>
        {note && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">{note}</p>}
      </div>
      {control}
    </div>
  );
}

const DesktopGeneralPreferences = () => {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}/api/desktop/settings`)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.detail || `HTTP ${r.status}`)))))
      .then(setS)
      .catch((e) => setError(`Could not load: ${e.message}`));
  }, []);

  const update = async (change) => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/desktop/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setS(data);
      if (data.errors?.length) setError(data.errors.join(' '));
      else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } catch (e) {
      setError(`Not saved: ${e.message}`);
    }
  };

  if (!s) return <div className="text-sm text-zinc-500">{error || 'Loading…'}</div>;
  const sup = s.supports || {};
  const onlyInstalled = 'Works in the installed SMARAN.AI app.';

  return (
    <div className="max-w-2xl space-y-2 text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center justify-between pb-2">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-black"><Laptop className="h-5 w-5 text-indigo-500" /> General desktop settings</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Starting with the computer, the Quick Entry shortcut, and staying awake for scheduled jobs.</p>
        </div>
        {saved && <span className="flex items-center gap-1 text-xs font-bold text-emerald-500"><Check className="h-4 w-4" /> Saved</span>}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 py-3 dark:border-zinc-800/80">
        <span className="text-sm font-bold">Desktop app version</span>
        <span className="font-mono text-sm text-zinc-400">{s.version}</span>
      </div>

      <Row title="Run on startup" note={!sup.run_on_startup ? onlyInstalled : (s.run_on_startup && !s.startup_registered ? 'Saved, but the startup entry is missing - switch it off and on again.' : '')}
           control={<Toggle label="Run on startup" on={Boolean(s.run_on_startup)} disabled={!sup.run_on_startup} onChange={(v) => update({ run_on_startup: v })} />}>
        Start SMARAN automatically when you sign in to this computer.
      </Row>

      <Row title="Quick Entry keyboard shortcut"
           note={!sup.quick_entry ? (s.platform === 'win32' ? onlyInstalled : 'Available on Windows.') : s.quick_entry_error}
           control={(
             <input
               readOnly
               disabled={!sup.quick_entry && s.platform !== 'win32'}
               value={recording ? 'Press the keys…' : (s.quick_entry_shortcut || 'Off')}
               onFocus={() => setRecording(true)}
               onBlur={() => setRecording(false)}
               onKeyDown={(e) => {
                 if (e.key === 'Tab') return;
                 e.preventDefault();
                 if (e.key === 'Escape') { e.currentTarget.blur(); return; }
                 if (e.key === 'Backspace' || e.key === 'Delete') { update({ quick_entry_shortcut: '' }); e.currentTarget.blur(); return; }
                 const combo = comboFromEvent(e);
                 if (combo) { update({ quick_entry_shortcut: combo.replace(/ \+ /g, '+') }); e.currentTarget.blur(); }
               }}
               className="w-44 rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-center font-mono text-xs font-bold dark:border-zinc-700 dark:bg-zinc-900"
               title="Click, then press the new combination. Backspace turns it off."
             />
           )}>
        Brings SMARAN to the front from any app. Click the box and press a new combination; Backspace turns it off.
      </Row>

      <Row title="Keep computer awake" note={!sup.keep_awake ? 'Available on Windows.' : ''}
           control={<Toggle label="Keep computer awake" on={Boolean(s.keep_awake)} disabled={!sup.keep_awake} onChange={(v) => update({ keep_awake: v })} />}>
        Stop this computer idle-sleeping while SMARAN is open, so scheduled jobs run on time. The screen can still turn off,
        and closing a laptop lid still puts it to sleep.
      </Row>

      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
};

export default DesktopGeneralPreferences;
