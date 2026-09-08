import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Check, ChevronDown, Clock, Cpu, Loader2, Play,
  ShieldAlert, X,
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * The Director: one project prompt, several models, one result.
 *
 * The question this panel exists to answer is "which model is doing what, and
 * why that one" — so every task shows its owner by name, and a task that ended
 * up somewhere other than first choice shows the reason it moved. A run that
 * looks like progress but cannot say who did the work is the thing worth
 * avoiding here.
 *
 * It also shows what was refused. A specialist that tries to write a file
 * belonging to another task has that write discarded, and that appears in the
 * run rather than only in a log — it is usually the most interesting thing
 * that happened.
 */

const call = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}/api/orchestrator${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
};

const ROLE_TONE = {
  ui: 'bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30',
  feature: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30',
  backend: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  review: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
};

/** Every state a task can be in, said in words rather than only in colour. */
const STATE_LABEL = {
  pending: 'Waiting on another task',
  ready: 'Ready to start',
  running: 'Working now',
  done: 'Finished',
  failed: 'Failed',
  blocked: 'Blocked by a failed task',
  cancelled: 'Cancelled',
};

const STATE_TONE = {
  pending: 'text-zinc-400',
  ready: 'text-sky-300',
  running: 'text-cyan-300',
  done: 'text-emerald-300',
  failed: 'text-rose-300',
  blocked: 'text-rose-300/70',
  cancelled: 'text-zinc-500',
};

const StateIcon = ({ state }) => {
  if (state === 'running') {
    return (
      <Loader2
        className="h-4 w-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }
  if (state === 'done') return <Check className="h-4 w-4" aria-hidden="true" />;
  if (state === 'failed' || state === 'blocked') {
    return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
  }
  if (state === 'cancelled') return <Ban className="h-4 w-4" aria-hidden="true" />;
  return <Clock className="h-4 w-4" aria-hidden="true" />;
};

/** One task, and the account of who did it. */
const TaskRow = ({ task }) => {
  const [open, setOpen] = useState(false);
  const tone = STATE_TONE[task.state] || 'text-zinc-400';

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        <span className={`flex items-center gap-2 ${tone}`}>
          <StateIcon state={task.state} />
        </span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            ROLE_TONE[task.role] || 'border-white/20 bg-white/10 text-zinc-300'
          }`}
        >
          {task.role}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{task.title}</span>
        {/* The answer to "which model is doing this". */}
        {task.owner && (
          <span className="hidden items-center gap-1 text-[11px] text-zinc-400 sm:flex">
            <Cpu className="h-3 w-3" aria-hidden="true" />
            {task.owner}
          </span>
        )}
        <span className={`text-[11px] ${tone}`}>{STATE_LABEL[task.state] || task.state}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/10 px-3 py-2.5 text-[12px] text-zinc-300">
          <p className="whitespace-pre-wrap text-zinc-400">{task.instruction}</p>

          <div>
            <span className="text-zinc-500">Files it alone may write: </span>
            {task.scopes.length ? (
              <code className="text-cyan-300">{task.scopes.join(', ')}</code>
            ) : (
              <span className="text-zinc-500">none — it reads and reports</span>
            )}
          </div>

          {task.depends_on.length > 0 && (
            <div>
              <span className="text-zinc-500">Waits for: </span>
              <code className="text-zinc-300">{task.depends_on.join(', ')}</code>
            </div>
          )}

          {task.acceptance.length > 0 && (
            <div>
              <span className="text-zinc-500">Checked against:</span>
              <ul className="ml-4 list-disc text-zinc-400">
                {task.acceptance.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          )}

          {/* Why this model and not the first one asked. */}
          {task.fallback_reason && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
              {task.fallback_reason}
            </p>
          )}

          {task.error && (
            <p className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200">
              {task.error}
            </p>
          )}

          {task.output && <p className="whitespace-pre-wrap text-zinc-300">{task.output}</p>}

          <p className="text-[11px] text-zinc-500">
            {task.attempts > 1 && `${task.attempts} attempts · `}
            {task.duration != null && `${task.duration}s`}
          </p>
        </div>
      )}
    </li>
  );
};

const DirectorPanel = ({ isOpen, onClose }) => {
  const [request, setRequest] = useState('');
  const [root, setRoot] = useState('');
  const [models, setModels] = useState({ local: [], note: '' });
  const [chosen, setChosen] = useState([]);
  const [allowPaid, setAllowPaid] = useState(false);
  const [applyChanges, setApplyChanges] = useState(false);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const closeButton = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    closeButton.current?.focus();
    call('/models')
      .then((data) => {
        setModels(data);
        setChosen(data.local.slice(0, 1).map((m) => m.model));
      })
      .catch((e) => setError(e.message));
    return undefined;
  }, [isOpen]);

  // Escape closes, which is the one shortcut a panel like this must have.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const poll = useCallback(async (id) => {
    try {
      const snapshot = await call(`/runs/${id}`);
      setRun(snapshot);
      if (!['done', 'failed', 'cancelled'].includes(snapshot.state)) {
        timer.current = setTimeout(() => poll(id), 900);
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const start = async () => {
    setBusy(true);
    setError('');
    setRun(null);
    try {
      const snapshot = await call('/runs', {
        method: 'POST',
        body: JSON.stringify({
          request,
          root,
          models: chosen.map((model) => ({ provider: '', model })),
          allow_paid: allowPaid,
          apply_changes: applyChanges,
        }),
      });
      setRun(snapshot);
      poll(snapshot.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    try {
      await call(`/runs/${run.id}/cancel`, { method: 'POST' });
    } catch (e) {
      setError(e.message);
    }
  };

  const tasks = run?.graph?.tasks || [];
  const running = run && !['done', 'failed', 'cancelled'].includes(run.state);
  const refused = useMemo(
    () => (run?.events || []).filter((e) => e.kind === 'out-of-scope'),
    [run],
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Director"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-zinc-100">
            Director — one prompt, several models
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close the Director"
            className="rounded p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}

          {!run && (
            <>
              <div>
                <label htmlFor="director-request" className="mb-1 block text-xs font-medium text-zinc-400">
                  What should the team build?
                </label>
                <textarea
                  id="director-request"
                  rows={5}
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="Build a small static video gallery with a dark theme…"
                  className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400/60 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="director-root" className="mb-1 block text-xs font-medium text-zinc-400">
                  Project folder — every file is written here
                </label>
                {/* The placeholder is written in braces because text in a JSX
                    attribute is literal: "C:\\Users" would show both slashes. */}
                <input
                  id="director-root"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                  placeholder={'C:\\Users\\you\\projects\\gallery'}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-400/60 focus:outline-none"
                />
              </div>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-zinc-400">Models</legend>
                {models.local.length === 0 ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    {models.note}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {models.local.map((model) => (
                      <li key={model.model}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-zinc-200 hover:bg-white/5">
                          <input
                            type="checkbox"
                            checked={chosen.includes(model.model)}
                            onChange={(e) => setChosen((list) => (
                              e.target.checked
                                ? [...list, model.model]
                                : list.filter((m) => m !== model.model)
                            ))}
                            className="h-4 w-4 accent-cyan-400"
                          />
                          <span className="font-mono text-xs">{model.model}</span>
                          {model.parameters && (
                            <span className="text-[11px] text-zinc-500">{model.parameters}</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
                  <input
                    type="checkbox"
                    checked={applyChanges}
                    onChange={(e) => setApplyChanges(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-cyan-400"
                  />
                  <span>
                    Write the files
                    <span className="block text-[11px] text-zinc-500">
                      Left off, every change is staged as a diff you can read first.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
                  <input
                    type="checkbox"
                    checked={allowPaid}
                    onChange={(e) => setAllowPaid(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-amber-400"
                  />
                  <span>
                    Allow metered providers
                    <span className="block text-[11px] text-zinc-500">
                      Off by default. Nothing paid is used unless you say so here.
                    </span>
                  </span>
                </label>
              </div>

              <button
                type="button"
                onClick={start}
                disabled={busy || !request.trim() || !root.trim() || chosen.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Starting…' : 'Start the run'}
              </button>
            </>
          )}

          {run && (
            <>
              {/* Announced, so the state of a long run reaches a screen reader. */}
              <p role="status" aria-live="polite" className="text-sm text-zinc-300">
                {running ? 'Working…' : `Run ${run.state}.`}
                {run.error && <span className="text-rose-300"> {run.error}</span>}
              </p>

              {tasks.length > 0 && (
                <ul className="space-y-1.5">
                  {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
                </ul>
              )}

              {refused.length > 0 && (
                <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    Writes refused — a task tried to change a file it does not own
                  </h3>
                  <ul className="ml-4 list-disc text-[12px] text-amber-100/90">
                    {refused.map((event, i) => <li key={i}>{event.message}</li>)}
                  </ul>
                </section>
              )}

              {run.review && (
                <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <h3 className="mb-1 text-xs font-semibold text-zinc-200">
                    Review — {run.review.verdict}
                    {run.review.owner && (
                      <span className="ml-1 font-normal text-zinc-500">by {run.review.owner}</span>
                    )}
                  </h3>
                  {run.review.summary && (
                    <p className="text-[12px] text-zinc-300">{run.review.summary}</p>
                  )}
                  {run.review.problems?.length > 0 && (
                    <ul className="ml-4 mt-1 list-disc text-[12px] text-amber-200">
                      {run.review.problems.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  )}
                </section>
              )}

              {run.changes?.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold text-zinc-300">
                    {run.applied ? 'Files written' : 'Staged for your review — nothing written yet'}
                  </h3>
                  <ul className="space-y-1">
                    {run.changes.map((change) => (
                      <li key={change.id} className="flex items-center gap-2 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px]">
                        <span className="flex-1 truncate text-zinc-200">{change.path}</span>
                        <span className="text-emerald-400">+{change.lines_added ?? 0}</span>
                        <span className="text-rose-400">−{change.lines_removed ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex gap-2">
                {running && (
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                  >
                    <Ban className="h-4 w-4" aria-hidden="true" />
                    Stop the run
                  </button>
                )}
                {!running && (
                  <button
                    type="button"
                    onClick={() => setRun(null)}
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    New run
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DirectorPanel;
