import React, { useCallback, useEffect, useRef, useState } from 'react';
import { takeStudioPrompt } from '../utils/studioHandoff';
import { Film, Loader2, AlertCircle, Download, Sparkles, RefreshCw, HardDriveDownload } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * A screen for making short clips.
 *
 * Like the image studio, the API was already complete and unreachable except
 * by phrasing a chat message the right way. Video needs more of a front door
 * than pictures do, for two reasons the API is explicit about:
 *
 * The packages are not installed by default. Several gigabytes of PyTorch and
 * diffusers are fetched on demand, so the first thing this screen has to do
 * is ask whether they are present, and offer the install with its real size
 * and progress rather than starting a silent multi-gigabyte download.
 *
 * The machine decides the shape of the render. /api/video/suggested reports
 * the width, height and frame rate chosen from this card's memory - a 6 GB
 * card and a 24 GB card are not asked for the same work. That is shown rather
 * than hidden, because otherwise the same prompt quietly produces a different
 * result on a different computer and nothing explains why.
 */

const POLL_MS = 2000;
const INSTALL_POLL_MS = 1500;

const card = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60';
const field = 'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 '
  + 'px-3 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-indigo-500';

const gb = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(1)} GB` : '—');

const VideoStudio = () => {
  const [install, setInstall] = useState(null);
  const [capability, setCapability] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [loadError, setLoadError] = useState('');

  // Asked for by voice: the words become the prompt, and the clip starts once
  // the video packages are installed.
  const [prompt, setPrompt] = useState(() => takeStudioPrompt('videos'));
  const autoStart = useRef(Boolean(prompt));
  const [seconds, setSeconds] = useState(2);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [made, setMade] = useState([]);

  const polling = useRef(null);
  const installPolling = useRef(null);

  const readState = useCallback(async () => {
    setLoadError('');
    try {
      const [installRes, capRes, sugRes] = await Promise.all([
        fetchWithAuth(`${API_BASE}/api/video/install`),
        fetchWithAuth(`${API_BASE}/api/video/capabilities`),
        fetchWithAuth(`${API_BASE}/api/video/suggested`),
      ]);
      if (!installRes.ok) throw new Error('no engine');
      setInstall(await installRes.json());
      if (capRes.ok) setCapability(await capRes.json());
      if (sugRes.ok) setSuggested(await sugRes.json());
    } catch {
      setLoadError(API_BASE
        ? 'Could not reach the video engine. Is SMARAN.AI running on this machine?'
        : 'Making video needs the SMARAN.AI desktop app. This device has no engine to ask.');
    }
  }, []);

  useEffect(() => { readState(); }, [readState]);
  useEffect(() => () => {
    window.clearTimeout(polling.current);
    window.clearTimeout(installPolling.current);
  }, []);

  /* While an install runs the status is polled, because pip reports bytes as
     it goes and a multi-gigabyte download with no number moving looks broken. */
  const watchInstall = useCallback(() => {
    const tick = async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/video/install`);
        if (!res.ok) return;
        const state = await res.json();
        setInstall(state);
        if (state.status === 'running') {
          installPolling.current = window.setTimeout(tick, INSTALL_POLL_MS);
        } else {
          readState();
        }
      } catch { /* the next manual refresh will pick it up */ }
    };
    tick();
  }, [readState]);

  const startInstall = async () => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/video/install`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'The install could not start.');
      watchInstall();
    } catch (err) {
      setError(err.message);
    }
  };

  const watch = useCallback((jobId) => {
    const tick = async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/video/job/${jobId}`);
        if (!res.ok) throw new Error('The job could not be read.');
        const record = await res.json();
        setJob({ ...record, id: jobId });
        if (record.status === 'completed') {
          setMade((all) => [{ id: jobId, prompt }, ...all].slice(0, 12));
          return;
        }
        if (record.status === 'failed') {
          setError(record.error || 'The clip could not be made.');
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
    event?.preventDefault?.();
    if (!prompt.trim() || job?.status === 'running') return;
    setError('');
    setJob({ status: 'running', messages: ['Starting…'] });
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/video/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), seconds: Number(seconds) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'The clip could not be started.');
      setJob({ status: 'running', messages: ['Queued…'], id: data.job_id });
      watch(data.job_id);
    } catch (err) {
      setJob(null);
      setError(err.message);
    }
  };

  const running = job?.status === 'running';
  const done = job?.status === 'completed' ? job : null;
  const installing = install?.status === 'running';
  const ready = install?.installed;

  useEffect(() => {
    const arrived = () => {
      const next = takeStudioPrompt('videos');
      if (next) { setPrompt(next); autoStart.current = true; }
    };
    window.addEventListener('smaran:studio-prompt', arrived);
    return () => window.removeEventListener('smaran:studio-prompt', arrived);
  }, []);

  useEffect(() => {
    if (autoStart.current && prompt.trim() && ready && job?.status !== 'running') {
      autoStart.current = false;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, prompt]);
  const hw = capability?.hardware;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black text-zinc-900 dark:text-white">
            <Film className="h-5 w-5 text-indigo-500" /> Video
          </h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Short clips rendered on this machine. Nothing is uploaded, and the
            weights stay on your disk once fetched.
          </p>
        </div>

        {loadError && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-amber-700 dark:text-amber-300`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{loadError}</p>
              {API_BASE && (
                <button type="button" onClick={readState}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold underline">
                  <RefreshCw className="h-3 w-3" /> Try again
                </button>
              )}
            </div>
          </div>
        )}

        {/* What the card can do, said before anything is started. The engine
            reports its own reason when the answer is no. */}
        {hw && (
          <div className={`${card} p-4 text-xs`}>
            <p className="font-bold text-zinc-900 dark:text-white">This machine</p>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              {hw.has_cuda
                ? `${hw.gpu_name} · ${hw.vram_total_gb} GB video memory`
                : (hw.reason || 'No usable graphics card was found.')}
            </p>
            {suggested?.width && (
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                Renders here are {suggested.width}×{suggested.height}
                {suggested.fps ? ` at ${suggested.fps} frames a second` : ''}, chosen from this card's memory.
              </p>
            )}
          </div>
        )}

        {install && !ready && (
          <div className={`${card} space-y-3 p-4 sm:p-5`}>
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
              <HardDriveDownload className="h-4 w-4 text-indigo-500" />
              The video packages are not installed yet
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              About {install.approx_download_gb} GB is downloaded once. It is
              kept on this machine and never fetched again.
              {install.free_space_gb !== undefined && install.free_space_gb !== null
                ? ` ${install.free_space_gb.toFixed(1)} GB is free.`
                : ''}
            </p>
            {install.blocker && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
                {install.blocker}
              </p>
            )}
            {installing ? (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-indigo-500 transition-all"
                       style={{ width: `${install.approx_percent || 0}%` }} />
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {gb(install.obtained_bytes)} of about {gb(install.approx_total_bytes)}
                  {' · '}{install.approx_percent || 0}%
                </p>
                <ul className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {(install.messages || []).slice(-4).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </>
            ) : (
              <button type="button" onClick={startInstall} disabled={!install.can_install}
                      className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50">
                Install the video packages
              </button>
            )}
            {install.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{install.error}</p>
            )}
          </div>
        )}

        {ready && (
          <form onSubmit={generate} className={`${card} space-y-4 p-4 sm:p-5`}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the shot — what moves, and how the camera sees it."
              className={`${field} resize-y`}
            />
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                Length · {seconds} second{Number(seconds) === 1 ? '' : 's'}
              </span>
              <input type="range" min="1" max="10" step="1" value={seconds}
                     onChange={(e) => setSeconds(e.target.value)} className="w-full accent-indigo-500" />
              <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
                Longer clips take proportionally longer and need more memory.
              </span>
            </label>
            <button
              type="submit"
              disabled={running || !prompt.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {running ? 'Rendering…' : 'Make the clip'}
            </button>
          </form>
        )}

        {error && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-red-600 dark:text-red-400`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {running && (
          <div className={`${card} p-4`}>
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Rendering
            </div>
            <ul className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {(job.messages || []).slice(-6).map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>
        )}

        {done && (
          <div className={`${card} overflow-hidden`}>
            <video controls src={`${API_BASE}/api/video/file/${job.id}`} className="w-full bg-black" />
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{prompt}</span>
              <a href={`${API_BASE}/api/video/file/${job.id}`} download={`smaran-${job.id}.mp4`}
                 className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
                <Download className="h-3.5 w-3.5" /> Save
              </a>
            </div>
          </div>
        )}

        {made.length > 1 && (
          <div>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Earlier in this session</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {made.slice(1).map((item) => (
                <video key={item.id} controls src={`${API_BASE}/api/video/file/${item.id}`}
                       className="w-full rounded-xl border border-zinc-200 bg-black dark:border-zinc-800" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoStudio;
