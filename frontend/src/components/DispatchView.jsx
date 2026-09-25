import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Smartphone, Send, ArrowLeft, Plus } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

export default function DispatchView({ onNavigate, onOpenPairing }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deviceError, setDeviceError] = useState('');
  const [dispatchPrompt, setDispatchPrompt] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('all');
  const [dispatching, setDispatching] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [dispatchLogs, setDispatchLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('sm_dispatch_logs');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter(log => log && !['log-1', 'log-2'].includes(log.id)) : [];
    } catch {
      return [];
    }
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // "Loading" only for the first read. The list is refreshed every six
  // seconds, and flipping to loading each time both flashed the message and
  // made Dispatch ignore clicks that landed during a refresh.
  const loadedOnce = useRef(false);
  const loadDevices = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/companion/devices`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Device list unavailable');
      const data = await res.json();
      setDevices(Array.isArray(data.devices) ? data.devices : []);
      setDeviceError('');
    } catch {
      setDevices([]);
      setDeviceError('Could not load paired devices. Check the connection and try again.');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 6000);
    return () => clearInterval(interval);
  }, [loadDevices]);


  const handleDispatch = async (e) => {
    e.preventDefault();
    if (dispatching) return;
    // Say why instead of ignoring the click.
    if (!dispatchPrompt.trim()) { showToast('Type what to send first.'); return; }
    if (deviceError) { showToast(deviceError); return; }
    if (!devices.length) { showToast('No phone is paired yet. Use Pair Device first.'); return; }
    setDispatching(true);

    const logEntry = {
      id: `log-${Date.now()}`,
      target: selectedDevice === 'all' ? 'All Devices' : (devices.find(d => d.id === selectedDevice)?.name || 'Device'),
      command: dispatchPrompt.trim(),
      time: 'Just now',
      status: 'queued'
    };

    try {
      // Dispatch payload to backend
      const response = await fetchWithAuth(`${API_BASE}/api/companion/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: selectedDevice,
          action: 'prompt',
          data: { prompt: dispatchPrompt.trim() }
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Dispatch failed (${response.status}). Your command has been kept for retry.`);
      const acknowledgement = await response.json();
      if (!acknowledgement.dispatched || acknowledgement.devices_count === 0) {
        throw new Error('No device accepted this command. Your command has been kept for retry.');
      }

      const updatedLogs = [logEntry, ...dispatchLogs.slice(0, 19)];
      setDispatchLogs(updatedLogs);
      setDispatchPrompt('');
      try {
        localStorage.setItem('sm_dispatch_logs', JSON.stringify(updatedLogs));
        showToast(`Command queued for ${logEntry.target}`);
      } catch {
        showToast('Command queued, but its history could not be saved on this device.');
      }
    } catch (err) {
      showToast(err?.message || 'Dispatch failed. Your command has been kept for retry.');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-zinc-50 dark:bg-[#0c0c0e] text-zinc-900 dark:text-zinc-100 overflow-y-auto transition-colors duration-200">
      {/* Toast */}
      {toastMessage && (
        <div role="status" className="fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          {onNavigate && (
            <button
              onClick={() => onNavigate('chat')}
              className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition cursor-pointer md:hidden"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black tracking-tight">Device Dispatch</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                Companion Link
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Dispatch tasks, coding sessions, and system notifications to linked companion phones.
            </p>
          </div>
        </div>

        <button
          onClick={onOpenPairing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Pair Device
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Quick Dispatch Composer Card */}
        <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-2 flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-500" /> Dispatch Quick Command
          </h2>
          <form onSubmit={handleDispatch} className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Target:</span>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500"
              >
                <option value="all">Broadcast (All Paired Devices)</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || d.device_name || `Device (${d.ip || 'Local'})`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={dispatchPrompt}
                onChange={(e) => setDispatchPrompt(e.target.value)}
                placeholder="Type command or notification to dispatch (e.g., 'Run pytest and notify on completion')..."
                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!dispatchPrompt.trim() || dispatching || loading || !!deviceError || !devices.length}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md shadow-indigo-600/25 shrink-0"
              >
                <Send className="w-3.5 h-3.5" /> Dispatch
              </button>
            </div>
          </form>
        </div>

        {/* The paired-device list and its unpair button stood here. Settings ->
            Connectors & Devices already lists the same devices and unpairs
            them, against the same GET /api/companion/devices and
            DELETE /api/companion/devices/{id}, so pairings were managed in two
            screens at once and neither said which one was authoritative.
            Dispatch keeps the one thing only it does - sending work to a
            device - and the Target selector above still names them. */}
        {loading && <p role="status">Loading paired devices…</p>}
        {deviceError && <p role="alert">{deviceError}</p>}
        {!loading && !deviceError && devices.length === 0 && (
          <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900/40">
            <Smartphone className="w-10 h-10 text-zinc-400 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">No paired devices found</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Pair a phone or a second computer to dispatch work to it.
            </p>
            <button
              onClick={onOpenPairing}
              className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 cursor-pointer"
            >
              Pair a device
            </button>
          </div>
        )}

        {/* Dispatch Activity Logs */}
        <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Dispatch Activity History
            </h3>
            {dispatchLogs.length > 0 && (
              <button
                onClick={() => {
                  setDispatchLogs([]);
                  localStorage.removeItem('sm_dispatch_logs');
                }}
                className="text-[11px] text-zinc-400 hover:text-rose-500 transition cursor-pointer"
              >
                Clear History
              </button>
            )}
          </div>

          {dispatchLogs.length === 0 ? (
            <p className="text-xs text-zinc-500 italic py-3 text-center">No dispatch actions yet.</p>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {dispatchLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-900 dark:text-white truncate">{log.command}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        {log.target}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-zinc-400 text-[11px]">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{log.status}</span>
                    <span>{log.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
