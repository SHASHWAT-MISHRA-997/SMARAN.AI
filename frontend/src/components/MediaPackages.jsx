import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HardDriveDownload, Loader2 } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

/**
 * The image and video packages (PyTorch, diffusers - about 3 GB), shared by
 * Images and Video.
 *
 * They are fetched on request, not shipped to everyone. Video Studio could
 * install them; Images said "fetched on request" and offered no way to, so
 * pictures could never be made. One card for both, so there is one installer
 * and not two that drift apart.
 *
 * Reports every state to the parent through onStatus(state) - `installed` is
 * what the parent waits for - and renders nothing once they are installed.
 */
const INSTALL_POLL_MS = 1500;
const gb = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(1)} GB` : '-');
const card = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60';

export default function MediaPackages({ onStatus }) {
  const [install, setInstall] = useState(null);
  const [error, setError] = useState('');
  const polling = useRef(null);
  const report = useRef(onStatus);
  report.current = onStatus;

  const read = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/video/install`);
      if (!res.ok) throw new Error('The engine did not answer.');
      const state = await res.json();
      setInstall(state);
      report.current?.(state);
      return state;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    read().then((state) => {
      if (state?.status === 'running') watch();   // an install already under way
    });
    return () => window.clearTimeout(polling.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pip reports bytes as it goes; a multi-gigabyte download with no number
  // moving looks broken, so the status is polled while it runs.
  const watch = () => {
    const tick = async () => {
      const state = await read();
      if (state?.status === 'running') polling.current = window.setTimeout(tick, INSTALL_POLL_MS);
    };
    tick();
  };

  const start = async () => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/video/install`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'The install could not start.');
      watch();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!install && !error) {
    return (
      <div className={`${card} flex items-center gap-2 p-4 text-sm text-zinc-500 dark:text-zinc-400`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Checking what this computer can run...
      </div>
    );
  }
  if (install?.installed) return null;

  const installing = install?.status === 'running';
  return (
    <div className={`${card} space-y-3 p-4 sm:p-5`}>
      <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
        <HardDriveDownload className="h-4 w-4 text-indigo-500" />
        {install?.error && !installing
          ? 'The image and video packages need attention'
          : 'The image and video packages are not installed yet'}
      </div>
      {install && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          About {install.approx_download_gb} GB is downloaded once and kept on
          this machine; pictures and clips are then made here, offline.
          {install.free_space_gb !== undefined && install.free_space_gb !== null
            ? ` ${install.free_space_gb.toFixed(1)} GB is free.`
            : ''}
        </p>
      )}
      {install?.blocker && (
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
          {install.current_name && (
            <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">{install.current_name}</p>
          )}
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {gb(install.obtained_bytes)} of about {gb(install.approx_total_bytes)}
            {' · '}{install.approx_percent || 0}%
          </p>
          <ul className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {(install.messages || []).slice(-4).map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </>
      ) : install && (
        <button type="button" onClick={start} disabled={!install.can_install}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50">
          Install the image and video packages
        </button>
      )}
      {(install?.error || error) && (
        <p className="text-xs text-red-600 dark:text-red-400">{install?.error || error}</p>
      )}
    </div>
  );
}
