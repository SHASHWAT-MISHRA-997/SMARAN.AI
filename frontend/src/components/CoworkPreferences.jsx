import React, { useEffect, useState } from 'react';
import { Users, Check, FolderOpen, X, ShieldCheck } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * Settings -> Cowork. Every setting is enforced by the backend
 * (app/cowork_prefs.py). This tab used to save a file nothing read, and
 * shipped one developer's home folder as everybody's default.
 */

const BROWSER_NAMES = { default: 'System default', chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox', brave: 'Brave' };

function Row({ title, children, control }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-zinc-200 py-4 dark:border-zinc-800/80">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{children}</div>
      </div>
      {control}
    </div>
  );
}

const CoworkPreferences = () => {
  const [s, setS] = useState(null);
  const [newFolder, setNewFolder] = useState('');
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}/api/cowork/settings`)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.detail || `HTTP ${r.status}`)))))
      .then((d) => { setS(d); setPathDraft(d.cowork_files_path); })
      .catch((e) => setError(`Could not load: ${e.message}`));
  }, []);

  const update = async (change) => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/cowork/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setS(data);
      setPathDraft(data.cowork_files_path);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  if (!s) return <div className="text-sm text-zinc-500">{error || 'Loading…'}</div>;

  return (
    <div className="max-w-2xl space-y-1 text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-black"><Users className="h-5 w-5 text-indigo-500" /> Cowork</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Working with your phone, where SMARAN keeps what it makes, and which folders it may change without asking.</p>
        </div>
        {saved && <span className="flex items-center gap-1 text-xs font-bold text-emerald-500"><Check className="h-4 w-4" /> Saved</span>}
      </div>

      <Row title="Trusted devices only" control={<span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-500"><ShieldCheck className="h-3.5 w-3.5" /> Always on</span>}>
        Only devices you have paired by scanning the code on this screen can reach SMARAN from the network. This cannot be switched off.
      </Row>

      <Row title="Dispatch" control={(
        <button type="button" role="switch" aria-checked={s.dispatch_enabled} aria-label="Dispatch"
                onClick={() => update({ dispatch_enabled: !s.dispatch_enabled })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${s.dispatch_enabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
          <span className={`absolute top-1 block h-4 w-4 rounded-full bg-white transition-transform ${s.dispatch_enabled ? 'left-6' : 'left-1'}`} />
        </button>
      )}>
        Send prompts and notices between this computer and your paired phone, including scheduled job results. Off: nothing passes either way.
      </Row>

      <Row title="Cowork files" control={!editingPath && (
        <button type="button" onClick={() => setEditingPath(true)} className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
          <FolderOpen className="h-3.5 w-3.5" /> Change
        </button>
      )}>
        Every image and video SMARAN makes is also saved here, in Images and Videos, named after what you asked for:
        <span className="ml-1 font-mono text-indigo-500">{s.cowork_files_path}</span>
        {editingPath && (
          <div className="mt-2 flex gap-2">
            <input value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950" />
            <button type="button" onClick={async () => { if (await update({ cowork_files_path: pathDraft })) setEditingPath(false); }} className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white">Save</button>
            <button type="button" onClick={() => { setEditingPath(false); setPathDraft(s.cowork_files_path); }} className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">Cancel</button>
          </div>
        )}
      </Row>

      <Row title="Trusted folders">
        SMARAN may create, rename and move files inside these folders without asking. Deleting always asks.
        <div className="mt-2 space-y-1.5">
          {s.trusted_folders.map((f) => (
            <div key={f} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-800">
              <span className="truncate font-mono text-[11px]">{f}</span>
              <button type="button" aria-label={`Remove ${f}`} onClick={() => update({ trusted_folders: s.trusted_folders.filter((x) => x !== f) })} className="text-zinc-400 hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="C:\Users\you\Documents\Work"
                   className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950" />
            <button type="button" disabled={!newFolder.trim()}
                    onClick={async () => { if (await update({ trusted_folders: [...s.trusted_folders, newFolder.trim()] })) setNewFolder(''); }}
                    className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">Add</button>
          </div>
        </div>
      </Row>

      <Row title="Preferred browser" control={(
        <select value={s.preferred_browser} onChange={(e) => update({ preferred_browser: e.target.value })}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" aria-label="Preferred browser">
          {Object.entries(BROWSER_NAMES).map(([id, name]) => (
            <option key={id} value={id} disabled={s.browsers && !s.browsers[id]}>{name}{s.browsers && !s.browsers[id] ? ' (not installed)' : ''}</option>
          ))}
        </select>
      )}>
        Links SMARAN opens for you - "open YouTube", search results, websites - open in this browser.
      </Row>

      {error && <p className="pt-2 text-xs text-rose-500">{error}</p>}
    </div>
  );
};

export default CoworkPreferences;
