import React, { useEffect, useState } from 'react';
import { Laptop, RefreshCw, Check, X } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

const DesktopGeneralPreferences = () => {
  const [settings, setSettings] = useState({
    version: '1.49585.0',
    run_on_startup: false,
    quick_entry_shortcut: 'Ctrl+Alt+Space',
    system_tray: true,
    keep_awake: false,
  });
  const [browserStatus, setBrowserStatus] = useState(null);
  const [rechecking, setRechecking] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/desktop/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, ...data }));
      }
    } catch {
      // Offline fallback
    }
  };

  const fetchBrowserStatus = async () => {
    setRechecking(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/browser-extension/status`);
      if (res.ok) {
        const data = await res.json();
        setBrowserStatus(data);
      }
    } catch {
      // Fallback
    } finally {
      setTimeout(() => setRechecking(false), 400);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchBrowserStatus();
  }, []);

  const updateSetting = async (key, value) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await fetchWithAuth(`${API_BASE}/api/desktop/settings`, {
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

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 max-w-2xl">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h3 className="text-lg font-black flex items-center gap-2">
            <Laptop className="w-5 h-5 text-indigo-500" /> General desktop settings
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Startup, system tray, keyboard shortcut, and local browser automation preferences.
          </p>
        </div>
        {savedNotice && (
          <span className="text-xs font-bold text-emerald-500 flex items-center gap-1 animate-fadeIn">
            <Check className="w-4 h-4" /> Saved
          </span>
        )}
      </div>

      {/* Desktop app version */}
      <div className="flex items-center justify-between py-2">
        <span className="text-sm font-bold">Desktop app version</span>
        <span className="font-mono text-sm text-zinc-400">{settings.version || '1.49585.0'}</span>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Run on startup */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Run on startup</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Automatically start SMARAN when you log in to your computer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('run_on_startup', !settings.run_on_startup)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.run_on_startup ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Run on startup"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.run_on_startup ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Quick Entry keyboard shortcut */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Quick Entry keyboard shortcut</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Quickly open SMARAN from anywhere.
          </p>
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
            <span>{settings.quick_entry_shortcut || 'Ctrl+Alt+Space'}</span>
            <button
              type="button"
              onClick={() => updateSetting('quick_entry_shortcut', 'Ctrl+Alt+Space')}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* System tray */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">System tray</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Keep SMARAN running in the system tray.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('system_tray', !settings.system_tray)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.system_tray ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle System tray"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.system_tray ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Keep computer awake */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Keep computer awake</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Prevent your computer from idle-sleeping while SMARAN is open so scheduled tasks can run. Your display can still turn off. Closing the laptop lid will still put it to sleep.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSetting('keep_awake', !settings.keep_awake)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            settings.keep_awake ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Keep computer awake"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              settings.keep_awake ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Browser use & Connected browsers card */}
      <div className="space-y-3 pt-2">
        <div>
          <p className="text-sm font-bold">Browser use</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Not available in cloud Code sessions, which don&rsquo;t run on this computer.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-zinc-400">Connected browsers</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Chrome instances signed in to your account that SMARAN can automate.
          </p>

          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${browserStatus?.connected ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                <span className="text-xs font-bold">
                  {browserStatus?.connected
                    ? `${browserStatus.instances?.[0]?.name || 'Google Chrome Connected'}`
                    : 'No browsers connected'}
                </span>
              </div>
              <button
                type="button"
                onClick={fetchBrowserStatus}
                disabled={rechecking}
                className="flex items-center gap-1.5 px-3 py-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-700 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
                <span>Recheck</span>
              </button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {browserStatus?.connected
                ? 'Chrome CDP endpoint active on port 9222. Automation commands and visual scraping enabled.'
                : 'No Chrome instances are connected. Open Chrome with the SMARAN extension and sign in.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesktopGeneralPreferences;
