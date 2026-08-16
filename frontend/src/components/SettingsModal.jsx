import React, { useEffect, useState } from "react";
import {
  X,
  Cpu,
  Monitor,
  Sparkles,
  Smartphone,
  Lock,
} from "lucide-react";
import { API_BASE } from "../context/AuthContext";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const cleanText = (value) => {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && !/^(n\/?a|unknown|not detected|none|null)$/i.test(text) ? text : "";
};
const settingsTelemetryUrl = () => {
  const base = new URL(API_BASE || window.location.origin, window.location.origin);
  return `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}/ws/telemetry`;
};
const settingsBrowserCapabilities = async () => {
  let storage = null;
  try {
    storage = (await navigator.storage?.estimate?.()) || null;
  } catch {
    storage = null;
  }
  return {
    source: "browser",
    logical_processors: positive(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : null,
    memory_class_gb: positive(navigator.deviceMemory)
      ? navigator.deviceMemory
      : null,
    storage_quota_gb: positive(storage?.quota)
      ? storage.quota / 1024 ** 3
      : null,
  };
};

const SettingsModal = ({
  isOpen,
  onClose,
  onModelChange,
  selectedModel,
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
  const [telemetryState, setTelemetryState] = useState("connecting");
  // Real-time download status from /api/model/status (separate from /api/system/models)
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [appearance, setAppearance] = useState(
    () => localStorage.getItem("sm_appearance") || "system",
  );
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

  useEffect(() => {
    if (!isOpen) return;

    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/models`, {
          headers: {  },
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

    // Also fetch real-time download status for accuracy
    const fetchDownloadStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/model/status`, {
          headers: {  },
        });
        if (res.ok) {
          const data = await res.json();
          setDownloadStatus(data);
        }
      } catch {}
    };

    fetchModels();
    fetchDownloadStatus();

    const interval = setInterval(() => {
      fetchDownloadStatus();
      fetchModels();
    }, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let disposed = false;
    let socket = null;
    let retryTimer = null;
    let fallbackTimer = null;
    let receivedTelemetry = false;

    const fetchInitialTelemetry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/telemetry`);
        if (res.ok) {
          const payload = await res.json();
          if (!disposed && payload && typeof payload === "object") {
            receivedTelemetry = true;
            setDeviceSpecs({ ...payload, source: "telemetry" });
            setTelemetryState("telemetry");
          }
        }
      } catch {
        // ignore and wait for WebSocket or browser fallback
      }
    };
    const showBrowserFallback = async () => {
      const capabilities = await settingsBrowserCapabilities();
      if (disposed || receivedTelemetry) return;
      setDeviceSpecs(capabilities);
      setTelemetryState("browser");
    };
    const connect = () => {
      if (disposed) return;
      setTelemetryState((current) =>
        current === "telemetry" ? "reconnecting" : "connecting",
      );
      try {
        socket = new WebSocket(settingsTelemetryUrl());
      } catch {
        showBrowserFallback();
        return;
      }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload || typeof payload !== "object") return;
          receivedTelemetry = true;
          setDeviceSpecs({ ...payload, source: "telemetry" });
          setTelemetryState("telemetry");
        } catch {
          // Ignore malformed telemetry rather than displaying guessed values.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        setTelemetryState(receivedTelemetry ? "reconnecting" : "browser");
        if (!receivedTelemetry) showBrowserFallback();
        retryTimer = window.setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };

    fetchInitialTelemetry();
    fallbackTimer = window.setTimeout(showBrowserFallback, 2500);
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const defaultModelList = ["auto"];
  const rawSelectable = Array.from(
    new Set([
      ...defaultModelList,
      ...(models.installed_models || []),
      ...(models.downloaded_models || []),
    ]),
  ).filter((m) => !m.startsWith("nomic-embed-text"));

  // Only expose models that the local service actually reports.
  let savedCloudSelection = null;
  try {
    savedCloudSelection = JSON.parse(
      localStorage.getItem("sm_cloud_selected_models") || "null",
    );
  } catch {}
  const cloudModelValue =
    savedCloudSelection?.provider && savedCloudSelection?.model
      ? `cloud:${savedCloudSelection.provider}:${savedCloudSelection.model}`
      : "";

  let cachedCloudModels = {};
  try {
    cachedCloudModels = JSON.parse(
      localStorage.getItem("sm_cloud_provider_models") || "{}",
    );
  } catch {}
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
    return isReady || isActiveDownload;
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
                className="w-full rounded-xl border-2 border-indigo-500/50 bg-white dark:bg-zinc-950 px-3 py-3 text-sm font-black text-zinc-900 dark:text-white outline-none"
              >
                <optgroup label="Local models">
                  {selectableModels.map((m) => (
                    <option key={m} value={m}>
                      {m === "auto" ? "Local - Auto Router" : m}
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
                        Cloud API - {savedCloudSelection.provider} -{" "}
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
          <DeviceSummary specs={deviceSpecs} state={telemetryState} />
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

const SpecRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4">
    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
      {label}
    </span>
    <span className="text-right text-xs font-black text-zinc-950 dark:text-white break-words">
      {value}
    </span>
  </div>
);

const DeviceSummary = ({ specs, state }) => {
  const isTelemetry = specs?.source === "telemetry";
  const status = state === "telemetry"
    ? "Live local telemetry"
    : state === "reconnecting"
      ? "Reconnecting to local telemetry"
      : state === "browser"
        ? "Browser capabilities only"
        : "Connecting to local telemetry";

  if (!specs) return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-200">
        <Monitor className="w-3.5 h-3.5 text-indigo-500" /> Device information
      </div>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950">
        {status}
      </div>
    </div>
  );

  if (!isTelemetry) return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-200">
        <Monitor className="w-3.5 h-3.5 text-indigo-500" /> Browser capabilities
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200">
        Live hardware telemetry is unavailable. These browser hints are not Task Manager measurements.
      </div>
      <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <SpecRow label="Logical processors" value={positive(specs.logical_processors) ? specs.logical_processors + " reported by browser" : "Unavailable"} />
        <SpecRow label="Memory class" value={positive(specs.memory_class_gb) ? "Approximately " + specs.memory_class_gb + " GB (not installed RAM)" : "Unavailable"} />
        <SpecRow label="Browser storage quota" value={positive(specs.storage_quota_gb) ? specs.storage_quota_gb.toFixed(1) + " GB" : "Unavailable"} />
        <SpecRow label="GPU / VRAM / live usage" value="Unavailable to the browser" />
      </div>
    </div>
  );

  const gpuName = specs.gpu_available ? cleanText(specs.gpu_name) : "";
  const cpuName = cleanText(specs.cpu_name);
  const cpuDetails = [
    cpuName || "Processor name unavailable",
    positive(specs.cpu_cores) ? specs.cpu_cores + " physical cores" : "physical cores unavailable",
    positive(specs.cpu_threads) ? specs.cpu_threads + " logical threads" : "logical threads unavailable",
  ].join(" / ");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-200">
          <Monitor className="w-3.5 h-3.5 text-indigo-500" /> Local runtime telemetry
        </div>
        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">{status}</span>
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        Values are reported by the local SMARAN service. Host-level readings appear when the host telemetry bridge or GPU runtime is available.
      </p>
      <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <SpecRow label="GPU" value={gpuName || "Unavailable"} />
        <SpecRow label="VRAM" value={gpuName && positive(specs.gpu_vram_total) ? specs.gpu_vram_total.toFixed(1) + " GB" : "Unavailable"} />
        <SpecRow label="GPU utilization" value={gpuName && finite(specs.gpu_usage) ? specs.gpu_usage.toFixed(0) + "%" : "Unavailable"} />
        <SpecRow label="RAM" value={positive(specs.memory_total_gb) ? specs.memory_total_gb.toFixed(1) + " GB" : "Unavailable"} />
        <SpecRow label="Memory utilization" value={finite(specs.memory_usage) ? specs.memory_usage.toFixed(0) + "%" : "Unavailable"} />
        <SpecRow label="CPU" value={cpuDetails} />
        <SpecRow label="CPU utilization" value={finite(specs.cpu_usage) ? specs.cpu_usage.toFixed(0) + "%" : "Unavailable"} />
      </div>
    </div>
  );
};

export default SettingsModal;
