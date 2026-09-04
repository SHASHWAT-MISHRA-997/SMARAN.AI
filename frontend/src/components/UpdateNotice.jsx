import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Sparkles, X } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * Tells you when a newer build exists.
 *
 * The app is installed from a downloaded file, so nothing pushes a new
 * version at it — it has to look. This checks on launch and then twice a
 * day, and shows a notice the way an operating system would.
 *
 * Nothing installs itself. The notice offers the download and gets out of
 * the way; a version you dismiss is not raised again until a newer one than
 * that appears, so it cannot become a thing you learn to ignore.
 */

const DISMISSED_KEY = 'smaran-update-dismissed';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const UpdateNotice = () => {
  const [info, setInfo] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [installing, setInstalling] = useState(false);

  const look = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/updates/check`, { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      if (!data?.update_available || !data.latest_version) return;

      // Only stay quiet about the exact version that was dismissed.
      if (localStorage.getItem(DISMISSED_KEY) === data.latest_version) return;
      setInfo(data);
    } catch {
      // Offline is the normal state for a local-first app; say nothing.
    }
  }, []);

  useEffect(() => {
    // A moment after launch, so it never competes with the app starting up.
    const first = setTimeout(look, 6000);
    const repeat = setInterval(look, CHECK_INTERVAL_MS);
    return () => { clearTimeout(first); clearInterval(repeat); };
  }, [look]);

  const install = async () => {
    if (!info?.downloaded_path) return;
    setInstalling(true);
    try {
      await fetch(`${API_BASE}/api/updates/install`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: info.downloaded_path }),
      });
      // The app closes a couple of seconds later so the installer can replace
      // the files it is running from; there is nothing further to do here.
    } catch {
      setInstalling(false);
    }
  };

  const dismiss = () => {
    if (info?.latest_version) localStorage.setItem(DISMISSED_KEY, info.latest_version);
    setLeaving(true);
    setTimeout(() => setInfo(null), 260);
  };

  if (!info) return null;

  const target = info.windows_url || info.release_page;

  /* The release notes are not shown here.
   *
   * They were: markdown, stripped of its markup and cut at 150 characters.
   * Which meant the corner of the screen carried half a sentence with its
   * punctuation removed, ending mid-clause - "and this one is the cause
   * rather than the". Notes written as paragraphs for a releases page do not
   * survive being squeezed into three lines, and a fragment that stops in the
   * middle of a thought reads as something broken rather than as news.
   *
   * What is left is what this notice is for: which version is out, which one
   * you are on, and the two buttons. Anyone who wants the detail can follow
   * the link, where the notes are whole. */

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-[95] w-[min(23rem,calc(100vw-2.5rem))]
                  overflow-hidden rounded-2xl border border-red-500/30 bg-zinc-950/95
                  shadow-[0_18px_60px_rgba(0,0,0,.6),0_0_40px_rgba(239,68,68,.18)]
                  backdrop-blur-xl transition-all duration-300
                  ${leaving ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100'}`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 120% at 50% 0%, rgba(239,68,68,.16), transparent 70%)' }}
        aria-hidden="true"
      />

      <div className="relative p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-red-500/40 bg-red-500/10">
            <Sparkles className="h-4 w-4 text-red-400" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white">
              Version {info.latest_version} {info.downloaded_path ? 'is ready to install' : 'is available'}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              You are on {info.current_version}
            </p>
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {/* If the installer is already on disk, asking again to download it
              is asking for something that has happened. The notice then says
              what is actually outstanding: the restart. */}
          {info.downloaded_path ? (
            <button
              type="button"
              onClick={install}
              disabled={installing}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2
                         text-xs font-black text-white transition hover:bg-emerald-500 disabled:opacity-60
                         shadow-[0_0_20px_rgba(16,185,129,.3)]"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              {installing ? 'Opening installer...' : 'Restart & Install'}
            </button>
          ) : (
            <a
              href={target}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2
                         text-xs font-black text-white transition hover:bg-red-500
                         shadow-[0_0_20px_rgba(239,68,68,.3)]"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Download
            </a>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-400
                       transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Later
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] text-zinc-600">
          {info.downloaded_path
            ? 'Already downloaded. SMARAN.AI closes so the installer can replace it.'
            : 'Downloads open in your browser. Nothing installs on its own.'}
        </p>
      </div>
    </div>
  );
};

export default UpdateNotice;
