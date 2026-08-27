import React, { useCallback, useEffect, useState } from 'react';
import {
  Check, ChevronRight, Folder, FolderOpen, RefreshCw, X,
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * The open folder, and the changes waiting on it.
 *
 * Two jobs. Choosing a folder, which is a plain list of directories walked
 * from the home folder — not a native dialog, because the same app runs in a
 * browser tab and on a phone over the pairing link, and a native dialog would
 * work in the desktop window and nowhere else.
 *
 * And approving changes. Every proposed edit arrives as a unified diff and
 * sits here until it is approved or rejected; nothing on disk has moved by
 * the time you are reading it. That is the point of the whole feature, so the
 * diff is shown in full rather than summarised.
 */

const call = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}/api/workspace${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
};

/** One diff, coloured by line. */
const Diff = ({ text }) => (
  <pre className="max-h-72 overflow-auto rounded-lg bg-black/50 p-3 font-mono text-[11px] leading-relaxed">
    {text.split('\n').map((line, i) => {
      // Order matters: +++ and --- are file headers, not added or removed
      // lines, and colouring them green and red reads as a change to the
      // filename itself.
      let tone = 'text-zinc-400';
      if (line.startsWith('+++') || line.startsWith('---')) tone = 'text-zinc-500';
      else if (line.startsWith('@@')) tone = 'text-cyan-400';
      else if (line.startsWith('+')) tone = 'text-emerald-300 bg-emerald-500/10';
      else if (line.startsWith('-')) tone = 'text-rose-300 bg-rose-500/10';
      return <div key={i} className={`${tone} whitespace-pre-wrap break-all px-1`}>{line || ' '}</div>;
    })}
  </pre>
);

const WorkspacePanel = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState(null);
  const [browser, setBrowser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await call('/status'));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const browse = useCallback(async (path) => {
    setBusy(true);
    try {
      setBrowser(await call(`/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
  }, [isOpen, refresh]);

  // While changes are waiting, poll: a proposal can arrive from the model at
  // any moment and a panel that only updates on click would sit there stale.
  useEffect(() => {
    if (!isOpen || !status?.open) return undefined;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [isOpen, status?.open, refresh]);

  const act = async (path, body) => {
    setBusy(true);
    try {
      await call(path, { method: 'POST', body: JSON.stringify(body) });
      await refresh();
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const pending = status?.pending || [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-cyan-500/30 bg-zinc-950">

        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <FolderOpen className="h-4 w-4 shrink-0 text-cyan-400" />
            <div className="min-w-0">
              <h2 className="text-sm font-black text-white">Project folder</h2>
              <p className="truncate font-mono text-[10px] text-zinc-500">
                {status?.open ? status.root : 'Nothing open'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={refresh} title="Refresh"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} title="Close"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error && (
          <p className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-[11px] text-amber-300">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-5">

          {!status?.open ? (
            <div className="space-y-3">
              <p className="text-[11px] leading-5 text-zinc-400">
                Choose the folder to work in. Only files under it can be read or
                changed, and every change is shown here before it happens.
              </p>

              {!browser ? (
                <button type="button" onClick={() => browse()}
                  className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-200 hover:bg-cyan-500/20">
                  Choose a folder
                </button>
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
                    {browser.shortcuts.map((s) => (
                      <button key={s.path} type="button" onClick={() => browse(s.path)}
                        className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-white/10 hover:text-white">
                        {s.name}
                      </button>
                    ))}
                  </div>

                  <p className="truncate px-3 py-2 font-mono text-[10px] text-zinc-500">{browser.path}</p>

                  <div className="max-h-64 overflow-auto border-t border-zinc-800">
                    {browser.parent && (
                      <button type="button" onClick={() => browse(browser.parent)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/5">
                        <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Up one level
                      </button>
                    )}
                    {browser.folders.map((f) => (
                      <div key={f.path} className="flex items-center gap-1 border-t border-zinc-800/60">
                        <button type="button" onClick={() => browse(f.path)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5">
                          <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                          <span className="truncate">{f.name}</span>
                        </button>
                        <button type="button" onClick={() => act('/open', { folder: f.path })}
                          className="mr-2 shrink-0 rounded-md bg-cyan-500/15 px-2 py-1 text-[10px] font-black text-cyan-200 hover:bg-cyan-500/25">
                          Open
                        </button>
                      </div>
                    ))}
                    {!browser.folders.length && (
                      <p className="px-3 py-3 text-[11px] text-zinc-500">No sub-folders here.</p>
                    )}
                  </div>

                  <button type="button" onClick={() => act('/open', { folder: browser.path })}
                    className="w-full rounded-b-xl border-t border-zinc-800 bg-cyan-500/10 px-3 py-2.5 text-xs font-black text-cyan-200 hover:bg-cyan-500/20">
                    Open this folder
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-400">
                  {pending.length
                    ? `${pending.length} change${pending.length > 1 ? 's' : ''} waiting for you.`
                    : 'No changes waiting. Nothing has been written.'}
                </p>
                <button type="button" onClick={() => { act('/close', {}); setBrowser(null); }}
                  className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1 text-[10px] font-bold text-zinc-400 hover:text-white">
                  Close folder
                </button>
              </div>

              {pending.map((change) => (
                <article key={change.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] font-bold text-white">{change.path}</p>
                      <p className="text-[10px] text-zinc-500">
                        <span className="uppercase">{change.kind}</span>
                        {' · '}
                        <span className="text-emerald-400">+{change.lines_added}</span>
                        {' '}
                        <span className="text-rose-400">-{change.lines_removed}</span>
                        {change.summary ? ` · ${change.summary}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" disabled={busy}
                        onClick={() => act('/reject', { id: change.id })}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[10px] font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">
                        Reject
                      </button>
                      <button type="button" disabled={busy}
                        onClick={() => act('/apply', { id: change.id })}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[10px] font-black text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
                        <Check className="h-3 w-3" /> Approve
                      </button>
                    </div>
                  </div>
                  <div className="p-3"><Diff text={change.diff} /></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkspacePanel;
