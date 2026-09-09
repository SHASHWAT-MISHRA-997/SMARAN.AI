import React, { useState } from 'react';
import { loadAppearance, saveAppearance } from '../utils/appearancePreferences';

export default function AppearancePreferences() {
  const [prefs, setPrefs] = useState(loadAppearance);
  const update = (key, value) => {
    const next = { ...prefs, [key]: value };
    saveAppearance(next);
    setPrefs(next);
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
    <label className="flex items-center justify-between gap-4"><span>Reduce motion</span>
      <select aria-label="Reduce motion" className="rounded-lg border p-2 bg-zinc-100 dark:bg-zinc-900"
        value={prefs.motion} onChange={e => update('motion', e.target.value)}>
        <option value="system">Follow system</option><option value="on">On</option><option value="off">Off</option>
      </select>
    </label>
  </section>;
}
