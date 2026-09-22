import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, AlertCircle, Download, Sparkles, ChevronDown, RefreshCw } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * A screen for making pictures.
 *
 * The machinery already existed and had no front door: /api/image/* could
 * list models, start a job and report progress, but the only way to reach it
 * was to type "draw me a…" into chat and hope the intent was recognised. That
 * hides every choice the API takes - which model, what size, how many steps -
 * and gives no way to see what was made earlier in the session.
 *
 * Two things this screen refuses to do, because both would be lying:
 *
 * It does not offer a model the card cannot run. The API answers `runnable`
 * and a `reason` per model, read from the machine's own VRAM, and an
 * unrunnable model is shown disabled with that reason next to it rather than
 * left clickable to fail minutes later.
 *
 * It does not pretend to work with no engine behind it. A phone with no
 * paired computer has no backend at all, and says so plainly instead of
 * showing a prompt box that could never produce anything.
 */

const SIZES = [
  { label: 'Square', width: 1024, height: 1024, hint: '1:1' },
  { label: 'Portrait', width: 832, height: 1216, hint: '2:3' },
  { label: 'Landscape', width: 1216, height: 832, hint: '3:2' },
  { label: 'Wide', width: 1280, height: 720, hint: '16:9' },
];

/* Slow enough not to hammer a machine that is busy generating, fast enough
   that the progress line does not feel stuck. */
const POLL_MS = 1500;

const card = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60';
const field = 'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 '
  + 'px-3 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-indigo-500';

const ImageStudio = () => {
  const [catalogue, setCatalogue] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [model, setModel] = useState('');
  const [size, setSize] = useState(SIZES[0]);
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(7);
  const [seed, setSeed] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [gallery, setGallery] = useState([]);
  const polling = useRef(null);

  const loadModels = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/image/models`);
      if (!res.ok) throw new Error('The engine did not answer.');
      const data = await res.json();
      setCatalogue(data);
      // Default to the first model this machine can actually run, rather than
      // the first in the list - otherwise the form opens pre-set to something
      // that refuses.
      const usable = (data.models || []).find((m) => m.runnable) || (data.models || [])[0];
      if (usable) {
        setModel(usable.id);
        if (usable.default_size) {
          setSize({ label: 'Square', width: usable.default_size, height: usable.default_size, hint: '1:1' });
        }
      }
    } catch {
      setLoadError(API_BASE
        ? 'Could not reach the image engine. Is SMARAN.AI running on this machine?'
        : 'Making pictures needs the SMARAN.AI desktop app. This device has no engine to ask.');
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);
  useEffect(() => () => window.clearTimeout(polling.current), []);

  const chosen = (catalogue?.models || []).find((m) => m.id === model);

  const watch = useCallback((jobId) => {
    const tick = async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/image/job/${jobId}`);
        if (!res.ok) throw new Error('The job could not be read.');
        const record = await res.json();
        setJob(record);
        if (record.status === 'completed') {
          setGallery((all) => [{
            id: jobId,
            prompt: record.result?.prompt || prompt,
            width: record.result?.width,
            height: record.result?.height,
            seed: record.result?.seed,
            model: record.result?.model,
          }, ...all].slice(0, 24));
          return;
        }
        if (record.status === 'failed') {
          setError(record.error || 'The picture could not be made.');
          return;
        }
        polling.current = window.setTimeout(tick, POLL_MS);
      } catch (err) {
        setError(err.message);
      }
    };
    tick();
  }, [prompt]);

  const generate = async (event) => {
    event.preventDefault();
    if (!prompt.trim() || job?.status === 'running') return;
    setError('');
    setJob({ status: 'running', messages: ['Starting…'] });
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/image/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          width: size.width,
          height: size.height,
          steps: Number(steps),
          guidance_scale: Number(guidance),
          // An empty box means "pick one", not "use zero".
          seed: seed.trim() === '' ? null : Number(seed),
          negative_prompt: negative.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'The picture could not be started.');
      setJob({ status: 'running', messages: ['Queued…'], id: data.job_id });
      watch(data.job_id);
    } catch (err) {
      setJob(null);
      setError(err.message);
    }
  };

  const running = job?.status === 'running';
  const latest = job?.status === 'completed' ? job : null;
  const finishedId = latest ? (job.id || gallery[0]?.id) : null;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black text-zinc-900 dark:text-white">
            <ImageIcon className="h-5 w-5 text-indigo-500" /> Images
          </h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Pictures made on this machine. Nothing is sent to a service, and
            the model files stay on your disk once downloaded.
          </p>
        </div>

        {loadError && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-amber-700 dark:text-amber-300`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{loadError}</p>
              {API_BASE && (
                <button type="button" onClick={loadModels}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold underline">
                  <RefreshCw className="h-3 w-3" /> Try again
                </button>
              )}
            </div>
          </div>
        )}

        {catalogue && (
          <form onSubmit={generate} className={`${card} space-y-4 p-4 sm:p-5`}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the picture — what is in it, and how it should look."
              className={`${field} resize-y`}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value)} className={field}>
                  {(catalogue.models || []).map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.runnable}>
                      {m.display_name}{m.runnable ? '' : ' — cannot run here'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Shape</span>
                <select
                  value={size.label}
                  onChange={(e) => setSize(SIZES.find((s) => s.label === e.target.value) || SIZES[0])}
                  className={field}
                >
                  {SIZES.map((s) => (
                    <option key={s.label} value={s.label}>{s.label} · {s.width}×{s.height} ({s.hint})</option>
                  ))}
                </select>
              </label>
            </div>

            {/* The reason a model will not run, from the engine rather than
                guessed here: it knows the card and the weights. */}
            {chosen && !chosen.runnable && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
                {chosen.reason}
              </p>
            )}
            {chosen?.runnable && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {chosen.download_gb ? `About ${chosen.download_gb} GB downloads the first time it is used. ` : ''}
                {chosen.notes || ''}
              </p>
            )}

            <button type="button" onClick={() => setAdvanced((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
              <ChevronDown className={`h-3.5 w-3.5 transition ${advanced ? 'rotate-180' : ''}`} />
              Advanced
            </button>

            {advanced && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Avoid</span>
                  <input value={negative} onChange={(e) => setNegative(e.target.value)}
                         placeholder="Things that should not appear" className={field} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Steps · {steps}</span>
                  <input type="range" min="1" max="60" value={steps}
                         onChange={(e) => setSteps(e.target.value)} className="w-full accent-indigo-500" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    How closely to follow the words · {guidance}
                  </span>
                  <input type="range" min="0" max="20" step="0.5" value={guidance}
                         onChange={(e) => setGuidance(e.target.value)} className="w-full accent-indigo-500" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                    Seed — leave empty for a different picture each time
                  </span>
                  <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))}
                         inputMode="numeric" placeholder="Random" className={field} />
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={running || !prompt.trim() || !chosen?.runnable}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {running ? 'Making the picture…' : 'Make the picture'}
            </button>
          </form>
        )}

        {error && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-red-600 dark:text-red-400`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* The engine reports what it is doing - downloading weights, running
            steps - and a long wait with no explanation reads as a hang. */}
        {running && (
          <div className={`${card} p-4`}>
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
              Working
            </div>
            <ul className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {(job.messages || []).slice(-6).map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              The first run of a model downloads its weights, which can take a while.
            </p>
          </div>
        )}

        {finishedId && (
          <div className={`${card} overflow-hidden`}>
            <img
              src={`${API_BASE}/api/image/file/${finishedId}`}
              alt={prompt}
              className="w-full bg-zinc-100 object-contain dark:bg-zinc-950"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              {/* The seed is only shown when there is one. Asking for a random
                  picture leaves it unset, and "seed  ·" with a hole in it
                  reads as a value that failed to load. */}
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {[
                  `${latest.result?.width}×${latest.result?.height}`,
                  latest.result?.seed === null || latest.result?.seed === undefined
                    ? null : `seed ${latest.result.seed}`,
                  latest.result?.model,
                ].filter(Boolean).join(' · ')}
              </span>
              <a href={`${API_BASE}/api/image/file/${finishedId}`} download={`smaran-${finishedId}.png`}
                 className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
                <Download className="h-3.5 w-3.5" /> Save
              </a>
            </div>
          </div>
        )}

        {gallery.length > 1 && (
          <div>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Earlier in this session</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {gallery.slice(1).map((item) => (
                <a key={item.id} href={`${API_BASE}/api/image/file/${item.id}`} target="_blank" rel="noreferrer"
                   title={item.prompt} className="block overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <img src={`${API_BASE}/api/image/file/${item.id}`} alt={item.prompt}
                       className="aspect-square w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageStudio;
