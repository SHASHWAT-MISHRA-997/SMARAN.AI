import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, Loader2, AlertCircle, Square, Play, Download } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/* Video on Replicate, with your own key: Kling, Hailuo, Seedance, Wan, LTX
   and whatever else Replicate hosts for text-to-video - listed live from
   Replicate, never guessed. Minutes instead of the long local render, billed
   to your Replicate account, and the prompt goes to Replicate. The finished
   file is saved on this computer (Replicate's own link expires in an hour). */

const card = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60';
const field = 'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none focus:border-indigo-500';
const POLL_MS = 2500;

const KINDS = {
  video: { base: '/api/video', file: '/api/video/file', ext: 'mp4', noun: 'video', names: 'Kling, Hailuo, Seedance, Wan, LTX',
           placeholder: 'Describe the clip: subject, action, camera, light. For example: a red kite over Jaipur at sunrise, slow drone shot.' },
  comfy: { base: '/api/image/comfy', jobs: '/api/image', file: '/api/image/file', ext: 'png', noun: 'image', names: 'your ComfyUI checkpoints',
           placeholder: 'Describe the picture. ComfyUI on this computer makes it with the checkpoint you choose - or with your own workflow below.' },
  image: { base: '/api/image', file: '/api/image/file', ext: 'png', noun: 'image', names: 'Flux, Stable Diffusion 3.5, Qwen-Image, Seedream, Ideogram',
           placeholder: 'Describe the picture: subject, style, light, framing. For example: a watercolour of a Varanasi ghat at dawn.' },
};

export default function CloudVideo({ onOpenModelHub, kind = 'video' }) {
  const K = KINDS[kind] || KINDS.video;
  const comfy = kind === 'comfy';
  const jobsBase = K.jobs || K.base;
  const [workflow, setWorkflow] = useState('');
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState('16:9');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    fetchWithAuth(`${API_BASE}${K.base}${comfy ? '' : '/cloud'}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { setInfo(comfy ? { ...data, configured: data.running } : data); setModel((m) => m || data.models?.[0]?.id || data.model || ''); })
      .catch(() => setLoadError('Could not reach SMARAN on this computer.'));
    return () => window.clearTimeout(timer.current);
  }, []);

  const watch = useCallback((id) => {
    const tick = async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}${jobsBase}/job/${id}`);
        const record = await res.json();
        setJob({ ...record, id });
        if (record.status === 'running') timer.current = window.setTimeout(tick, POLL_MS);
        else if (record.status !== 'completed') setError(record.error || `The ${K.noun} was not made.`);
      } catch (err) { setError(err.message); }
    };
    tick();
  }, []);

  const start = async (event) => {
    event?.preventDefault();
    if (!prompt.trim() || job?.status === 'running') return;
    setError('');
    setJob({ status: 'running', messages: ['Sending to Replicate…'] });
    try {
      const res = await fetchWithAuth(`${API_BASE}${K.base}${comfy ? '' : '/cloud'}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'video' ? { prompt: prompt.trim(), model, duration: Number(duration), aspect_ratio: aspect } : { prompt: prompt.trim(), model, aspect_ratio: aspect, ...(comfy ? { workflow } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `The ${K.noun} could not be started.`);
      watch(data.job_id);
    } catch (err) { setJob(null); setError(err.message); }
  };

  const stop = () => job?.id && kind !== 'image' && fetchWithAuth(`${API_BASE}${jobsBase}/job/${job.id}/stop`, { method: 'POST' }).catch(() => {});

  if (loadError) return <p className={`${card} p-4 text-sm text-amber-600`}>{loadError}</p>;
  if (!info) return <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking Replicate…</p>;

  if (comfy && !info.configured) {
    return (
      <div className={`${card} space-y-2 p-4 text-sm`}>
        <p className="font-bold text-zinc-900 dark:text-white">ComfyUI is not running on this computer</p>
        <p className="text-zinc-500">{info.error} SMARAN uses the ComfyUI you already have - its checkpoints (Flux, SD 3.5, SDXL...) and any workflow you export from it. Nothing leaves this computer.</p>
        <a href="https://github.com/comfyanonymous/ComfyUI" target="_blank" rel="noopener noreferrer" className="inline-block rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">Get ComfyUI</a>
      </div>
    );
  }

  if (!info.configured) {
    return (
      <div className={`${card} space-y-2 p-4 text-sm`}>
        <p className="font-bold text-zinc-900 dark:text-white">Cloud {K.noun}s need a Replicate key</p>
        <p className="text-zinc-500">One key reaches {K.names} and the other {K.noun} models Replicate hosts. It is billed to your Replicate account, and the prompt goes to Replicate.</p>
        <div className="flex flex-wrap gap-2">
          <a href={info.key_url} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">Get a key</a>
          {onOpenModelHub && <button type="button" onClick={onOpenModelHub} className="rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">Add it in Model Hub</button>}
        </div>
      </div>
    );
  }

  const running = job?.status === 'running';
  return (
    <div className="space-y-4">
      <form onSubmit={start} className={`${card} space-y-3 p-4 sm:p-5`}>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={2000} disabled={running}
                  placeholder={K.placeholder}
                  className={`${field} resize-y`} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-bold text-zinc-500 sm:col-span-3">Model
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running} className={`${field} mt-1 font-mono text-xs`}>
              {(info.models?.length ? info.models : [{ id: info.model, description: '' }]).map((m) => (
                <option key={m.id} value={m.id}>{m.id}{m.description ? ` — ${m.description.slice(0, 70)}` : ''}</option>
              ))}
            </select>
          </label>
          {kind === 'video' ? (
          <label className="text-xs font-bold text-zinc-500">Length (seconds)
            <input type="number" min={1} max={60} value={duration} onChange={(e) => setDuration(e.target.value)} disabled={running} className={`${field} mt-1`} />
          </label>) : <div className="hidden sm:block" />}
          <label className="text-xs font-bold text-zinc-500">Shape
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={running} className={`${field} mt-1`}>
              <option value="16:9">16:9 wide</option><option value="9:16">9:16 phone / reels</option><option value="1:1">1:1 square</option>
            </select>
          </label>
          <div className="flex items-end">
            {running ? (
              <button type="button" onClick={stop} disabled={kind === 'image'} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/50 px-4 py-2 text-sm font-bold text-rose-500">
                <Square className="h-4 w-4" /> Stop
              </button>
            ) : (
              <button type="submit" disabled={!prompt.trim() || (!model && !workflow.trim())} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                <Play className="h-4 w-4" /> {comfy ? 'Make it in ComfyUI' : 'Make it in the cloud'}
              </button>
            )}
          </div>
        </div>
        {comfy && (
          <details className="text-xs">
            <summary className="cursor-pointer font-bold text-zinc-500">Use my own ComfyUI workflow (optional)</summary>
            <p className="my-1 text-[11px] text-zinc-500">In ComfyUI: Workflow -&gt; Export (API). Paste it here and write {'{{prompt}}'} where the prompt goes. Any nodes - ControlNet, IP-Adapter, LoRA, upscalers.</p>
            <textarea value={workflow} onChange={(e) => setWorkflow(e.target.value)} rows={4} disabled={running}
                      placeholder='{"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{prompt}}", ...}}, ...}'
                      className={`${field} font-mono text-[11px]`} />
          </details>
        )}
        {info.error && !comfy && <p className="text-[11px] text-amber-600">{info.error}</p>}
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Cloud className="h-3.5 w-3.5" /> {comfy
          ? `ComfyUI at ${info.url}${info.device ? ` on ${info.device}` : ''} - nothing leaves this computer.`
          : 'Settings are sent only to models that take them. Billed to your Replicate account.'}</p>
      </form>

      {job && (
        <div className={`${card} space-y-2 p-4`}>
          {job.messages?.slice(-4).map((m, i) => <p key={i} className="text-xs text-zinc-500">{m}</p>)}
          {running && <p className="flex items-center gap-2 text-xs text-indigo-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…</p>}
          {job.status === 'completed' && (
            <>
              {kind === 'video'
                ? <video controls src={`${API_BASE}${K.file}/${job.id}`} className="w-full rounded-xl bg-black" />
                : <img src={`${API_BASE}${K.file}/${job.id}`} alt={prompt} className="w-full rounded-xl bg-black object-contain" />}
              <a href={`${API_BASE}${K.file}/${job.id}`} download={`smaran-${job.id}.${K.ext}`} className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-500">
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </>
          )}
        </div>
      )}
      {error && <p className={`${card} flex items-start gap-2 p-3 text-sm text-rose-600`}><AlertCircle className="mt-0.5 h-4 w-4" /> {error}</p>}
    </div>
  );
}
