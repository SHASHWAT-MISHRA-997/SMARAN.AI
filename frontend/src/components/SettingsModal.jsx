import React, { useEffect, useState } from "react";
import {
  X,
  Cpu,
  Monitor,
  Sparkles,
} from "lucide-react";
import { API_BASE } from "../context/AuthContext";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const cleanText = (value) => {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && !/^(n\/?a|unknown|not detected|none|null)$/i.test(text) ? text : "";
};
const safeToFixed = (value, digits = 0) => {
  if (!finite(value)) return null;
  try { return value.toFixed(digits); } catch { return null; }
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
  const ua = navigator.userAgent || "";
  const uaPlatform = navigator.userAgentData?.platform || navigator.platform || "";
  let clientOs = cleanText(uaPlatform);
  let clientDevice = "";
  let clientType = "This device";
  if (/Android/i.test(ua)) {
    clientOs = "Android";
    const modelMatch = ua.match(/Android\s+[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i);
    clientDevice = cleanText(modelMatch?.[1] || "");
    clientType = /Mobile/i.test(ua) ? "Phone" : "Tablet";
  } else if (/iPhone/i.test(ua)) {
    clientOs = "iOS";
    clientDevice = "iPhone";
    clientType = "Phone";
  } else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    clientOs = "iPadOS";
    clientDevice = "iPad";
    clientType = "Tablet";
  } else if (/Windows/i.test(ua)) {
    clientOs = "Windows";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    clientOs = "macOS";
  } else if (/Linux/i.test(ua)) {
    clientOs = "Linux";
  }
  return {
    source: "browser",
    client_os: clientOs || null,
    client_device: clientDevice || null,
    client_type: clientType,
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

/**
 * Anonymous usage reporting: what it sends, and the switch to stop it.
 *
 * Deliberately states the full list rather than a vague 'we collect some
 * diagnostics'. Someone who reads this should be able to decide.
 */
/**
 * Google Sign-In needs an OAuth client id, which only the owner of the
 * project can create. Creating it is quick; getting it into the app used to
 * mean setting a system environment variable and restarting, which is why
 * this button never worked for anybody. Pasting it here is enough.
 */
const GoogleSignInSetting = () => {
  const [state, setState] = React.useState(null);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    fetch(`${API_BASE}/api/auth/google/config`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { setState(d); setValue(d?.client_id || ''); })
      .catch(() => setState({ configured: false }));
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch(`${API_BASE}/api/auth/google/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ client_id: value.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.detail === 'string' ? body.detail : 'That was not accepted.');
      }
      setState(body);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
          <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z" />
          <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z" />
          <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
        </svg>
        <h4 className="text-sm font-black text-white">Continue with Google</h4>
        <span className={`ml-auto text-[10px] font-bold ${state.configured ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {state.configured ? 'On' : 'Not set up'}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Paste an OAuth client id to offer Google sign-in. Create one for free in
        the Google Cloud Console under <b className="text-zinc-400">APIs &amp; Services → Credentials</b>,
        choosing <b className="text-zinc-400">Web application</b>. The client secret is
        not needed and is never stored here.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder="1234567890-abc.apps.googleusercontent.com"
          className="flex-1 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 font-mono text-[11px]
                     text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-red-400/50"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-amber-300">{error}</p>}
      {saved && !error && (
        <p className="mt-2 text-[11px] text-emerald-400">
          Saved. The button appears on the sign-in panel from now on.
        </p>
      )}
    </div>
  );
};

const PrivacyReporting = () => {
  const [info, setInfo] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    fetch(`${API_BASE}/api/usage-reporting`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  if (!info) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/usage-reporting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !info.enabled }),
      });
      setInfo(await response.json());
    } catch { /* leave the switch as it was */ }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="block text-xs font-black text-zinc-900 dark:text-white">
            Anonymous usage reporting
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
            {info.configured
              ? 'Counts installations and launches so the app can be improved. Nothing you type is ever included.'
              : 'This build does not report anything.'}
          </span>
        </div>
        {info.configured && (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              info.enabled ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-700'
            }`}
            aria-pressed={info.enabled}
            aria-label="Toggle anonymous usage reporting"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                info.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        )}
      </div>

      {info.configured && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Sent</p>
            <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-zinc-500">
              {info.collected.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-wider text-rose-500">Never sent</p>
            <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-zinc-500">
              {info.never_collected.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
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
  const [catalogModels, setCatalogModels] = useState([]);
  const [deviceSpecs, setDeviceSpecs] = useState(null);
  const [clientSpecs, setClientSpecs] = useState(null);
  const [telemetryState, setTelemetryState] = useState("connecting");
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

    const fetchCatalog = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models/catalog`, {
          headers: {  },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.catalog && data.catalog.length > 0) {
            setCatalogModels(data.catalog);
          }
        }
      } catch (e) {
        console.error("Failed to fetch catalog", e);
      }
    };

    fetchModels();
    fetchCatalog();

    const interval = setInterval(() => {
      fetchModels();
      fetchCatalog();
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
      if (disposed) return;
      setClientSpecs(capabilities);
      if (!receivedTelemetry) {
        setDeviceSpecs(null);
        setTelemetryState("browser");
      }
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

    showBrowserFallback();
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
  let cachedCloudModels = {};
  try {
    cachedCloudModels = JSON.parse(
      localStorage.getItem("sm_cloud_provider_models") || "{}",
    );
  } catch {}

  const cloudOptions = Object.entries(cachedCloudModels || {}).flatMap(([provider, modelIds]) =>
    (Array.isArray(modelIds) ? modelIds : []).filter(Boolean).map((modelId) => ({
      value: `cloud:${provider}:${modelId}`,
      label: `Provider-confirmed - ${provider} - ${modelId}`,
    })),
  );

  const downloadedList = Array.from(new Set([
    ...(models.installed_models || []),
    ...(models.downloaded_models || []),
    ...(catalogModels
      .filter((m) => m.is_downloaded)
      .map((m) => m.id)
    ),
  ])).filter((m) => m && !m.startsWith("nomic-embed-text") && m !== "auto");

  const allLocalOptions = [
    { id: "auto", label: "Local - Auto (available runtime only)" },
    ...downloadedList.map((m) => ({
      id: m,
      label: `Installed local model - ${m}`,
    })),
  ];

  return (
    <div className="settings-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 safe-area-bottom safe-area-top">
      <div className="settings-modal-card w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl mobile-rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-left flex min-h-0 flex-col">
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
        <div className="settings-modal-body p-6 space-y-6 min-h-0 flex-1 overflow-y-auto overscroll-contain mobile-modal-scroll mobile-p-4">
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
                className="w-full rounded-xl border-2 border-indigo-500/50 bg-white dark:bg-zinc-950 px-3 py-3 text-sm font-black text-zinc-900 dark:text-white outline-none cursor-pointer"
              >
                <optgroup label="Local models">
                  {allLocalOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
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
            {/* Usage reporting. Shown plainly and switchable, because
                collecting anything without saying so is both wrong and, under
                the DPDP Act and the GDPR, unlawful. */}
            <GoogleSignInSetting />
            <PrivacyReporting />

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
          <DeviceSummary specs={deviceSpecs} clientSpecs={clientSpecs} state={telemetryState} />
        </div>

        {/* Footer */}
        <div className="settings-modal-footer px-6 py-4 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end mobile-px-4 mobile-py-3 shrink-0">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 transition-all cursor-pointer mobile-full-width mobile-py-3 mobile-text-sm"
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

const ClientSummary = ({ specs }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-200">
      <Monitor className="w-3.5 h-3.5 text-indigo-500" /> This device
    </div>
    {/* Only the two facts the browser reports reliably. Capacity "classes"
        (memory class, storage quota, logical processors) were coarse browser
        approximations that read as wrong hardware, so they are not shown; the
        real numbers come from host telemetry below. */}
    <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
      <SpecRow label="Operating system" value={cleanText(specs?.client_os) || "Not reported"} />
    </div>
  </div>
);

const DeviceSummary = ({ specs, clientSpecs, state }) => {
  const isTelemetry = specs?.source === "telemetry";
  const status = state === "telemetry"
    ? "Live local telemetry"
    : state === "reconnecting"
      ? "Reconnecting to local telemetry"
      : state === "browser"
        ? "Browser capabilities only"
        : "Connecting to local telemetry";

  if (!specs) return (
    <div className="space-y-6">
      <ClientSummary specs={clientSpecs} />
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950">
        Host runtime telemetry: {status}. No server hardware values are being presented as this browser device.
      </div>
    </div>
  );

  if (!isTelemetry) return <ClientSummary specs={clientSpecs || specs} />;

  const gpuName = specs.gpu_available ? cleanText(specs.gpu_name) : "";
  const cpuName = cleanText(specs.cpu_name);
  const cpuDetails = [
    cpuName || "Processor name unavailable",
    positive(specs.cpu_cores) ? specs.cpu_cores + " physical cores" : "physical cores unavailable",
    positive(specs.cpu_threads) ? specs.cpu_threads + " logical threads" : "logical threads unavailable",
  ].join(" / ");
  return (
    <div className="space-y-6">
      <ClientSummary specs={clientSpecs} />
      <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-200">
          <Monitor className="w-3.5 h-3.5 text-indigo-500" /> Host runtime telemetry
        </div>
        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">{status}</span>
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        These values describe the computer running the SMARAN service, not necessarily the phone or browser viewing this page. The source is reported by the runtime.
      </p>
      <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-900 dark:bg-zinc-950">
        <SpecRow label="GPU" value={gpuName || "Unavailable"} />
        <SpecRow label="VRAM" value={gpuName && positive(specs.gpu_vram_total) ? `${safeToFixed(specs.gpu_vram_total, 1)} GB` : "Unavailable"} />
        <SpecRow label="GPU utilization" value={gpuName && finite(specs.gpu_usage) ? `${safeToFixed(specs.gpu_usage, 0)}%` : "Unavailable"} />
        <SpecRow label="RAM" value={positive(specs.memory_total_gb) ? `${safeToFixed(specs.memory_total_gb, 1)} GB` : "Unavailable"} />
        <SpecRow label="Memory utilization" value={finite(specs.memory_usage) ? `${safeToFixed(specs.memory_usage, 0)}%` : "Unavailable"} />
        <SpecRow label="CPU" value={cpuDetails} />
        <SpecRow label="CPU utilization" value={finite(specs.cpu_usage) ? `${safeToFixed(specs.cpu_usage, 0)}%` : "Unavailable"} />
      </div>
      </div>
    </div>
  );
};

export default SettingsModal;
