import React, { useEffect, useState } from 'react';
import { Globe, Shield, Check, Laptop } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

const ChromeExtensionPreferences = () => {
  const [enabled, setEnabled] = useState(true);
  const [defaultPolicy, setDefaultPolicy] = useState('ask');
  const [status, setStatus] = useState(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/browser-extension/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.extension_enabled !== undefined) setEnabled(data.extension_enabled);
        if (data.site_permissions_default) setDefaultPolicy(data.site_permissions_default);
      }
    } catch {
      // Offline fallback
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleToggle = (next) => {
    setEnabled(next);
    localStorage.setItem('sm_chrome_extension_enabled', String(next));
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handlePolicyChange = (policy) => {
    setDefaultPolicy(policy);
    localStorage.setItem('sm_chrome_site_policy', policy);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 max-w-2xl">
      {/* Visual Header Banner matching Screenshot 1 */}
      <div className="space-y-3">
        <div className="w-12 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shadow-md">
          <div className="relative">
            <Globe className="w-6 h-6 text-indigo-400" />
            <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-900" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black tracking-tight">SMARAN in Chrome settings</h3>
            <span className="text-[10px] font-black uppercase px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-500 dark:text-indigo-300">
              Beta
            </span>
          </div>
          {savedNotice && (
            <span className="text-xs font-bold text-emerald-500 flex items-center gap-1 animate-fadeIn">
              <Check className="w-4 h-4" /> Saved
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Enable SMARAN in Chrome */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Enable SMARAN in Chrome</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Use SMARAN in your browser with the SMARAN in Chrome extension. This setting only affects the extension.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleToggle(!enabled)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            enabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle SMARAN in Chrome"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              enabled ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Site permissions section */}
      <div className="space-y-3 py-2">
        <div>
          <p className="text-sm font-bold">Site permissions</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            These permissions apply to SMARAN in Chrome and the built-in browser in SMARAN Code Desktop and Cowork.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 pt-2">
          <div>
            <p className="text-xs font-bold">Default for all sites</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Choose whether SMARAN works on all sites by default
            </p>
          </div>
          <select
            value={defaultPolicy}
            onChange={(e) => handlePolicyChange(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-zinc-900 dark:text-zinc-100 outline-none cursor-pointer"
          >
            <option value="ask">Ask before running</option>
            <option value="allow">Allow on all sites</option>
            <option value="block">Block by default</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default ChromeExtensionPreferences;
