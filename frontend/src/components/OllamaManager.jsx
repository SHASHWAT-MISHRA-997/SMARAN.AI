import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Trash2, RefreshCw, CheckCircle2, Search, Cpu, ChevronDown, ChevronUp, Cloud, ExternalLink, Play } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * Ollama without a terminal: what is on this PC (use, update, delete for
 * good) and everything ollama.com publishes (search, see which sizes fit this
 * machine, install). Installing and updating both go through onPull - one
 * download path for the whole hub - and progress is read from the same
 * /api/models/download-status the rest of the hub uses.
 *
 *   view: 'pc' | 'library'
 */

const gb = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB` : '');
const FIT = {
  fits: ['Fits your GPU', 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'],
  partial: ['Runs, slower (GPU + RAM)', 'text-amber-300 border-amber-500/40 bg-amber-500/10'],
  too_large: ['Too large for this PC', 'text-red-300 border-red-500/40 bg-red-500/10'],
  unknown: ['Size unknown', 'text-zinc-400 border-zinc-700 bg-zinc-800/60'],
};
const CAP = {
  tools: 'Tool Use', vision: 'Vision', thinking: 'Reasoning', embedding: 'Embeddings', cloud: 'Cloud', audio: 'Audio',
};

async function call(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function useDownloads(active) {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const tick = async () => {
      try {
        const data = await call('/api/models/download-status');
        if (live) setMap(data.downloads || {});
      } catch { /* keep the last answer */ }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { live = false; clearInterval(t); };
  }, [active]);
  return map;
}

function Progress({ state }) {
  if (!state) return null;
  if (state.status === 'error') return <p className="text-[11px] font-semibold text-rose-400">{state.error || 'Download failed'}</p>;
  if (state.status === 'complete') return <p className="text-[11px] font-semibold text-emerald-300">Installed</p>;
  const pct = state.percent || 0;
  return (
    <div className="w-full space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="text-[10px] text-zinc-400">{pct}%{state.total_gb ? ` of ${state.total_gb} GB` : ''}</p>
    </div>
  );
}

function OnThisPc({ onPull, pullNote, setModel, onClose, downloads, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try { setData(await call('/api/ollama/installed')); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  // A finished download or update shows up without a manual refresh.
  const done = Object.entries(downloads).filter(([, s]) => s.status === 'complete').map(([n]) => n).join(',');
  useEffect(() => { if (done) load(); }, [done, load]);

  const remove = async (name, size) => {
    if (!window.confirm(`Delete ${name} from this PC permanently?\n\nThis frees ${gb(size) || 'its space'}. You can download it again later.`)) return;
    setBusy(name);
    try {
      const r = await call(`/api/ollama/installed?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      setNote(`${r.deleted} deleted - ${gb(r.freed_bytes)} freed.`);
      await load();
    } catch (e) {
      setNote(`Could not delete ${name}: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  if (error) return <div className="p-6 text-sm text-amber-300">{error}</div>;
  if (!data) return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><RefreshCw className="h-4 w-4 animate-spin" /> Asking Ollama what is installed…</div>;

  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">
          <b className="text-white">{data.models.length}</b> model{data.models.length === 1 ? '' : 's'} installed · <b className="text-white">{gb(data.total_bytes) || '0 GB'}</b> on disk
          {data.memory?.vram_gb != null && <> · this PC: {data.memory.vram_gb} GB GPU, {Math.round(data.memory.ram_gb || 0)} GB RAM</>}
        </p>
        <button type="button" onClick={load} className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>
      {note && <p className={`text-[11px] font-semibold ${note.startsWith('Could not') ? 'text-rose-400' : 'text-emerald-300'}`}>{note}</p>}
      {pullNote && <p className={`text-[11px] font-semibold ${pullNote.startsWith('Could not') || pullNote.includes('failed') ? 'text-rose-400' : 'text-indigo-300'}`}>{pullNote.replace(/ is installed\.$/, ' is installed and up to date.')}</p>}
      {!data.models.length && <p className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-400">Nothing installed yet. Open <b>Ollama library</b> to pick a model that fits this PC.</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.models.map((m) => (
          <div key={m.name} className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-black text-white">{m.name}</p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {[m.params, m.family, m.quantization, m.format].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {m.remote ? <span className="flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"><Cloud className="h-3 w-3" /> Cloud</span>
                  : <span className="text-xs font-black text-zinc-200">{gb(m.size_bytes)}</span>}
                {m.loaded && <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">Loaded{m.vram_bytes ? ` · ${gb(m.vram_bytes)} on GPU` : ''}</span>}
              </div>
            </div>
            <Progress state={downloads[m.name]?.status && downloads[m.name].status !== 'complete' ? downloads[m.name] : null} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setModel?.(m.name); onClose?.(); }} className="flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-black text-emerald-300 hover:bg-emerald-500/25">
                <Play className="h-3.5 w-3.5" /> Use in chat
              </button>
              {!m.remote && (
                <button type="button" onClick={() => onPull(m.name)} title="Download only what changed since it was installed" className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white">
                  <RefreshCw className="h-3.5 w-3.5" /> Update
                </button>
              )}
              <button type="button" disabled={busy === m.name} onClick={() => remove(m.name, m.size_bytes)} className="ml-auto flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-600 hover:text-white disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {busy === m.name ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryRow({ model, onPull, downloads, installedNames }) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || tags) return;
    call(`/api/ollama/library/${encodeURIComponent(model.name)}/tags`).then((d) => setTags(d.tags), (e) => setError(e.message));
  }, [open, tags, model.name]);

  const best = [...model.approx].reverse().find((a) => a.fit === 'fits') || model.approx.find((a) => a.fit === 'partial');
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="font-mono text-sm font-black text-white">{model.name}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">{model.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {model.capabilities.map((c) => <span key={c} className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">{CAP[c] || c}</span>)}
            {model.approx.map((a) => (
              <span key={a.size} title={a.gb ? `about ${a.gb} GB` : ''} className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${FIT[a.fit]?.[1] || FIT.unknown[1]}`}>{a.size}</span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">
            {model.pulls && <>{model.pulls} pulls · </>}{model.tags != null && <>{model.tags} tags · </>}{model.updated && <>updated {model.updated}</>}
            {best && <> · <span className="text-emerald-400">best fit here: {best.size}</span></>}
          </p>
        </div>
        {open ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-zinc-400" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-zinc-400" />}
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          {error && <p className="text-[11px] text-amber-300">{error}</p>}
          {!tags && !error && <p className="flex items-center gap-2 text-[11px] text-zinc-500"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Reading exact download sizes…</p>}
          {tags?.map((t) => {
            const state = downloads[t.tag];
            const installed = installedNames.has(t.tag);
            const [label, style] = FIT[t.fit.status] || FIT.unknown;
            return (
              <div key={t.tag} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <span className="w-40 truncate font-mono text-xs text-white">{t.tag}</span>
                <span className="w-16 text-xs font-bold text-zinc-300">{gb(t.size_bytes)}</span>
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${style}`}>{label}</span>
                <div className="ml-auto flex min-w-[8rem] justify-end">
                  {state && state.status !== 'complete' && state.status !== 'error' ? <Progress state={state} />
                    : installed ? <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Installed</span>
                      : (
                        <button type="button" onClick={() => {
                          if (t.fit.status === 'too_large' && !window.confirm(`${t.tag} (${gb(t.size_bytes)}) is larger than this PC's memory and will probably not load. Download anyway?`)) return;
                          onPull(t.tag);
                        }}
                                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-indigo-500">
                          <Download className="h-3.5 w-3.5" /> Install
                        </button>
                      )}
                </div>
                {state?.status === 'error' && <p className="w-full text-[11px] text-rose-400">{state.error}</p>}
              </div>
            );
          })}
          <a href={`https://ollama.com/library/${model.name}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-white">All tags on ollama.com <ExternalLink className="h-3 w-3" /></a>
        </div>
      )}
    </div>
  );
}

function Library({ onPull, pullNote, downloads, installedNames }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [fitsOnly, setFitsOnly] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ q: query.trim(), sort });
        setData(await call(`/api/ollama/library?${q}`));
        setError('');
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    }, query ? 350 : 0);
    return () => window.clearTimeout(timer.current);
  }, [query, sort]);

  const shown = useMemo(() => {
    const list = data?.models || [];
    return fitsOnly ? list.filter((m) => m.approx.some((a) => a.fit === 'fits' || a.fit === 'partial') || !m.approx.length) : list;
  }, [data, fitsOnly]);

  const byName = query.trim();
  const looksLikeTag = /^[\w.-]+(\/[\w.-]+)?:[\w.-]+$/.test(byName) || /^hf\.co\/[\w.-]+\/[\w.-]+(:[\w.-]+)?$/.test(byName);

  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ollama.com - qwen3, coder, vision… or type an exact tag like glm4:9b"
                 className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-indigo-500" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white">
          <option value="popular">Most popular</option>
          <option value="newest">Newest</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={fitsOnly} onChange={(e) => setFitsOnly(e.target.checked)} /> <Cpu className="h-3.5 w-3.5" /> Runs on this PC
        </label>
      </div>
      {looksLikeTag && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
          <span className="text-xs text-indigo-200">Install <b className="font-mono">{byName}</b> exactly as typed</span>
          <button type="button" onClick={() => onPull(byName)} className="ml-auto flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-indigo-500"><Download className="h-3.5 w-3.5" /> Install</button>
        </div>
      )}
      {pullNote && <p className={`text-[11px] ${pullNote.startsWith('Could not') || pullNote.includes('failed') ? 'text-rose-400' : 'text-indigo-300'}`}>{pullNote}</p>}
      {data?.memory?.vram_gb != null && (
        <p className="text-[10px] text-zinc-500">Sizes are coloured for this PC ({data.memory.vram_gb} GB GPU, {Math.round(data.memory.ram_gb || 0)} GB RAM): green fits the GPU, amber runs using RAM too, red is too large. Open a model for exact download sizes.</p>
      )}
      {error && <p className="text-sm text-amber-300">{error}</p>}
      {loading && !data && <p className="flex items-center gap-2 text-sm text-zinc-500"><RefreshCw className="h-4 w-4 animate-spin" /> Reading ollama.com…</p>}
      {data && <p className="text-[11px] text-zinc-500">{shown.length} of {data.models.length} models{fitsOnly ? ' that run on this PC' : ''}</p>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {shown.map((m) => <LibraryRow key={m.name} model={m} onPull={onPull} downloads={downloads} installedNames={installedNames} />)}
      </div>
    </div>
  );
}

export default function OllamaManager({ view, onPull, pullNote, setModel, onClose }) {
  const downloads = useDownloads(true);
  const [installedNames, setInstalledNames] = useState(new Set());
  const done = Object.entries(downloads).filter(([, s]) => s.status === 'complete').map(([n]) => n).join(',');

  useEffect(() => {
    call('/api/ollama/installed').then((d) => setInstalledNames(new Set(d.models.map((m) => m.name))), () => {});
  }, [view, done]);

  return view === 'pc'
    ? <OnThisPc onPull={onPull} pullNote={pullNote} setModel={setModel} onClose={onClose} downloads={downloads} refreshKey={done} />
    : <Library onPull={onPull} pullNote={pullNote} downloads={downloads} installedNames={installedNames} />;
}
