import React, { useState } from 'react';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

// Where each model can be used from SMARAN, in plain words.
const WHERE = {
  smaran: 'In SMARAN on this PC',
  comfyui: 'ComfyUI on this PC',
  nvidia: 'NVIDIA cloud (free credits)',
  replicate: 'Replicate (paid)',
};

const FIT = {
  yes: ['Fits this PC', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'],
  no: ['Too big for this PC', 'bg-rose-500/15 text-rose-700 dark:text-rose-300'],
  'not now': ['Not right now', 'bg-amber-500/15 text-amber-700 dark:text-amber-300'],
  unknown: ['Size not published', 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300'],
};

// The open models worth knowing, with the memory each project itself states
// and whether this computer's graphics card has it. Loaded only when opened.
const ModelLibrary = ({ kind }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || data) return;
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/${kind}/catalog`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'The model library could not be loaded.');
      setData(body);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button type="button" onClick={toggle} aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
          Model library — open {kind === 'video' ? 'video' : 'image'} models and what this PC can run
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-zinc-200 p-3 text-[11px] dark:border-zinc-800">
          {error && <p className="text-rose-600 dark:text-rose-300">{error}</p>}
          {!data && !error && (
            <p className="flex items-center gap-2 text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking this PC…</p>
          )}
          {data && (
            <>
              <p className="text-zinc-600 dark:text-zinc-300">
                {data.hardware?.gpu}: {data.vram_gb} GB of graphics memory. {data.summary}
              </p>
              <ul className="space-y-2">
                {data.models.map((m) => {
                  const [fitLabel, fitClass] = FIT[m.fits] || FIT.unknown;
                  return (
                    <li key={m.id} className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900/60">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-zinc-800 dark:text-zinc-100">{m.name}</span>
                        <span className="text-zinc-500">{m.maker} · {m.params} · {m.license}</span>
                        <span className={`rounded-full px-2 py-0.5 font-bold ${fitClass}`} title={m.why}>{fitLabel}</span>
                      </div>
                      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{m.note} {m.why}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-zinc-500">
                        <span>Use it: {m.where.map((w) => WHERE[w] || w).join(' · ')}</span>
                        <a href={m.repo} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline dark:text-indigo-300">
                          Project <ExternalLink className="h-3 w-3" />
                        </a>
                        {m.weights && (
                          <a href={m.weights} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline dark:text-indigo-300">
                            Weights <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-400">Source: {m.source}</p>
                    </li>
                  );
                })}
              </ul>
              {data.closed?.length > 0 && (
                <div>
                  <p className="font-bold text-zinc-700 dark:text-zinc-200">Closed services (no downloadable weights)</p>
                  <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-400">
                    {data.closed.map((c) => (
                      <li key={c.name}>
                        {c.name} ({c.maker}) — {c.route === 'replicate' ? 'through Replicate on your key (paid)' : c.route}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.tools?.length > 0 && (
                <div>
                  <p className="font-bold text-zinc-700 dark:text-zinc-200">Tools that run these models</p>
                  <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-400">
                    {data.tools.map((t) => (
                      <li key={t.name}>
                        <a href={t.repo} target="_blank" rel="noopener noreferrer"
                           className="font-bold text-indigo-600 hover:underline dark:text-indigo-300">{t.name}</a> — {t.note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[10px] text-zinc-400">
                Memory figures are what each project publishes, checked {data.checked}. "Size not published" means the project gives no figure.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ModelLibrary;
