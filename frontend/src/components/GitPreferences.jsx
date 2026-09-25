import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * Settings -> SMARAN Code -> Git & Version Control.
 *
 * These used to be kept in the browser only, where the agent never saw them,
 * and "Enforced" was shown over rules nothing enforced. They are now stored
 * by the backend (/api/agent/git-preferences) and applied to every git and gh
 * command the coding agent runs - see backend/app/agent/git_policy.py.
 */
export default function GitPreferences() {
  const [prefs, setPrefs] = useState(null);
  const [prefixDraft, setPrefixDraft] = useState('');
  const [rules, setRules] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const timer = useRef(null);
  const typing = useRef(null);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}/api/agent/git-preferences`)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.detail || `HTTP ${r.status}`)))))
      .then((d) => { setPrefs(d.preferences); setPrefixDraft(d.preferences.branch_prefix); setRules(d.rules); })
      .catch((e) => setError(`Could not load: ${e.message}`));
  }, []);

  const save = async (update) => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/agent/git-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setPrefs(data.preferences);
      setRules(data.rules);
      setNotice('Saved - the coding agent follows this from its next command.');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setNotice(''), 2500);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!prefs) {
    return <section aria-label="Git preferences" className="text-sm text-ink-muted">{error || 'Loading…'}</section>;
  }

  return (
    <section className="space-y-6 text-ink" aria-label="Git preferences">
      <div>
        <h3 className="text-lg font-bold text-ink">Git & Version Control</h3>
        <p className="text-sm text-ink-muted">How the coding agent names branches, merges and opens pull requests. Applied to every git and gh command it runs.</p>
      </div>

      <div className="border-b border-line pb-4 space-y-2">
        <label htmlFor="sm-branch-prefix" className="text-xs font-bold text-ink block">Default Branch Prefix</label>
        <div className="flex gap-2 max-w-sm">
          <input
            id="sm-branch-prefix"
            type="text"
            value={prefixDraft}
            onChange={(e) => {
              const value = e.target.value;
              setPrefixDraft(value);
              // Saved once typing pauses, so nothing depends on leaving the field.
              window.clearTimeout(typing.current);
              typing.current = window.setTimeout(() => save({ branch_prefix: value }), 700);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="flex-1 rounded-xl border border-line bg-sunken px-3.5 py-2 text-xs font-mono text-ink outline-none focus:border-indigo-500"
            placeholder="e.g. feat/, fix/, smaran/ - empty for none"
          />
        </div>
        <p className="text-[11px] text-ink-faint">
          A branch the agent creates gets this in front: <code className="font-mono">git checkout -b login</code> becomes{' '}
          <code className="font-mono">git checkout -b {(prefs.branch_prefix || '')}{prefs.branch_prefix && !/[/-]$/.test(prefs.branch_prefix) ? '/' : ''}login</code>.
        </p>
      </div>

      <div className="border-b border-line pb-4 space-y-2">
        <label htmlFor="sm-merge-method" className="text-xs font-bold text-ink block">Preferred Merge Method</label>
        <select
          id="sm-merge-method"
          value={prefs.merge_method}
          onChange={(e) => save({ merge_method: e.target.value })}
          className="w-full max-w-sm rounded-xl border border-line bg-sunken p-2.5 text-xs text-ink outline-none focus:border-indigo-500"
        >
          <option value="squash">Squash and merge (single clean commit)</option>
          <option value="merge">Create a merge commit (preserve individual commits)</option>
          <option value="rebase">Rebase and merge (linear history without merge commit)</option>
        </select>
        <p className="text-[11px] text-ink-faint">Used for <code className="font-mono">git merge</code> and <code className="font-mono">gh pr merge</code>.</p>
      </div>

      <div className="border-b border-line pb-4">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-xs font-bold text-ink">Create Pull Requests as Drafts</div>
            <div className="text-[11px] text-ink-muted">Adds <code className="font-mono">--draft</code> to every <code className="font-mono">gh pr create</code>, so nothing is marked ready until you look at it.</div>
          </div>
          <input
            type="checkbox"
            checked={prefs.draft_prs}
            onChange={(e) => save({ draft_prs: e.target.checked })}
            className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-line bg-sunken p-4 space-y-2">
        <div className="text-xs font-bold text-ink flex items-center gap-2">
          <span>Safe Git</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400">Always on</span>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          The agent's git and shell commands are checked before they run. Refused, whatever it is asked: force-push
          (<code className="font-mono">--force</code>, <code className="font-mono">-f</code>, <code className="font-mono">--force-with-lease</code>, <code className="font-mono">+refspec</code>),
          deleting remote branches, <code className="font-mono">reset --hard</code>, <code className="font-mono">filter-branch</code> / <code className="font-mono">filter-repo</code>,
          expiring the reflog, and merging past branch protection.
        </p>
      </div>

      {rules && (
        <details className="text-[11px] text-ink-muted">
          <summary className="cursor-pointer font-bold">What the agent is told</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-sunken p-3 font-mono">{rules}</pre>
        </details>
      )}

      {notice && <p className="text-xs text-indigo-400">{notice}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </section>
  );
}
