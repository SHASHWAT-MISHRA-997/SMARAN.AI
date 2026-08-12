import React, { useEffect, useState } from "react";
import {
  X,
  Cpu,
  User,
  Shield,
  Info,
  Zap,
  Monitor,
  HardDrive,
  Gauge,
  Sparkles,
  Globe,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { API_BASE } from "../context/AuthContext";

const SettingsModal = ({
  isOpen,
  onClose,
  user,
  onModelChange,
  selectedModel,
  turboMode,
  onTurboModeChange,
  sidebarPosition = "left",
  onSidebarPositionChange,
  performancePosition = "right",
  onPerformancePositionChange,
}) => {
  const [models, setModels] = useState({
    installed_models: [],
    active_model: "",
    engine: "vllm",
    display_name: "",
  });
  const [deviceSpecs, setDeviceSpecs] = useState(null);
  const [loading, setLoading] = useState(true);
  // Real-time download status from /api/model/status (separate from /api/system/models)
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [appearance, setAppearance] = useState(
    () => localStorage.getItem("sm_appearance") || "system",
  );
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [autoCloudFallback, setAutoCloudFallback] = useState(
    () => localStorage.getItem("sm_cloud_auto_fallback") !== "false",
  );

  const changeAppearance = (value) => {
    setAppearance(value);
    localStorage.setItem("sm_appearance", value);
    const dark =
      value === "dark" ||
      (value === "system" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", Boolean(dark));
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/app/update`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setUpdateStatus(await res.json());
    } catch (_) {
      setUpdateStatus({ error: "Could not contact the update service." });
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/models`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.installed_models && data.installed_models.length > 0) {
            setModels(data);
          }
        }
      } catch (e) {
        console.error("Failed to fetch models", e);
      }
    };

    const fetchSpecs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/device-specs`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        if (res.ok) {
          const specs = await res.json();
          setDeviceSpecs(specs);
        }
      } catch (e) {
        console.error("Failed to fetch specs", e);
      } finally {
        setLoading(false);
      }
    };

    // Also fetch real-time download status for accuracy
    const fetchDownloadStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/model/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
    const interval = setInterval(() => {
      fetchSpecs();
      fetchDownloadStatus();
      fetchModels();
    }, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const defaultModelList = ["auto", "Qwen/Qwen3-4B-AWQ"];
  const rawSelectable = Array.from(
    new Set([
      ...defaultModelList,
      ...(models.installed_models || []),
      ...(models.downloaded_models || []),
    ]),
  ).filter((m) => !m.startsWith("nomic-embed-text"));

  // Include auto, Qwen3-4B-AWQ, plus any model that is installed, downloaded, or currently downloading
  let savedCloudSelection = null;
  try {
    savedCloudSelection = JSON.parse(
      localStorage.getItem("sm_cloud_selected_models") || "null",
    );
  } catch (_) {}
  const cloudModelValue =
    savedCloudSelection?.provider && savedCloudSelection?.model
      ? `cloud:${savedCloudSelection.provider}:${savedCloudSelection.model}`
      : "";

  let cachedCloudModels = {};
  try {
    cachedCloudModels = JSON.parse(
      localStorage.getItem("sm_cloud_provider_models") || "{}",
    );
  } catch (_) {}
  const cloudOptions = Object.entries(cachedCloudModels).flatMap(
    ([provider, modelList]) =>
      (Array.isArray(modelList) ? modelList : [])
        .filter(
          (model) =>
            provider !== "openrouter" ||
            model === "openrouter/free" ||
            model.endsWith(":free"),
        )
      .map((model) => ({
        value: `cloud:${provider}:${model}`,
        label: `Cloud API - ${provider.toUpperCase()} - ${model} - ${provider === "openai" || provider === "anthropic" ? "BYOK / METERED" : provider === "gemini" ? "ACCOUNT TIER" : "FREE TIER"}`,
      })),
  );

  const selectableModels = rawSelectable.filter((m) => {
    if (m === "auto") return true;
    let st = (models.models_status || {})[m] || {};
    const isActiveDownload =
      downloadStatus && !downloadStatus.ready && downloadStatus.model_id === m;
    const isServedReady =
      downloadStatus?.ready === true && downloadStatus?.model_id === m;
    const isReady =
      st.ready === true ||
      isServedReady ||
      (models.installed_models || []).includes(m) ||
      (models.downloaded_models || []).includes(m);
    return isReady || isActiveDownload || m === "Qwen/Qwen3-4B-AWQ";
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
                {user?.username?.charAt(0) || "U"}
              </div>
              <div>
                <div className="font-black text-zinc-950 dark:text-white text-sm">
                  {user?.username}
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-500 font-semibold flex items-center gap-1.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-zinc-400" />
                  <span>ID: {user?.id}</span>
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Shield className="w-3 h-3" />
              {user?.role === "admin" ? "Admin" : "Staff"}
            </span>
          </div>

          {/* Model Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-black text-zinc-950 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-500" />
              Choose Local or Cloud Model
            </label>
            <div className="space-y-2">
              <select
                value={selectedModel}
                onChange={(e) => onModelChange?.(e.target.value)}
                className="w-full rounded-xl border-2 border-indigo-500/50 bg-zinc-950 px-3 py-3 text-sm font-black text-white outline-none"
              >
                <optgroup label="Local models">
                  {selectableModels.map((m) => (
                    <option key={m} value={m}>
                      {m === "auto" ? "Local · Auto Router" : m}
                    </option>
                  ))}
                </optgroup>
                {cloudOptions.length > 0 && (
                  <optgroup label="Cloud API models">
                    {cloudOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {cloudModelValue &&
                  !cloudOptions.some(
                    (option) => option.value === cloudModelValue,
                  ) && (
                    <optgroup label="Cloud API model">
                      <option value={cloudModelValue}>
                        Cloud API · {savedCloudSelection.provider} ·{" "}
                        {savedCloudSelection.model}
                      </option>
                    </optgroup>
                  )}
              </select>
              <p className="text-[10px] font-semibold text-zinc-500">
                Cloud model appears here after choosing it in Model Hub. The
                chat header always shows whether Local or Cloud API is active.
              </p>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[10px] font-semibold leading-relaxed text-emerald-700 dark:text-emerald-300">
                <p className="font-black">Free-only protection</p>
                <p>
                  OpenRouter shows only verified zero-cost routes. Claude is not
                  assumed free just because it appears in a catalog.
                </p>
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoCloudFallback}
                    onChange={(e) => {
                      setAutoCloudFallback(e.target.checked);
                      localStorage.setItem(
                        "sm_cloud_auto_fallback",
                        String(e.target.checked),
                      );
                    }}
                  />
                  <span>
                    Automatically try another configured free cloud route if a
                    free quota is unavailable.
                  </span>
                </label>
              </div>
            </div>
          </div>
          {/* Appearance & Updates */}
          <div className="space-y-3">
            <label className="block text-xs font-black text-zinc-950 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Appearance
            </label>
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-zinc-900 dark:text-white">
                  Color theme
                </p>
                <p className="text-[10px] text-zinc-500">
                  Choose light, dark, or system theme.
                </p>
              </div>
              <select
                value={appearance}
                onChange={(e) => changeAppearance(e.target.value)}
                className="rounded-xl border border-indigo-400/50 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-black text-zinc-800 dark:text-white outline-none"
              >
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="block text-xs font-black text-zinc-900 dark:text-white">
                  Sidebar position
                </span>
                <span className="mb-2 block text-[10px] text-zinc-500">
                  Move navigation without covering chat.
                </span>
                <select
                  value={sidebarPosition}
                  onChange={(e) => onSidebarPositionChange?.(e.target.value)}
                  className="w-full rounded-xl border border-indigo-400/50 bg-white px-3 py-2 text-xs font-black text-zinc-800 outline-none dark:bg-zinc-900 dark:text-white"
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="block text-xs font-black text-zinc-900 dark:text-white">
                  Performance panel
                </span>
                <span className="mb-2 block text-[10px] text-zinc-500">
                  Choose a side or keep it hidden.
                </span>
                <select
                  value={performancePosition}
                  onChange={(e) =>
                    onPerformancePositionChange?.(e.target.value)
                  }
                  className="w-full rounded-xl border border-indigo-400/50 bg-white px-3 py-2 text-xs font-black text-zinc-800 outline-none dark:bg-zinc-900 dark:text-white"
                >
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                  <option value="hidden">Hidden</option>
                </select>
              </label>
            </div>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-black text-zinc-950 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-indigo-500" /> App Updates
            </label>
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-zinc-900 dark:text-white">
                    Installed: 1.0.0
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Checks only the developer-configured release source.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={checkForUpdates}
                  disabled={checkingUpdate}
                  className="rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-black text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {checkingUpdate ? "Checking…" : "Check for updates"}
                </button>
              </div>
              {updateStatus && (
                <p
                  className={`text-[10px] font-semibold ${updateStatus.error ? "text-rose-400" : "text-zinc-400"}`}
                >
                  {updateStatus.error ||
                    updateStatus.message ||
                    (updateStatus.update_available
                      ? `Version ${updateStatus.latest_version} is available.`
                      : `No newer verified version found. Current: ${updateStatus.current_version}`)}
                </p>
              )}
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
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    GPU
                  </span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">
                    {deviceSpecs.gpu_name || "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    VRAM
                  </span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">
                    {deviceSpecs.gpu_vram_total
                      ? deviceSpecs.gpu_vram_total + " GB"
                      : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    RAM
                  </span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">
                    {deviceSpecs.memory_total_gb
                      ? deviceSpecs.memory_total_gb + " GB"
                      : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    CPU
                  </span>
                  <span className="text-xs font-black text-zinc-950 dark:text-white">
                    {deviceSpecs.cpu_name || "N/A"} (
                    {deviceSpecs.cpu_cores || "N/A"} cores)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    Current GPU Usage
                  </span>
                  <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                    {deviceSpecs.gpu_usage
                      ? deviceSpecs.gpu_usage.toFixed(0) + "%"
                      : "N/A"}
                  </span>
                </div>
              </div>
            </div>
          )}
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
