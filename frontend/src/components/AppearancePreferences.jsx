import React, { useState } from 'react';
import { loadAppearance, saveAppearance } from '../utils/appearancePreferences';
import { loadFeedback, saveFeedback, feedback } from '../utils/feedback';

export default function AppearancePreferences() {
  const [prefs, setPrefs] = useState(loadAppearance);
  const [touch, setTouch] = useState(loadFeedback);
  const toggleTouch = (key) => {
    const next = { ...touch, [key]: !touch[key] };
    saveFeedback(next);
    setTouch(next);
    if (next[key]) feedback('success');   // so you feel/hear what you turned on
  };
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
    {[['haptics', 'Haptics', 'A short vibration on every tap (phones and tablets that can vibrate).'],
      ['sounds', 'Interface sounds', 'A soft click on every button press.']].map(([key, label, hint]) =>
      <div key={key} className="flex items-center justify-between gap-4 border-t border-zinc-500/20 pt-4">
        <span><span className="block">{label}</span><span className="block text-xs text-zinc-500">{hint}</span></span>
        <button type="button" role="switch" aria-checked={touch[key]} aria-label={label} onClick={() => toggleTouch(key)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${touch[key] ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-700'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${touch[key] ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>)}
  </section>;
}
