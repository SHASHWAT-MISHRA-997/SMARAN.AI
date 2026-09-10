import React, { useEffect, useState } from 'react';
import { Users, Folder, Check } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

const CoworkPreferences = () => {
  const [settings, setSettings] = useState({
    trusted_devices_required: true,
    dispatch_enabled: true,
    cowork_files_path: 'C:\\Users\\shash\\SMARAN\\Cowork',
    trusted_folders: ['C:\\Users\\shash\\SMARAN\\Cowork'],
    only_on_this_computer: false,
    preferred_browser: 'chrome',
    open_links_in_builtin_browser: false,
  });
  const [, setLoading] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);
  const [managingFolders, setManagingFolders] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState('');

  const fetchSettings = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/cowork/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, ...data }));
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSetting = async (key, value) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await fetchWithAuth(`${API_BASE}/api/cowork/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch {
      // Offline fallback
    }
  };

  const handleChangePath = () => {
    const next = window.prompt('Enter new Cowork artifacts directory path:', settings.cowork_files_path);
    if (next && next.trim()) {
      updateSetting('cowork_files_path', next.trim());
    }
  };

  const handleAddFolder = () => {
    if (!newFolderInput.trim()) return;
    const folders = [...(settings.trusted_folders || []), newFolderInput.trim()];
    updateSetting('trusted_folders', folders);
    setNewFolderInput('');
  };

  const handleRemoveFolder = (folder) => {
    const folders = (settings.trusted_folders || []).filter((f) => f !== folder);
    updateSetting('trusted_folders', folders);
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 max-w-2xl">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h3 className="text-lg font-black flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-500" /> Cowork
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Configure automated background tasks, computer control, and mobile dispatch permissions.
          </p>
        </div>
        {savedNotice && (
          <span className="text-xs font-bold text-emerald-500 flex items-center gap-1 animate-fadeIn">
            <Check className="w-4 h-4" /> Saved
          </span>
        )}
      </div>

      {/* 1. Require trusted devices */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Require trusted devices</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Verify each new device before it can connect to SMARAN on your computer remotely — applies to SMARAN Code Remote Control and Cowork.{' '}
            <a href="#learn-more" className="text-indigo-500 hover:underline">Learn more ↗</a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('trusted_devices_required', !settings.trusted_devices_required)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.trusted_devices_required ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle trusted devices"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.trusted_devices_required ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 2. Dispatch (Beta) */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold">Dispatch</p>
            <span className="text-[10px] font-black uppercase px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-500 dark:text-indigo-300">
              Beta
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Let SMARAN work on tasks from your phone using this computer. When off, your phone won&rsquo;t be able to dispatch work here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('dispatch_enabled', !settings.dispatch_enabled)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.dispatch_enabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Dispatch"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.dispatch_enabled ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 3. Cowork files */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Cowork files</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Your artifacts and scheduled tasks are stored at{' '}
            <span className="font-mono text-indigo-500 underline decoration-dotted">{settings.cowork_files_path}</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={handleChangePath}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-bold transition cursor-pointer"
        >
          <Folder className="w-3.5 h-3.5" />
          <span>Change</span>
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 4. Trusted Cowork folders */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Trusted Cowork folders</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Cowork tasks may use these folders, and folders inside them, without asking you first.
          </p>
          {managingFolders && (
            <div className="mt-3 p-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFolderInput}
                  onChange={(e) => setNewFolderInput(e.target.value)}
                  placeholder="e.g. C:\Users\shash\Projects"
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddFolder}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold"
                >
                  Add
                </button>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {(settings.trusted_folders || []).map((f) => (
                  <div key={f} className="flex items-center justify-between text-xs font-mono py-1 px-2 bg-white dark:bg-zinc-800 rounded">
                    <span className="truncate">{f}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFolder(f)}
                      className="text-rose-500 text-[11px] font-bold hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setManagingFolders(!managingFolders)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-bold transition cursor-pointer"
        >
          <span>{managingFolders ? 'Done' : 'Manage'}</span>
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 5. Only on this computer */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Only on this computer</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Stops when the app closes or this computer sleeps.{' '}
            <a href="#learn-more" className="text-indigo-500 hover:underline">Learn more about how SMARAN reads your files</a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('only_on_this_computer', !settings.only_on_this_computer)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.only_on_this_computer ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Only on this computer"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.only_on_this_computer ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 6. Preferred browser */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Preferred browser</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            SMARAN uses this browser by default unless you ask otherwise.
          </p>
        </div>
        <select
          value={settings.preferred_browser}
          onChange={(e) => updateSetting('preferred_browser', e.target.value)}
          className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-zinc-900 dark:text-zinc-100 outline-none cursor-pointer"
        >
          <option value="chrome">Chrome (SMARAN in Chrome)</option>
          <option value="builtin">Built-in browser</option>
        </select>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 7. Open links in built-in browser */}
      <div className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Open links in built-in browser</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Links open in the built-in browser instead of your default browser.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('open_links_in_builtin_browser', !settings.open_links_in_builtin_browser)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.open_links_in_builtin_browser ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Open links in built-in browser"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.open_links_in_builtin_browser ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default CoworkPreferences;
