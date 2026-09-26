import React, { useState } from 'react';
import { loadAppearance, saveAppearance } from '../utils/appearancePreferences';
import { haptic, hapticsEnabled, hapticsVolume, setHaptics } from '../utils/haptics';

export default function AppearancePreferences() {
  const [prefs, setPrefs] = useState(loadAppearance);
  const [sounds, setSounds] = useState(() => ({ enabled: hapticsEnabled(), volume: hapticsVolume() }));
  const update = (key, value) => {
    const next = { ...prefs, [key]: value };
    saveAppearance(next);
    setPrefs(next);
  };
  const changeSounds = (change) => {
    setHaptics(change);
    setSounds({ enabled: hapticsEnabled(), volume: hapticsVolume() });
  };
  return <section className="space-y-5" aria-label="Appearance preferences">
    <h3 className="text-lg font-bold">Appearance</h3>
    <p className="text-sm text-zinc-500">Changes apply immediately and are saved on this device.</p>
    {[['uiSize', 'Interface font size'], ['codeSize', 'Code font size']].map(([key, label]) =>
      <label key={key} className="flex items-center justify-between gap-4 border-b border-zinc-500/20 pb-4">
        <span>{label}</span>
        <input aria-label={label} className="w-20 rounded-lg border p-2 bg-transparent" type="number" min="12" max="24"
          value={prefs[key]} onChange={e => update(key, Math.max(12, Math.min(24, Number(e.target.value) || 14)))} />
      </label>)}
    <label className="flex items-center justify-between gap-4 border-b border-zinc-500/20 pb-4"><span>Reduce motion</span>
      <select aria-label="Reduce motion" className="rounded-lg border p-2 bg-zinc-100 dark:bg-zinc-900"
        value={prefs.motion} onChange={e => update('motion', e.target.value)}>
        <option value="system">Follow system</option><option value="on">On</option><option value="off">Off</option>
      </select>
    </label>

    <div className="space-y-3">
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block">Sounds &amp; haptics</span>
          <span className="block text-xs text-zinc-500">
            A soft click on every button, a chime when a reply, task or page is ready, and a ping when
            SMARAN is waiting for you. Phones also vibrate.
          </span>
        </span>
        <input type="checkbox" role="switch" aria-label="Sounds and haptics" className="h-5 w-5 accent-indigo-500"
          checked={sounds.enabled} onChange={e => changeSounds({ enabled: e.target.checked })} />
      </label>
      <label className={`flex items-center justify-between gap-4 ${sounds.enabled ? '' : 'opacity-50'}`}>
        <span>Volume</span>
        <span className="flex items-center gap-3">
          <input type="range" min="0" max="100" step="5" aria-label="Sound volume" disabled={!sounds.enabled}
            value={Math.round(sounds.volume * 100)} onChange={e => changeSounds({ volume: Number(e.target.value) / 100 })}
            className="w-40 accent-indigo-500" />
          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{Math.round(sounds.volume * 100)}%</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2" data-no-haptics>
        {[['tap', 'Click'], ['send', 'Send'], ['success', 'Done'], ['attention', 'Waiting'], ['error', 'Error']].map(([kind, label]) =>
          <button key={kind} type="button" disabled={!sounds.enabled} onClick={() => haptic(kind)}
            className="rounded-lg border border-zinc-500/30 px-3 py-1 text-xs font-bold hover:bg-zinc-500/10 disabled:opacity-40">
            ▶ {label}
          </button>)}
      </div>
    </div>
  </section>;
}
