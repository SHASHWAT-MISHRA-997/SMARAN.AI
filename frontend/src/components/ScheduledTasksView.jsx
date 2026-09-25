import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Play, Pause, Trash2, Plus, History, Loader2, Sparkles, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';
import { agentSettingsRequest } from '../utils/agentSettingsRequest';

/**
 * Scheduled jobs - the real scheduler.
 *
 * This page used to keep its tasks in the browser, showed invented history
 * ("Last run: Today, 09:00 AM") and never ran anything on a schedule; "Run"
 * only pasted the prompt into chat. Settings had a second, real scheduler.
 * Now there is one: this page, on /api/agent/scheduler, with ready-made
 * blueprints. Jobs run while SMARAN.AI is open on this computer.
 */

const CHANNELS = [
  ['ui', 'In the app (history below)'],
  ['phone', 'Notify my paired phone'],
  ['telegram', 'Telegram bot'],
  ['discord', 'Discord bot'],
  ['webhook', 'Webhook URL'],
];
const card = 'rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/60';
const field = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white';

const placeholders = (prompt) => [...new Set((prompt.match(/\{([a-z_]+)\}/gi) || []).map((p) => p.slice(1, -1)))];

export function fillPrompt(prompt, values) {
  return prompt.replace(/\{([a-z_]+)\}/gi, (m, key) => (values[key] || '').trim() || m);
}

function when(ts) {
  if (!ts) return '—';
  const diff = ts * 1000 - Date.now();
  const abs = Math.abs(diff);
  const text = abs < 3600e3 ? `${Math.max(1, Math.round(abs / 60e3))} min`
    : abs < 86400e3 ? `${Math.round(abs / 3600e3)} h` : `${Math.round(abs / 86400e3)} d`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function Editor({ draft, onClose, onSaved }) {
  const [form, setForm] = useState(draft);
  const [values, setValues] = useState({});
  const [useFolder, setUseFolder] = useState(false);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useMemo(() => placeholders(form.prompt), [form.prompt]);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}/api/workspace/status`).then((r) => (r.ok ? r.json() : null))
      .then((d) => setFolder(d?.open ? d.root : '')).catch(() => {});
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const missing = keys.filter((k) => !(values[k] || '').trim());

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await agentSettingsRequest('/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          schedule_expr: form.schedule.trim(),
          task_prompt: fillPrompt(form.prompt, values).trim(),
          target_channel: form.channel,
          target_recipient: (form.recipient || '').trim(),
          workspace_root: useFolder ? folder : '',
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={`${card} space-y-3 p-4 sm:p-5`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-white">{draft.name ? `New job: ${draft.name}` : 'New job'}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <input value={form.name} onChange={set('name')} placeholder="Name" required maxLength={80} className={field} />
      <div>
        <input value={form.schedule} onChange={set('schedule')} placeholder="daily at 08:00" required className={field} />
        <p className="mt-1 text-[11px] text-zinc-500">For example: <code>daily at 08:00</code>, <code>every monday at 09:00</code>, <code>weekdays at 18:30</code>, <code>every 2 hours</code>, or cron like <code>0 9 * * 1-5</code>.</p>
      </div>
      <textarea value={form.prompt} onChange={set('prompt')} rows={4} required placeholder="What should SMARAN do each time?" className={`${field} resize-y`} />
      {keys.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {keys.map((k) => (
            <label key={k} className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              {k.replace(/_/g, ' ')}
              <input value={values[k] || ''} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                     className={`${field} mt-1 normal-case tracking-normal`} placeholder={`Your ${k.replace(/_/g, ' ')}`} />
            </label>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={form.channel} onChange={set('channel')} className={field} aria-label="Delivery">
          {CHANNELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {['telegram', 'discord', 'webhook'].includes(form.channel) && (
          <input value={form.recipient || ''} onChange={set('recipient')} className={field}
                 placeholder={form.channel === 'webhook' ? 'https://…' : 'Chat or channel id (blank for the default)'} />
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" checked={useFolder} disabled={!folder} onChange={(e) => setUseFolder(e.target.checked)} />
        {folder ? <>Work in the open project folder <code className="font-mono">{folder}</code></> : 'Open a project folder in Code to let a job work on it. Without one, it gets a private folder of its own.'}
      </label>
      <p className="text-[11px] text-zinc-500">Jobs run unattended in Smart mode: reading, web search, edits in their folder and known-safe commands run; anything that would need your approval is skipped.</p>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <button type="submit" disabled={busy || missing.length > 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
        {missing.length ? `Fill in: ${missing.join(', ')}` : 'Schedule it'}
      </button>
    </form>
  );
}

function JobRow({ job, onChanged }) {
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const act = async (what, fn) => {
    setBusy(what);
    setError('');
    try { await fn(); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const loadHistory = async () => {
    if (history) { setHistory(null); return; }
    const data = await agentSettingsRequest(`/scheduler/jobs/${job.id}/history`).catch((e) => { setError(e.message); return null; });
    setHistory(data?.history || []);
  };
  const running = job.last_status === 'running';

  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-zinc-900 dark:text-white">{job.name}</p>
          <p className="text-xs text-zinc-500">
            {job.schedule_expr} · {job.enabled ? `next ${when(job.next_run_ts)}` : 'paused'} · to {CHANNELS.find(([id]) => id === job.target_channel)?.[1] || job.target_channel}
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{job.task_prompt}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold ${
          running ? 'bg-indigo-500/15 text-indigo-400' : job.last_status === 'success' ? 'bg-emerald-500/15 text-emerald-500'
            : job.last_status === 'error' ? 'bg-rose-500/15 text-rose-500' : 'bg-zinc-500/15 text-zinc-500'}`}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : job.last_status === 'success' ? <CheckCircle2 className="h-3 w-3" /> : job.last_status === 'error' ? <AlertCircle className="h-3 w-3" /> : null}
          {running ? 'running' : job.last_status || 'not run yet'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!!busy || running} onClick={() => act('run', () => agentSettingsRequest(`/scheduler/jobs/${job.id}/run`, { method: 'POST' }))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
          <Play className="h-3.5 w-3.5" /> Run now
        </button>
        <button type="button" disabled={!!busy} onClick={() => act('toggle', () => agentSettingsRequest(`/scheduler/jobs/${job.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !job.enabled }) }))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
          {job.enabled ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
        </button>
        <button type="button" onClick={loadHistory} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
          <History className="h-3.5 w-3.5" /> {history ? 'Hide history' : 'History'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => window.confirm(`Delete "${job.name}"?`) && act('delete', () => agentSettingsRequest(`/scheduler/jobs/${job.id}`, { method: 'DELETE' }))}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-bold text-rose-500 hover:bg-rose-600 hover:text-white">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      {history && (
        <div className="mt-3 space-y-2">
          {history.length === 0 && <p className="text-xs text-zinc-500">No runs yet.</p>}
          {history.slice(0, 5).map((run, i) => (
            <div key={i} className="rounded-xl border border-zinc-200 p-2 text-xs dark:border-zinc-800">
              <p className="font-bold text-zinc-700 dark:text-zinc-300">
                {new Date((run.run_ts || run.timestamp || 0) * 1000).toLocaleString()} · {run.status} · {Math.round(run.duration_sec || 0)} s
              </p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{run.result}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScheduledTasksView() {
  const [jobs, setJobs] = useState(null);
  const [blueprints, setBlueprints] = useState([]);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await agentSettingsRequest('/scheduler/jobs');
      setJobs(data.jobs || []);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    agentSettingsRequest('/scheduler/blueprints').then((d) => setBlueprints(d.blueprints || [])).catch(() => {});
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const start = (bp) => setDraft(bp
    ? { name: bp.name, schedule: bp.schedule, prompt: bp.prompt, channel: bp.channel, recipient: '' }
    : { name: '', schedule: 'daily at 08:00', prompt: '', channel: 'ui', recipient: '' });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-zinc-900 dark:text-white"><CalendarClock className="h-5 w-5 text-indigo-500" /> Scheduled jobs</h1>
            <p className="text-xs text-zinc-500">SMARAN runs these on schedule while it is open on this computer, and delivers the result where you choose.</p>
          </div>
          <button type="button" onClick={() => start(null)} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-indigo-500">
            <Plus className="h-4 w-4" /> New job
          </button>
        </div>

        {draft && <Editor key={draft.name + draft.schedule} draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); load(); }} />}

        {error && <p className="text-sm text-rose-500">{error}</p>}
        {jobs === null && !error && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…</p>}
        {jobs?.length === 0 && <p className={`${card} p-6 text-center text-sm text-zinc-500`}>No scheduled jobs yet. Start from a blueprint below, or create your own.</p>}
        <div className="space-y-3">{jobs?.map((job) => <JobRow key={job.id} job={job} onChanged={load} />)}</div>

        {blueprints.length > 0 && (
          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500"><Sparkles className="h-3.5 w-3.5" /> Blueprints</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {blueprints.map((bp) => (
                <button key={bp.id} type="button" onClick={() => start(bp)}
                        className={`${card} p-3 text-left transition hover:border-indigo-500`}>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">{bp.name}</p>
                  <p className="text-[11px] text-zinc-500">{bp.schedule}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
