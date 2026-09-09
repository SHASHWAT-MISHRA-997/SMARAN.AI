import React, { useState } from 'react';

const DEFAULT_SHORTCUTS = [
  { id: 'new_chat', name: 'New Conversation', keys: 'Ctrl + Alt + N', scope: 'In-App', description: 'Start a fresh chat session.' },
  { id: 'open_settings', name: 'Open Settings', keys: 'Ctrl + Alt + S', scope: 'In-App', description: 'Open the settings and preferences panel.' },
  { id: 'toggle_panel', name: 'Toggle Right Panel', keys: 'Ctrl + Alt + P', scope: 'In-App', description: 'Show or hide the right telemetry and companion panel.' },
  { id: 'toggle_terminal', name: 'Open Terminal', keys: 'Ctrl + `', scope: 'In-App', description: 'Toggle the integrated terminal workspace.' },
  { id: 'voice_speak', name: 'Start/End Voice Call', keys: 'Ctrl + Alt + V', scope: 'In-App', description: 'Open hands-free Speak voice session.' },
  { id: 'stop_control', name: 'Stop Desktop Agent', keys: 'Ctrl + Alt + X', scope: 'In-App', description: 'Immediately halt active computer control sessions.' },
  { id: 'mute_audio', name: 'Toggle Mute', keys: 'Ctrl + Alt + M', scope: 'System', description: 'Mute or unmute host system audio.' },
];

export default function ShortcutsPreferences() {
  const [search, setSearch] = useState('');
  const [shortcuts, setShortcuts] = useState(() => {
    const saved = localStorage.getItem('sm_shortcuts');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return DEFAULT_SHORTCUTS;
  });
  const [editingId, setEditingId] = useState(null);
  const [editKeys, setEditKeys] = useState('');
  const [conflictNotice, setConflictNotice] = useState('');

  const filtered = shortcuts.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.keys.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  );

  const startEdit = (sc) => {
    setEditingId(sc.id);
    setEditKeys(sc.keys);
    setConflictNotice('');
  };

  const saveEdit = (id) => {
    const conflict = shortcuts.find(s => s.id !== id && s.keys.toLowerCase() === editKeys.toLowerCase().trim());
    if (conflict) {
      setConflictNotice(`Conflict detected with "${conflict.name}" (${conflict.keys}).`);
      return;
    }
    const updated = shortcuts.map(s => s.id === id ? { ...s, keys: editKeys.trim() } : s);
    setShortcuts(updated);
    localStorage.setItem('sm_shortcuts', JSON.stringify(updated));
    setEditingId(null);
    setConflictNotice('');
  };

  const resetDefaults = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    localStorage.removeItem('sm_shortcuts');
    setEditingId(null);
    setConflictNotice('Reset to factory default shortcuts.');
  };

  return (
    <section className="space-y-5 text-ink" aria-label="Keyboard shortcuts preferences">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-ink">Keyboard Shortcuts</h3>
          <p className="text-sm text-ink-muted">View, search, and customize application keybindings.</p>
        </div>
        <button
          type="button"
          onClick={resetDefaults}
          className="px-3 py-1.5 rounded-lg border border-line text-xs font-semibold text-ink-muted hover:text-ink transition self-start sm:self-auto"
        >
          Reset to Defaults
        </button>
      </div>

      {/* Search Filter */}
      <div>
        <input
          type="text"
          placeholder="Search shortcuts by name, keys, or action…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-indigo-500"
        />
      </div>

      {conflictNotice && (
        <p className="text-xs text-amber-400 font-semibold">{conflictNotice}</p>
      )}

      {/* Shortcuts List */}
      <div className="rounded-2xl border border-line bg-raised overflow-hidden divide-y divide-line">
        {filtered.map(sc => {
          const isEditing = editingId === sc.id;
          return (
            <div key={sc.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink">{sc.name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sunken text-ink-faint border border-line">
                    {sc.scope}
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted">{sc.description}</p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                {isEditing ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editKeys}
                      onChange={e => setEditKeys(e.target.value)}
                      className="w-32 rounded-lg border border-indigo-500 bg-sunken px-2 py-1 text-xs font-mono text-ink text-center outline-none"
                      placeholder="e.g. Ctrl + Shift + K"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(sc.id)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 rounded-lg border border-line text-xs text-ink-muted hover:text-ink transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <kbd className="px-2.5 py-1 rounded-lg border border-line bg-sunken font-mono text-xs font-semibold text-ink shadow-sm">
                      {sc.keys}
                    </kbd>
                    <button
                      type="button"
                      onClick={() => startEdit(sc)}
                      className="px-2 py-1 text-xs text-ink-muted hover:text-indigo-400 font-medium transition"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-xs text-ink-faint">
            No shortcuts matched "{search}".
          </div>
        )}
      </div>
    </section>
  );
}
