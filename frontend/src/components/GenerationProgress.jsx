import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * What a long job is actually doing, while it does it.
 *
 * Design Studio, Sites, image and video generation all showed a spinner and
 * nothing else. A spinner says "not finished"; it does not say whether the
 * work started, how much arrived, how long it has taken, or whether anything
 * is happening at all - so a slow job and a hung one look identical, and the
 * only way to find out is to wait and see. That is the same complaint the
 * video job produced when it reported "running" for three hours.
 *
 * Every number here is measured, never estimated into existence:
 *
 *   elapsed   counted from mount
 *   received  bytes actually arrived
 *   rate      received / elapsed
 *   percent   only when the caller can justify one
 *
 * `percent` is deliberately optional. A download knows its total and can be
 * honest about a fraction; a model streaming prose cannot, and inventing a
 * number that creeps to 90% and waits there is worse than no number - it is a
 * promise the job never agreed to. Callers that have no real fraction pass
 * none and still get elapsed, size and rate, which is the information that was
 * actually missing.
 */

const pad = (n) => String(n).padStart(2, '0');

export function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How far through an HTML document the stream has got.
 *
 * Returned only for HTML, because only there do the landmarks mean something:
 * a document opens, closes its head, opens its body and closes both. Four
 * checkpoints is coarse, and it is honest about being coarse - it never
 * reports 100 until the closing tag is genuinely present.
 */
export function htmlProgress(text) {
  if (!text) return null;
  const seen = text.toLowerCase();
  if (!/<!doctype html|<html[\s>]/.test(seen)) return null;
  const marks = ['</head>', '<body', '</body>', '</html>'];
  const done = marks.filter((m) => seen.includes(m)).length;
  return Math.round((done / marks.length) * 100);
}

export default function GenerationProgress({
  label = 'Working',
  detail = '',
  received = 0,
  percent = null,
  startedAt = null,
  className = '',
}) {
  const started = useRef(startedAt || Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // A ticking clock is the one thing that proves the screen is still live.
    const id = setInterval(() => {
      setElapsed((Date.now() - started.current) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const rate = elapsed > 0.5 && received > 0 ? received / elapsed : 0;
  const known = typeof percent === 'number' && percent >= 0;

  return (
    <div
      className={`rounded-2xl border border-indigo-300/40 dark:border-indigo-500/25 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <span className="text-xs font-mono tabular-nums text-indigo-700 dark:text-indigo-300 shrink-0">
          {known ? `${Math.min(100, Math.round(percent))}%` : formatElapsed(elapsed)}
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-200/60 dark:bg-indigo-900/40">
        {known ? (
          <div
            className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        ) : (
          /* No honest fraction exists, so the bar does not pretend to one. It
             moves to show the job is alive, which is the actual question. */
          <div className="h-full w-1/3 rounded-full bg-indigo-500 animate-[progress-slide_1.4s_ease-in-out_infinite]" />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono text-indigo-600/80 dark:text-indigo-400/80">
        {known && <span>{formatElapsed(elapsed)} elapsed</span>}
        {received > 0 && <span>{formatSize(received)} received</span>}
        {rate > 0 && <span>{formatSize(Math.round(rate))}/s</span>}
        {detail && <span className="truncate">{detail}</span>}
      </div>
    </div>
  );
}
