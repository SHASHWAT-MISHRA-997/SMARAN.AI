import React, { useEffect, useState } from 'react';
import { X, Cpu, User, Shield, Info, Zap, Monitor, HardDrive, Gauge, Sparkles, Globe, ExternalLink } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

const SettingsModal = ({ isOpen, onClose, user, onModelChange, selectedModel, turboMode, onTurboModeChange }) => {
  const [models, setModels] = useState({ installed_models: [], active_model: '', engine: 'vllm', display_name: '' });
  const [deviceSpecs, setDeviceSpecs] = useState(null);
  const [loading, setLoading] = useState(true);
  // Real-time download status from /api/model/status (separate from /api/system/models)
  const [downloadStatus, setDownloadStatus] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/models`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.installed_models && data.installed_models.length > 0) {
            setModels(data);
          }
        }
      } catch (e) {
        console.error('Failed to fetch models', e);
      }
    };

    const fetchSpecs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/device-specs`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (res.ok) {
          const specs = await res.json();
          setDeviceSpecs(specs);
        }
      } catch (e) {
        console.error('Failed to fetch specs', e);
      } finally {
        setLoading(false);
      }
    };

    // Also fetch real-time download status for accuracy
    const fetchDownloadStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/model/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (res.ok) {
          const data = await res.json();
          setDownloadStatus(data);
        }
      } catch (e) {}
    };

    fetchModels();
    fetchSpecs();
    fetchDownloadStatus();

    // Live sync device specs (load metrics) every 4 seconds while modal is open
    const interval = setInterval(() => { fetchSpecs(); fetchDownloadStatus(); fetchModels(); }, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const defaultModelList = [
    'auto',
    'Qwen/Qwen3-4B-AWQ'
  ];
  const rawSelectable = Array.from(new Set([...defaultModelList, ...(models.installed_models || [])])).filter(m => !m.startsWith('nomic-embed-text'));

  // Filter out any models that are not downloaded and not actively downloading
  const selectableModels = rawSelectable.filter(m => {
    if (m === 'auto') return true;
    let st = (models.models_status || {})[m] || {};
    const isActiveDownload = downloadStatus && !downloadStatus.ready && downloadStatus.model_id === m;
    const isReady = (st.ready === true) && !isActiveDownload;
    return isReady || isActiveDownload || m === 'Qwen/Qwen3-4B-AWQ';
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-left">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-base font-black text-zinc-950 dark:text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-500" />
            System Settings
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* User Profile card */}
          <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-900 rounded-xl p-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 font-black uppercase text-sm">
                {user?.username?.charAt(0) || 'U'}
              </div>
              <div>
                <div className="font-black text-zinc-950 dark:text-white text-sm">{user?.username}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-500 font-semibold flex items-center gap-1.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-zinc-400" />
                  <span>ID: {user?.id}</span>
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Shield className="w-3 h-3" />
              {user?.role === 'admin' ? 'Admin' : 'Staff'}
            </span>
          </div>

          {/* Model Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-black text-zinc-950 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-500" />
              Select Model
            </label>
            <div className="space-y-2">
              {selectableModels.map((m) => {
                const isActive = m === selectedModel;
                const modelDisplayMap = {
                  'auto': 'Auto (Smart Model Router)',
                  'Qwen/Qwen3-4B-AWQ': 'Qwen 3 4B AWQ (Quantized · 6GB GPU)',
                  'Qwen/Qwen3-4B': 'Qwen 3 4B (Full Precision)',
                  'nvidia/Nemotron-Mini-4B-Instruct': 'Nemotron-3 Nano 4B (NVIDIA Instruct)',
                  'nemotron-mini:4b': 'Nemotron-3 Nano 4B (NVIDIA Instruct)',
                  'microsoft/phi-3.5-mini-instruct': 'Phi-3.5 Mini 3.8B (Microsoft Instruct)',
                  'microsoft/phi-3.5-vision-instruct': 'Phi-3.5 Vision 4.2B (Microsoft Vision)',
                  'microsoft/Phi-3.5-mini-instruct': 'Phi-3.5 Mini 3.8B (Microsoft Instruct)',
                  'microsoft/Phi-3.5-vision-instruct': 'Phi-3.5 Vision 4.2B (Microsoft Vision)',
                  'phi3:latest': 'Phi-3 Mini 3.8B (Microsoft Instruct)',
                  'phi3.5:latest': 'Phi-3.5 Mini 3.8B (Microsoft Instruct)',
                  'phi4:latest': 'Phi-4 14B (Microsoft Reasoning)',
                  'Qwen/Qwen3-8B': 'Qwen 3 8B (High Precision Reasoning)',
                  'qwen3:8b': 'Qwen 3 8B (High Precision Reasoning)',
                };
                const displayName = modelDisplayMap[m] || m;
                let st = (models.models_status || {})[m] || {};

                // Override with real-time download status: if this model is currently downloading,
                // mark it as NOT ready regardless of what /api/system/models says
                const isActiveDownload = downloadStatus && !downloadStatus.ready && downloadStatus.model_id === m;
                if (isActiveDownload) {
                  st = {
                    ready: false,
                    status: `Downloading (${downloadStatus.progress_pct?.toFixed(1)}%)`,
                    progress_pct: downloadStatus.progress_pct || 1,
                  };
                }

                const isReady = (st.ready === true) && !isActiveDownload && m !== 'auto' ? true : (m === 'auto');
                const statusText = st.status || (isReady ? 'Ready' : 'Not Downloaded');
                return (
                  <button
                    key={m}
                    onClick={() => {
                      if (onModelChange) onModelChange(m);
                    }}
                    className={`w-full text-left p-4 border-2 rounded-xl flex items-center justify-between transition-all duration-200 cursor-pointer ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 scale-[1.01]'
                        : 'border-zinc-200 dark:border-zinc-800 bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/30 hover:scale-[1.01]'
                    }`}
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-zinc-950 dark:text-white text-sm">{displayName}</span>
                        {isReady ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-extrabold uppercase border border-emerald-500/20">🟢 Ready</span>
                        ) : st.progress_pct > 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-extrabold uppercase border border-amber-500/20 animate-pulse">⏳ {statusText}</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-500 dark:text-zinc-500 text-[9px] font-extrabold uppercase border border-zinc-500/20">⬇ Not Downloaded</span>
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mt-0.5">{m === 'auto' ? 'Chooses a compatible local model for each request' : m}</span>
                    </div>
                    {isActive && (
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-500 animate-pulse" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>



          {/* Device Specifications */}
          {deviceSpecs && (
            <div className="space-y-3">
              <label className="block text-xs font-black text-zinc-950 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-indigo-500" />
                Device Specifications
              </label>
              <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-900 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">GPU</span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">{deviceSpecs.gpu_name || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">VRAM</span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">{deviceSpecs.gpu_vram_total ? deviceSpecs.gpu_vram_total + ' GB' : 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">RAM</span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">{deviceSpecs.memory_total_gb ? deviceSpecs.memory_total_gb + ' GB' : 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">CPU</span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">{deviceSpecs.cpu_name || 'N/A'} ({deviceSpecs.cpu_cores || 'N/A'} cores)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Current GPU Usage</span>
                  <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{deviceSpecs.gpu_usage ? deviceSpecs.gpu_usage.toFixed(0) + '%' : 'N/A'}</span>
                </div>
              </div>
            </div>
          )}

          {/* High-Impact Developer Credits & Lightning Effect Card */}
          <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-r from-indigo-950/80 via-purple-950/80 to-zinc-950 border border-indigo-500/40 shadow-[0_0_30px_rgba(99,102,241,0.25)] backdrop-blur-md">
            {/* Ambient Background Glow Orbs & Lightning animation */}
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none animate-pulse" />
            <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-purple-500/20 rounded-full blur-2xl pointer-events-none animate-pulse" />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shadow-lg shrink-0">
                  <Zap className="w-5 h-5 text-amber-400 animate-pulse drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
                </div>
                <div className="text-left">
                  <div className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-300 animate-spin" style={{ animationDuration: '6s' }} />
                    Developer
                  </div>
                  <h4 className="text-sm font-black tracking-wide bg-gradient-to-r from-indigo-300 via-purple-200 to-amber-200 bg-clip-text text-transparent">
                    SHASHWAT MISHRA
                  </h4>
                </div>
              </div>

              {/* Social Action Badges */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <a
                  href="https://www.linkedin.com/in/sm980/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 hover:border-blue-400 hover:scale-105 transition-all shadow-sm cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                  <span>LinkedIn</span>
                </a>
                <a
                  href="https://shashwatmishra-portfolio.netlify.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 hover:border-purple-400 hover:scale-105 transition-all shadow-sm cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Portfolio</span>
                </a>
              </div>
            </div>
          </div>

          {/* Info Notice */}
          <div className="text-[11px] text-zinc-700 dark:text-zinc-500 font-semibold flex items-start gap-1.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-900 rounded-xl p-3.5 leading-relaxed shrink-0">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
            <span>
              All AI processing runs entirely offline on the local host server — no internet, no cloud APIs, no telemetry. 100% offline and secure on the Local Area Network.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
          >
            Close Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
