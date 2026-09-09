/**
 * A bench for the Settings resource bars.
 *
 * Reaching them in the real app means a running backend, a session and the
 * Settings panel; this shows every state side by side instead, including the
 * one that matters — a device that reports nothing.
 *
 * Development only. Vite builds `index.html` and nothing else, so this is not
 * part of any shipped bundle.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { usagePercent } from '../../src/utils/usageBar.js';

/** Kept identical in shape to the one in SettingsModal. */
const ResourceBar = ({ percent, colour, label }) => {
  const unknown = percent === null;
  return (
    <div
      className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 mt-2 overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={unknown ? undefined : Math.round(percent)}
      title={unknown ? `${label}: not reported by this device` : `${label}: ${Math.round(percent)}%`}
      style={{ width: '100%', height: 8, borderRadius: 9999, background: '#27272a', overflow: 'hidden' }}
    >
      {unknown ? (
        <div style={{
          height: '100%', width: '100%', opacity: 0.4, color: '#a1a1aa',
          background: 'repeating-linear-gradient(45deg,currentColor 0 4px,transparent 4px 8px)',
        }} />
      ) : (
        <div style={{ height: '100%', width: `${percent}%`, background: colour }} />
      )}
    </div>
  );
};

const CASES = [
  { label: 'Reported: 3 / 6 GB', used: 3, total: 6 },
  { label: 'Reported: 0 / 16 GB (genuinely idle)', used: 0, total: 16 },
  { label: 'Reported: 15.6 / 16 GB', used: 15.6, total: 16 },
  { label: 'NOT reported (null used)', used: null, total: 16 },
  { label: 'NOT reported (both null)', used: null, total: null },
  { label: 'NOT reported ("Not reported" string)', used: 'Not reported', total: 16 },
  { label: 'Over capacity, clamped', used: 20, total: 16 },
];

function Harness() {
  return (
    <div style={{ padding: 24, color: '#e4e4e7', fontFamily: 'monospace', fontSize: 13 }}>
      <h1 style={{ fontSize: 15, marginBottom: 4 }}>Settings resource bars</h1>
      <p style={{ opacity: 0.6, marginTop: 0, marginBottom: 24 }}>
        An unreported bar must look different from an empty one.
      </p>
      {CASES.map((c) => {
        const percent = usagePercent(c.used, c.total);
        return (
          <div key={c.label} style={{ marginBottom: 20, maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span>{c.label}</span>
              <span style={{ opacity: 0.6 }}>
                {percent === null ? 'null' : `${Math.round(percent * 10) / 10}%`}
              </span>
            </div>
            <ResourceBar percent={percent} colour="#6366f1" label={c.label} />
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
