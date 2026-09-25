import React, { useState, useEffect } from 'react';
import { Shield, RotateCcw, Camera, RefreshCw } from 'lucide-react';
import { agentSettingsRequest } from '../utils/agentSettingsRequest';

const MODE_TEXT = {
  permissive: 'Commands run with a time limit and their output captured. They are not isolated from your files.',
  strict: 'Commands run with a restricted environment and PATH. This is not operating-system isolation.',
};

/** SMARAN Code's safety at a glance, and the runs that changed files - each one undoable. */
function AgentRuns() {
  const [runs, setRuns] = useState(null);
  const [safety, setSafety] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const [r, sf] = await Promise.all([
      agentSettingsRequest('/runs').catch(() => ({ runs: [] })),
      agentSettingsRequest('/safety').catch(() => null),
    ]);
    setRuns(r.runs || []);
    setSafety(sf?.preferences || null);
  };
  useEffect(() => { load(); }, []);

  const undo = async (run) => {
    if (!window.confirm(`Put back the ${run.files} file(s) this run changed in ${run.root}?`)) return;
    setBusy(run.run_id);
    setMessage('');
    try {
      const out = await agentSettingsRequest(`/runs/${run.run_id}/undo`, { method: 'POST' });
      setMessage(`Undone: ${out.restored.length} restored, ${out.removed.length} removed${out.errors.length ? `, ${out.errors.length} failed` : ''}.`);
      await load();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
      <h4 className="text-xs font-bold">SMARAN Code safety</h4>
      {safety && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Approval mode: <b className="text-zinc-800 dark:text-zinc-200">{{ manual: 'Manual', smart: 'Smart', off: 'Off' }[safety.approval_mode]}</b> (switch it with the Approval button in Code).
          Secrets hidden from the model: <b className="text-zinc-800 dark:text-zinc-200">{safety.redact_secrets ? 'yes' : 'no'}</b>.
          Wiping a drive, formatting, deleting system folders and shutting down are refused in every mode.
        </p>
      )}
      <h4 className="pt-1 text-xs font-bold">Recent runs that changed files</h4>
      {runs === null && <p className="text-[11px] text-zinc-500">Loading…</p>}
      {runs?.length === 0 && <p className="text-[11px] text-zinc-500">None yet. Each SMARAN Code run keeps the originals of the files it edits, so it can be undone here.</p>}
      {runs?.map((run) => (
        <div key={run.run_id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[11px]">
          <span className="min-w-0 truncate">
            {new Date(run.modified * 1000).toLocaleString()} · {run.files} file{run.files === 1 ? '' : 's'} · <span className="font-mono">{run.root}</span>
          </span>
          {run.undone ? <span className="shrink-0 font-bold text-emerald-500">Undone</span> : (
            <button type="button" disabled={busy === run.run_id} onClick={() => undo(run)}
                    className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 font-bold disabled:opacity-50">
              {busy === run.run_id ? 'Undoing…' : 'Undo'}
            </button>
          )}
        </div>
      ))}
      {message && <p className="text-[11px] text-indigo-500">{message}</p>}
    </div>
  );
}

export default function SandboxPreferences() {
  const [sandboxInfo, setSandboxInfo] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const fetchSandboxData = async () => {
    setLoading(true);
    try {
      const [info, data] = await Promise.all([
        agentSettingsRequest('/sandbox/status'),
        agentSettingsRequest('/sandbox/snapshots'),
      ]);
      setSandboxInfo(info);
      setSnapshots(data.snapshots || []);
    } catch (err) {
      setNotice(err.message);
      setSandboxInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSandboxData();
  }, []);

  const handleRestore = async (snapId) => {
    if (!confirm(`Restore workspace to snapshot ${snapId}? Any unsaved changes will be reverted.`)) return;
    setRestoreBusy(true);
    setNotice('');
    try {
      const data = await agentSettingsRequest('/sandbox/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: snapId, root: '' }),
      });
      if (data.success) {
        setNotice(`Successfully restored ${data.restored} files.`);
      } else {
        setNotice(`Restore completed with errors: ${data.error || data.errors?.join(', ') || 'Unknown error'}`);
      }
    } catch (err) {
      setNotice(String(err));
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-500" />
          Execution Controls & Checkpoints
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Command filters, execution timeouts, and saved-file restore. These controls do not provide OS-level filesystem or network isolation.
        </p>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-500">
          {notice}
        </div>
      )}

      <AgentRuns />

      {/* Sandbox Policy Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <span className="text-[11px] font-semibold text-zinc-500">Sandbox Mode</span>
          <p className="text-sm font-bold uppercase mt-1 text-indigo-500">
            {sandboxInfo?.mode || (loading ? 'Loading…' : 'Unavailable')}
          </p>
          {sandboxInfo?.mode && <p className="mt-1 text-[10px] leading-snug text-zinc-500">{MODE_TEXT[sandboxInfo.mode]}</p>}
        </div>
        <div className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <span className="text-[11px] font-semibold text-zinc-500">Execution Timeout</span>
          <p className="text-sm font-bold mt-1">
            {sandboxInfo ? `${sandboxInfo.timeout_seconds}s limit` : 'Unavailable'}
          </p>
        </div>
        <div className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <span className="text-[11px] font-semibold text-zinc-500">Snapshots Available</span>
          <p className="text-sm font-bold mt-1">
            {snapshots.length} checkpoints
          </p>
        </div>
      </div>

      {/* Snapshots list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-zinc-400" />
            Workspace Rollback Snapshots
          </span>
          <button
            onClick={fetchSandboxData}
            disabled={loading}
            aria-label="Refresh checkpoints"
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="p-4 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
            {loading ? 'Loading checkpoints…' : !sandboxInfo ? 'Checkpoint data is unavailable.' : 'No saved checkpoints. Snapshots preserve captured files; restoring does not remove newly created files.'}
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold">{snap.id}</span>
                    <span className="text-[10px] text-zinc-400">
                      {new Date(snap.created_at * 1000).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {snap.description || `${snap.file_count || Object.keys(snap.file_checksums || {}).length} files captured`}
                  </p>
                </div>
                <button
                  disabled={restoreBusy}
                  onClick={() => handleRestore(snap.id)}
                  className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-indigo-500"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
