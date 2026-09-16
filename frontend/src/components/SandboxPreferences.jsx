import React, { useState, useEffect } from 'react';
import { Shield, Lock, RotateCcw, Camera, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

export default function SandboxPreferences() {
  const [sandboxInfo, setSandboxInfo] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const fetchSandboxData = async () => {
    setLoading(true);
    try {
      const [stRes, snapRes] = await Promise.all([
        fetchWithAuth(`${API_BASE}/api/agent/sandbox/status`),
        fetchWithAuth(`${API_BASE}/api/agent/sandbox/snapshots`),
      ]);
      if (stRes.ok) setSandboxInfo(await stRes.json());
      if (snapRes.ok) {
        const d = await snapRes.json();
        setSnapshots(d.snapshots || []);
      }
    } catch (err) {
      console.error('Failed to get sandbox status:', err);
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
      const res = await fetchWithAuth(`${API_BASE}/api/agent/sandbox/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: snapId, root: '' }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(`Successfully restored ${data.restored} files.`);
      } else {
        setNotice(`Restore completed with errors: ${data.errors?.join(', ')}`);
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
          Sandboxed Execution & Checkpoints (NemoClaw Parity)
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Guards against harmful commands, enforces execution timeouts, and enables snapshot rollback.
        </p>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-500">
          {notice}
        </div>
      )}

      {/* Sandbox Policy Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <span className="text-[11px] font-semibold text-zinc-500">Sandbox Mode</span>
          <p className="text-sm font-bold uppercase mt-1 text-indigo-500">
            {sandboxInfo?.mode || 'Permissive'}
          </p>
        </div>
        <div className="p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <span className="text-[11px] font-semibold text-zinc-500">Execution Timeout</span>
          <p className="text-sm font-bold mt-1">
            {sandboxInfo?.timeout_seconds || 120}s limit
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
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="p-4 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
            No snapshots recorded yet. The agent creates automatic snapshots before large multi-step changes.
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
