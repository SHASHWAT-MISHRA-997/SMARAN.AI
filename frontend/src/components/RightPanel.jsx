import React, { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle, Cpu, HardDrive, LayoutDashboard, Shield, Thermometer, Wifi, X, Zap, Gauge, Timer, Rocket, Battery, Monitor, Sparkles, AlertTriangle, ExternalLink } from "lucide-react";
import { API_BASE } from "../context/AuthContext";

const UNAVAILABLE = "Unavailable";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const cleanText = (value) => {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  if (/^(n\/?a|unknown(\s*cpu)?|not detected|none|null|undefined)$/i.test(text)) return "";
  return text;
};
const safeToFixed = (value, digits = 0) => {
  if (!finite(value)) return null;
  try { return value.toFixed(digits); } catch { return null; }
};
const percent = (value, digits = 0) => {
  const fixed = safeToFixed(value, digits);
  return fixed ? `${fixed}%` : UNAVAILABLE;
};
const gigabytes = (value, digits = 1) => {
  if (!finite(value) || value < 0) return UNAVAILABLE;
  const fixed = safeToFixed(value, digits);
  return fixed ? `${fixed} GB` : UNAVAILABLE;
};
const rate = (value) => {
  if (!finite(value) || value < 0) return UNAVAILABLE;
  try { return value >= 1024 ? `${safeToFixed(value / 1024, 1)} MB/s` : `${safeToFixed(value, 0)} KB/s`; } catch { return UNAVAILABLE; }
};
const wsUrl = () => {
  const base = new URL(API_BASE || window.location.origin, window.location.origin);
  return `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}/ws/telemetry`;
};

/**
 * Detect real device hardware from the browser.
 *
 * A normal web page cannot access Task Manager level data, but modern browsers
 * expose several useful signals:
 *   - GPU renderer name via WEBGL_debug_renderer_info
 *   - NPU / AI accelerator availability via navigator.ml (WebNN)
 *   - CPU logical threads via navigator.hardwareConcurrency
 *   - RAM class (rounded to nearest GB) via navigator.deviceMemory
 *   - Network type (wifi/cellular) via navigator.connection
 *   - Screen dimensions & pixel ratio
 *   - Battery level & charging state via navigator.getBattery
 *   - Manufacturer / model hints from the User-Agent string
 *
 * These are reported honestly — the UI labels them as browser-reported and
 * shows them alongside whatever host telemetry the bridge provides.
 */
/**
 * Turn a raw WebGL renderer string into a plain product name.
 *
 * Browsers report things like
 *   "ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F15), D3D11-32.0.15.8129)"
 * and users only want "NVIDIA GeForce RTX 2060": the PCI device id and driver
 * suffix are noise.
 */
/** True when the page is running inside the packaged desktop window. */
export const isDesktopApp = () =>
  typeof window !== "undefined" &&
  (Boolean(window.pywebview) || / SMARAN\.AI(\/|$)/.test(navigator.userAgent));

export const tidyGpuName = (raw) => {
  if (!raw) return "";
  let name = String(raw);
  name = name.replace(/^ANGLE\s*\(/i, "");
  // Cut the driver/backend tail. Chrome writes it both with and without a
  // comma: "..., D3D11-32.0" and "...Graphics Direct3D11 vs_5_0".
  name = name.split(/[,\s]+(?:Direct3D|D3D|OpenGL|Vulkan|Metal)/i)[0];
  name = name.replace(/\s*[([]0x[0-9a-f]+[)\]]/gi, "");   // PCI device id
  name = name.replace(/\s+(?:vs|ps)_[\d_]+.*$/i, "");      // shader model suffix
  name = name.replace(/[),\s]+$/, "").trim();
  // "NVIDIA, NVIDIA GeForce ..." -> "NVIDIA GeForce ..." (drop the repeat)
  const vendorSplit = name.match(/^(NVIDIA|AMD|Intel|Apple|Qualcomm|ARM|Google),\s*(.+)$/i);
  if (vendorSplit) {
    const [, vendor, rest] = vendorSplit;
    const alreadyNamed = rest.toLowerCase().startsWith(vendor.toLowerCase());
    name = alreadyNamed ? rest : `${vendor} ${rest}`;
  }
  return name.trim();
};

export const detectClientDevice = async () => {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent;
  let os = cleanText(navigator.userAgentData?.platform || navigator.platform || "");
  let deviceName = "";
  // A laptop reports a battery; a desktop tower does not.
  const desktopFormFactor = "Desktop";
  let deviceType = isDesktopApp() ? "SMARAN.AI app" : "Web client";
  let isMobile = false;
  let manufacturer = "";
  let model = "";

  if (/iPhone/i.test(ua)) {
    os = "iOS";
    deviceName = "iPhone";
    deviceType = "Mobile Device";
    isMobile = true;
    manufacturer = "Apple";
    const im = ua.match(/iPhone(\d+[,:]2)/i);
    if (im) model = `iPhone${im[1]}`;
  } else if (/iPad/i.test(ua)) {
    os = "iPadOS";
    deviceName = "iPad";
    deviceType = "Tablet";
    isMobile = true;
    manufacturer = "Apple";
  } else if (/Android/i.test(ua)) {
    os = "Android";
    const match = ua.match(/Android\s+([\d.]+);\s*([^;)]+)/i);
    deviceName = match && match[2] ? match[2].replace(/\s+Build\/.*$/i, "").trim() : "";
    deviceType = /Tablet|Nexus 7|Nexus 10|SM-T|iPad/i.test(ua) ? "Tablet" : "Mobile Device";
    isMobile = true;
    // Android manufacturer from UA (e.g. "samsung", "Xiaomi", "OnePlus", "Google")
    const mfrMatch = ua.match(/Android.*?;\s*([^;\s]+)/i);
    if (mfrMatch && mfrMatch[1]) {
      const raw = mfrMatch[1].trim();
      manufacturer = raw.split(/\s+/)[0].replace(/[^a-zA-Z]/g, "");
      if (manufacturer) manufacturer = manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1);
    }
    if (deviceName) model = deviceName;
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
    deviceType = desktopFormFactor;
    manufacturer = "Apple";
    // Detect Apple Silicon vs Intel
    if (/Intel/i.test(ua)) {
      model = "Mac (Intel)";
    } else {
      model = "Mac (Apple Silicon)";
    }
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = "Windows";
    deviceType = desktopFormFactor;
    manufacturer = ""; // Windows doesn't expose manufacturer via UA
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
    deviceType = desktopFormFactor;
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
    deviceType = desktopFormFactor;
  } else if (/CrOS/i.test(ua)) {
    os = "ChromeOS";
    deviceType = "Chromebook";
    manufacturer = "Google";
  }

  // ── GPU detection via WebGL ──
  let gpu = "";
  let gpuVendor = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { powerPreference: "high-performance" }) ||
               canvas.getContext("webgl", { powerPreference: "high-performance" }) ||
               canvas.getContext("experimental-webgl", { powerPreference: "high-performance" }) ||
               canvas.getContext("webgl2") ||
               canvas.getContext("webgl");
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (renderer) gpu = renderer;
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        // Chromium renders through ANGLE, so this parameter reads
        // "Google Inc. (AMD)" rather than the hardware vendor. Pull the real
        // vendor out of the parentheses and drop the wrapper name; showing
        // "Google Inc." as the GPU vendor is simply wrong.
        if (vendor) {
          const inner = /\(([^)]+)\)/.exec(vendor);
          const candidate = (inner ? inner[1] : vendor).trim();
          gpuVendor = /^(google|microsoft|mozilla|apple computer, inc\.?)$/i.test(candidate) ? "" : candidate;
        }
      }
      if (!gpu) gpu = gl.getParameter(gl.RENDERER) || "";
    }
  } catch (_) {}

  const cleanGpu = tidyGpuName(gpu);

  // ── NPU / AI accelerator detection via WebNN (navigator.ml) ──
  let npuAvailable = false;
  let npuName = "";
  try {
    if (navigator.ml) {
      // Try to create an inference context — this probes whether the device
      // actually has an accessible NPU/AI accelerator.
      const preferredTypes = ["npu", "gpu", "cpu"];
      for (const t of preferredTypes) {
        try {
          const ctx = await navigator.ml.createContext({ deviceType: t });
          if (ctx) {
            npuAvailable = t === "npu";
            npuName = t === "npu" ? "WebNN NPU accelerator" : t === "gpu" ? "WebNN GPU accelerator" : "";
            break;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Chrome 113+ exposes navigator.ml.isNPUAvailablePromise
  try {
    if (!npuAvailable && navigator.ml?.isNPUAvailablePromise) {
      const npuReady = await navigator.ml.isNPUAvailablePromise;
      if (npuReady) {
        npuAvailable = true;
        if (!npuName) npuName = "WebNN NPU (available)";
      }
    }
  } catch (_) {}

  // Fallback: navigator.ai (experimental AI API in Chrome)
  try {
    if (!npuAvailable && navigator.ai) {
      npuAvailable = true;
      if (!npuName) npuName = "Browser AI API (experimental)";
    }
  } catch (_) {}

  // ── CPU logical threads ──
  const threads = Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null;

  // ── RAM class (browsers report the nearest of 0.25, 0.5, 1, 2, 4, 8) ──
  const reportedRam = Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null;

  // ── Network / WiFi connection type ──
  let networkType = "";
  let networkEffectiveType = "";
  let networkDownlink = null;
  let networkRtt = null;
  let isWifi = false;
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      networkType = conn.type || ""; // "wifi", "cellular", "ethernet", "bluetooth", "none"
      networkEffectiveType = conn.effectiveType || ""; // "4g", "3g", "2g", "slow-2g"
      networkDownlink = Number.isFinite(conn.downlink) ? conn.downlink : null;
      networkRtt = Number.isFinite(conn.rtt) ? conn.rtt : null;
      isWifi = networkType === "wifi";
    }
  } catch (_) {}

  // ── Screen dimensions ──
  // Only the CSS pixel grid is knowable here. A physical diagonal cannot be
  // derived from it: CSS pixels are scaled by the display's DPI setting, so the
  // usual "/96" estimate reports a 15.6" laptop as 18.4". No inch value is
  // claimed rather than showing a fabricated one.
  let screenWidth = null;
  let screenHeight = null;
  let pixelRatio = null;
  try {
    screenWidth = window.screen?.width || null;
    screenHeight = window.screen?.height || null;
    pixelRatio = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : null;
  } catch (_) {}

  // ── Battery (async) ──
  let batteryLevel = null;
  let batteryCharging = null;
  try {
    if (navigator.getBattery) {
      const bat = await navigator.getBattery();
      batteryLevel = bat.level >= 0 ? Math.round(bat.level * 100) : null;
      batteryCharging = bat.charging;
    }
  } catch (_) {}

  // A machine that reports a battery is a laptop; a tower reports none. This is
  // the only form-factor signal available, so nothing is claimed without it.
  if (deviceType === desktopFormFactor && batteryLevel != null) {
    deviceType = "Laptop";
  }

  // ── WebGL renderer helps infer GPU vendor ──
  if (!gpuVendor && cleanGpu) {
    const g = cleanGpu.toLowerCase();
    if (g.includes("nvidia") || g.includes("geforce") || g.includes("rtx") || g.includes("gtx")) gpuVendor = "NVIDIA";
    else if (g.includes("amd") || g.includes("radeon")) gpuVendor = "AMD";
    else if (g.includes("intel")) gpuVendor = "Intel";
    else if (g.includes("apple") || g.includes("m1") || g.includes("m2") || g.includes("m3")) gpuVendor = "Apple";
    else if (g.includes("qualcomm") || g.includes("adreno")) gpuVendor = "Qualcomm";
    else if (g.includes("mali")) gpuVendor = "ARM Mali";
  }

  return {
    os: os || "",
    deviceName: deviceName || "",
    deviceType,
    isMobile,
    manufacturer: manufacturer || "",
    model: model || deviceName || "",
    gpu: cleanGpu || "",
    gpuVendor: gpuVendor || "",
    threads,
    ramClassGb: reportedRam,
    npuAvailable,
    npuName: npuName || "",
    networkType: networkType || (isWifi ? "wifi" : ""),
    networkEffectiveType: networkEffectiveType || "",
    networkDownlinkMbps: networkDownlink,
    networkRttMs: networkRtt,
    isWifi,
    screenWidth,
    screenHeight,
    pixelRatio,
    batteryLevel,
    batteryCharging,
    userAgent: ua,
  };
};

const emptyHistory = () => ({ CPU: [], Memory: [], Disk: [], Network: [], GPU: [] });
const addSample = (items, value) => finite(value) ? [...items, Math.max(0, value)].slice(-60) : items;

let lastKnownTelemetryStats = null;

const RightPanel = ({ selectedModel, showPanel, onClose, position = "right" }) => {
  const [clientDevice, setClientDevice] = useState(null);
  const isCloudExecution = Boolean(selectedModel?.startsWith("cloud:"));
  const [stats, setStats] = useState(() => lastKnownTelemetryStats);
  const [connectionState, setConnectionState] = useState(() => (lastKnownTelemetryStats ? "telemetry" : "connecting"));
  const [lastUpdated, setLastUpdated] = useState(() => (lastKnownTelemetryStats ? new Date() : null));
  const [selectedMetric, setSelectedMetric] = useState("CPU");
  const [history, setHistory] = useState(emptyHistory);

  // Detect client device asynchronously (NPU probe, battery, etc.)
  useEffect(() => {
    let cancelled = false;
    detectClientDevice().then((info) => {
      if (!cancelled && info) setClientDevice(info);
    });
    return () => { cancelled = true; };
  }, []);

  // Live battery from the browser. detectClientDevice only samples once, so on
  // its own the level froze at whatever it was when the panel mounted and
  // plugging the charger in or out never showed. The BatteryManager fires
  // these events as the state actually changes.
  const [liveBattery, setLiveBattery] = useState(null);
  useEffect(() => {
    if (!navigator.getBattery) return undefined;
    let manager = null;
    let cancelled = false;

    const publish = () => {
      if (cancelled || !manager) return;
      setLiveBattery({
        level: manager.level >= 0 ? Math.round(manager.level * 100) : null,
        charging: manager.charging,
      });
    };

    navigator.getBattery().then((value) => {
      if (cancelled) return;
      manager = value;
      publish();
      manager.addEventListener('levelchange', publish);
      manager.addEventListener('chargingchange', publish);
    }).catch(() => { /* the API is absent or blocked; telemetry covers it */ });

    return () => {
      cancelled = true;
      if (manager) {
        manager.removeEventListener('levelchange', publish);
        manager.removeEventListener('chargingchange', publish);
      }
    };
  }, []);

  // The host's own reading is authoritative: it is polled with the rest of the
  // telemetry and works in the packaged desktop window, where the browser
  // Battery API is not available at all.
  const batteryLevel = finite(stats?.battery_percent)
    ? Math.round(stats.battery_percent)
    : (liveBattery?.level ?? clientDevice?.batteryLevel ?? null);
  const batteryCharging = typeof stats?.battery_charging === 'boolean'
    ? stats.battery_charging
    : (liveBattery?.charging ?? clientDevice?.batteryCharging ?? null);
  const batteryMinutesLeft = finite(stats?.battery_minutes_left) ? stats.battery_minutes_left : null;

  // Report client device info to the backend so it can enrich telemetry
  useEffect(() => {
    if (!clientDevice) return;
    try {
      fetch(`${API_BASE}/api/client-device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientDevice),
      }).catch(() => {});
    } catch (_) {}
  }, [clientDevice]);

  useEffect(() => {
    if (!showPanel) return undefined;
    let disposed = false;
    let socket = null;
    let reconnectTimer = null;
    let pollingTimer = null;
    let fallbackTimer = null;
    let receivedTelemetry = Boolean(lastKnownTelemetryStats);

    const applyTelemetry = (payload) => {
      if (disposed || !payload || typeof payload !== "object") return;
      receivedTelemetry = true;
      const merged = { ...payload };
      if (!positive(merged.tokens_per_sec) && lastKnownTelemetryStats?.tokens_per_sec > 0) {
        merged.tokens_per_sec = lastKnownTelemetryStats.tokens_per_sec;
      }
      if (!positive(merged.response_time_ms) && lastKnownTelemetryStats?.response_time_ms > 0) {
        merged.response_time_ms = lastKnownTelemetryStats.response_time_ms;
      }
      if (!positive(merged.avg_tokens_per_sec) && lastKnownTelemetryStats?.avg_tokens_per_sec > 0) {
        merged.avg_tokens_per_sec = lastKnownTelemetryStats.avg_tokens_per_sec;
      }
      if (!positive(merged.total_tokens) && lastKnownTelemetryStats?.total_tokens > 0) {
        merged.total_tokens = lastKnownTelemetryStats.total_tokens;
      }
      lastKnownTelemetryStats = merged;
      setStats({ ...merged, source: "telemetry" });
      setConnectionState("telemetry");
      setLastUpdated(new Date());
      setHistory((current) => ({
        CPU: addSample(current.CPU, payload.cpu_usage),
        Memory: addSample(current.Memory, payload.memory_usage),
        Disk: addSample(current.Disk, payload.disk_usage),
        Network: addSample(current.Network, payload.net_down_kb),
        GPU: addSample(current.GPU, payload.gpu_usage),
      }));
    };

    const handleInferenceUpdate = (e) => {
      if (disposed || !e.detail) return;
      const d = e.detail;
      lastKnownTelemetryStats = { ...lastKnownTelemetryStats, ...d };
      setStats((prev) => ({ ...prev, ...d }));
    };
    window.addEventListener("smaran-inference-update", handleInferenceUpdate);

    const fetchDirectTelemetry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/telemetry`);
        if (res.ok) {
          const payload = await res.json();
          applyTelemetry(payload);
        }
      } catch (_) {}
    };

    const connectWebSocket = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(wsUrl());
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            applyTelemetry(payload);
          } catch {}
        };
        socket.onclose = () => {
          if (disposed) return;
          if (!receivedTelemetry) fetchDirectTelemetry();
          reconnectTimer = window.setTimeout(connectWebSocket, 4000);
        };
        socket.onerror = () => {
          socket?.close();
        };
      } catch {
        fetchDirectTelemetry();
      }
    };

    fetchDirectTelemetry();
    connectWebSocket();
    pollingTimer = window.setInterval(fetchDirectTelemetry, 2000);

    return () => {
      disposed = true;
      window.removeEventListener("smaran-inference-update", handleInferenceUpdate);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollingTimer);
      socket?.close();
    };
  }, [showPanel]);

  const isTelemetry = connectionState === "telemetry";
  const isLoading = connectionState === "connecting";

  const isRealGpu = (name) => {
    if (!name || typeof name !== "string") return false;
    const n = name.trim().toLowerCase();
    if (!n || n === "n/a" || n === "none" || n === "no gpu" || n === "null" || n === "undefined" || n === "unavailable") return false;
    if (n.includes("host cpu") || n.includes("unified ram") || n.includes("microsoft basic display") || n.includes("standard graphics") || n.includes("gdi generic")) return false;
    return true;
  };

  const cleanClientGpu = useMemo(() => tidyGpuName(clientDevice?.gpu), [clientDevice]);

  const rawGpuName = cleanText(stats?.gpu_name);
  const realGpuList = Array.isArray(stats?.gpus) ? stats.gpus.filter(g => isRealGpu(g.name)) : [];
  const gpus = realGpuList;
  const gpuName = gpus[0]?.name || rawGpuName || "";
  const gpuUsage = finite(gpus[0]?.usage) ? gpus[0].usage : (finite(stats?.gpu_usage) ? stats.gpu_usage : null);
  const gpuVramUsed = finite(gpus[0]?.vram_used_gb) ? gpus[0].vram_used_gb : (finite(stats?.gpu_vram_used) ? stats.gpu_vram_used : null);
  const gpuVramTotal = positive(gpus[0]?.vram_total_gb) ? gpus[0].vram_total_gb : (positive(stats?.gpu_vram_total) ? stats.gpu_vram_total : null);
  const gpuTemperature = finite(gpus[0]?.temperature) ? gpus[0].temperature : (finite(stats?.gpu_temperature) ? stats.gpu_temperature : null);
  const gpuCount = gpus.length;
  const gpuAvailable = Boolean(gpuName);
  const hasLiveGpuTelemetry = realGpuList.some((gpu) => gpu?.has_live_metrics === true || finite(gpu?.usage) || finite(gpu?.vram_used_gb));
  const telemetrySource = String(stats?.telemetry_source || "");
  const isHostTelemetry = telemetrySource === "host_bridge" || telemetrySource.endsWith("_host_bridge");
  const hostPlatform = cleanText(stats?.host_os) || telemetrySource.replace(/_host_bridge$/, "").replace(/^./, (c) => c.toUpperCase());

  // Detect Windows with no GPU telemetry - show notice to run host bridge natively
  const isWindowsNoGpu = !gpuAvailable && (hostPlatform === "Windows" || hostPlatform === "Linux") && stats?.host_os_display?.toLowerCase().includes("windows");
  const showGpuNotice = isWindowsNoGpu || (!gpuAvailable && isHostTelemetry && hostPlatform === "Linux");

  const metricCards = useMemo(() => {
    const cpuThreads = positive(stats?.cpu_threads) ? stats.cpu_threads : null;
    const cpu = [
      `${isHostTelemetry ? "Host" : "Local runtime"} usage ${percent(stats?.cpu_usage)}`,
      cpuThreads ? `${cpuThreads} logical processors visible` : null,
    ].filter(Boolean).join(" • ");

    const totalRam = positive(stats?.memory_total_gb) ? stats.memory_total_gb : null;
    const usedRam = finite(stats?.memory_used_gb) ? stats.memory_used_gb : null;
    const memory = gigabytes(usedRam) + " / " + gigabytes(totalRam) + " (" + percent(stats?.memory_usage) + ")";

    // The percentage beside used/total is how full the disk is
    // (`disk_space_pct`). `disk_usage` is read/write activity, which is 0 while
    // idle and made a half-full drive read as "(0%)".
    const disk = positive(stats?.disk_total_gb)
      ? gigabytes(stats.disk_used_gb) + " / " + gigabytes(stats.disk_total_gb) + " (" + percent(stats.disk_space_pct) + ")"
      : "Activity " + percent(stats?.disk_usage || 0);

    const network = "Down " + rate(stats?.net_down_kb || 0) + " • Up " + rate(stats?.net_up_kb || 0);

    const gpuSub = hasLiveGpuTelemetry
      ? `Live usage ${percent(gpuUsage)} • ${gigabytes(gpuVramUsed)} / ${gigabytes(gpuVramTotal)} VRAM`
      : (gpuAvailable ? "Browser-reported renderer identity; live usage and VRAM unavailable" : showGpuNotice 
        ? "Windows GPU not detected — run Host Telemetry Bridge natively (see notice below)"
        : "GPU identity and live telemetry unavailable");

    return [
      { id: "CPU", label: cleanText(stats?.cpu_name) || "CPU Processor", sub: cpu, icon: Cpu, glowColor: "from-orange-500/20 via-amber-500/10 to-transparent", borderColor: "border-orange-500/40" },
      { id: "GPU", label: gpuName ? `${hasLiveGpuTelemetry ? "GPU" : "Browser GPU renderer"} (${gpuName})` : (showGpuNotice ? "GPU — Not Detected (Run Host Bridge)" : "GPU Graphics"), sub: gpuSub, icon: Zap, glowColor: "from-purple-500/20 via-pink-500/10 to-transparent", borderColor: "border-purple-500/40" },
      { id: "Memory", label: isHostTelemetry ? "Host RAM Memory" : "System RAM Memory", sub: memory, icon: LayoutDashboard, glowColor: "from-cyan-500/20 via-blue-500/10 to-transparent", borderColor: "border-cyan-500/40" },
      { id: "Disk", label: "Storage Disk", sub: disk, icon: HardDrive, glowColor: "from-emerald-500/20 via-teal-500/10 to-transparent", borderColor: "border-emerald-500/40" },
      { id: "Network", label: "Network I/O", sub: network, icon: Wifi, glowColor: "from-blue-500/20 via-indigo-500/10 to-transparent", borderColor: "border-blue-500/40" },
    ];
  }, [stats, clientDevice, gpuAvailable, gpuName, gpuUsage, gpuVramUsed, gpuVramTotal, hasLiveGpuTelemetry, isHostTelemetry, showGpuNotice]);

  const activeCard = metricCards.find((item) => item.id === selectedMetric) || metricCards[0];
  const activeHistory = history[selectedMetric] || [];
  const activeChartMax = selectedMetric === "Network" ? Math.max(1, ...(history.Network || [])) : 100;
  const statusLabel = connectionState === "telemetry" ? (isHostTelemetry ? "Live host telemetry bridge" : "Live device telemetry")
    : connectionState === "reconnecting" ? "Reconnecting"
    : "Waiting for telemetry";
  const tokenSource = cleanText(stats?.token_measurement_source);
  const hasMeasuredTokens = positive(stats?.tokens_per_sec) && tokenSource && tokenSource !== "unavailable";

  return (
    <>
      {showPanel && <div className="xl:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />}
      <aside
        data-testid="performance-panel"
        aria-label="Device and AI performance"
        aria-hidden={!showPanel}
        inert={!showPanel}
        className={[
        "performance-panel bg-[#f8f9fa]/95 dark:bg-[#131314]/90 backdrop-blur-2xl",
        position === "left" ? "performance-panel-left xl:order-1" : "performance-panel-right xl:order-3",
        showPanel ? "performance-panel-open" : "hidden"
        ].join(" ")}
      >

        {/* Header */}
        <div className="relative px-3 pb-3 pt-5 xl:pt-3 border-b border-zinc-200 dark:border-zinc-900 shrink-0 bg-white/90 dark:bg-zinc-950/40 backdrop-blur-md flex items-start justify-between gap-3">
          {/* Mobile drag handle */}
          <div className="xl:hidden absolute top-2 left-1/2 -translate-x-1/2 flex items-center justify-center" aria-hidden="true">
            <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs sm:text-sm font-black tracking-[0.12em] text-indigo-900 dark:text-indigo-300 uppercase flex items-center gap-1.5 leading-tight">
              <Shield className="w-4 h-4 text-indigo-500 shrink-0" /> <span className="break-words">DEVICE &amp; AI PERFORMANCE</span>
            </h2>
            <p className="performance-copy min-w-0 text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5 flex items-start gap-1 leading-snug">
              <span className="w-1.5 h-1.5 mt-1 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="min-w-0">{statusLabel}</span>
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-all cursor-pointer shrink-0" title="Close performance panel" aria-label="Close performance panel">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="performance-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 flex flex-col gap-2">

          {/* Client identity — browser-reported device web vitals.
              Shows manufacturer, model, OS, GPU, NPU, WiFi, RAM class,
              screen size, battery — everything the browser honestly exposes. */}
          <div className="performance-glass-card glass-deep scanlines hover-lift relative rounded-xl border border-cyan-500/25 p-2.5 text-left">
            <div className="text-[10px] font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 shrink-0" /> <span className="cyber-text">Your Device</span>
            </div>
            {/* Primary identity line */}
            <p className="mt-1 text-[10px] font-bold text-zinc-800 dark:text-zinc-200 break-words">
              {[
                clientDevice?.manufacturer,
                clientDevice?.model || clientDevice?.deviceName,
                clientDevice?.os,
                clientDevice?.deviceType,
              ].filter(Boolean).join(" • ") || "Detecting device..."}
            </p>

            {/* Device spec grid — compact, scannable */}
            {clientDevice && (
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                {clientDevice.threads && (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-zinc-600 dark:text-zinc-400">
                    <Cpu className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                    <span>{clientDevice.threads} CPU threads</span>
                  </div>
                )}
                {/* Exact installed RAM when the host reports it. The browser's
                    own figure is a capped class (always "8" on 16 GB machines),
                    so it is only a last resort. */}
                {(positive(stats?.memory_total_gb) || clientDevice.ramClassGb != null) && (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-zinc-600 dark:text-zinc-400">
                    <LayoutDashboard className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                    <span>
                      {positive(stats?.memory_total_gb)
                        ? `${safeToFixed(stats.memory_total_gb, 1)} GB RAM`
                        : `≥ ${clientDevice.ramClassGb} GB RAM`}
                    </span>
                  </div>
                )}
                {/* This is the adapter the window is *drawn* on, which on a
                    laptop is usually the integrated chip even when a discrete
                    card is present. The machine's real GPU is reported
                    separately from the host, so this is labelled for what it
                    actually is rather than passed off as "the GPU". */}
                {isRealGpu(cleanClientGpu) && (
                  <div
                    className="flex items-center gap-1 text-[9px] font-bold text-zinc-600 dark:text-zinc-400 col-span-2"
                    title="The graphics adapter this window is rendered on. On a laptop this is often the integrated chip, not the discrete card."
                  >
                    <Zap className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                    <span className="text-zinc-400 shrink-0">Display adapter:</span>
                    <span className="break-words min-w-0">
                      {cleanClientGpu}
                      {clientDevice.gpuVendor ? ` (${clientDevice.gpuVendor})` : ""}
                    </span>
                  </div>
                )}
                {/* NPU — the key new field */}
                {clientDevice.npuAvailable ? (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                    <span>NPU: {clientDevice.npuName || "Available"}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-zinc-500 dark:text-zinc-500">
                    <span className="text-zinc-400 shrink-0">NPU:</span>
                    <span>Not available</span>
                  </div>
                )}
                {/* Network — speed class only. The browser cannot see the Wi-Fi
                    band or SSID, so "3G/4G" here is a latency/bandwidth class,
                    never the router's 2.4/5 GHz band. */}
                <div
                  className="flex items-center gap-1 text-[9px] font-bold text-zinc-600 dark:text-zinc-400"
                  title="Connection speed class estimated by the browser. This is not the Wi-Fi band (2.4/5 GHz) and not the network name."
                >
                  <Wifi className={`w-2.5 h-2.5 shrink-0 ${clientDevice.isWifi ? "text-blue-400" : "text-zinc-400"}`} />
                  <span>{clientDevice.isWifi ? "Wi-Fi" : (clientDevice.networkType || "Network")}</span>
                  {clientDevice.networkDownlinkMbps != null ? (
                    <span className="text-zinc-400">• ~{clientDevice.networkDownlinkMbps} Mbps</span>
                  ) : clientDevice.networkEffectiveType ? (
                    <span className="text-zinc-400">• {clientDevice.networkEffectiveType.toUpperCase()}-class speed</span>
                  ) : null}
                </div>
                {/* Battery. Charging state is shown as its own word, not just
                    a bolt glyph, because the glyph alone was easy to miss. */}
                {batteryLevel != null && (
                  <div
                    className="flex items-center gap-1 text-[9px] font-bold text-zinc-600 dark:text-zinc-400"
                    title={
                      batteryCharging
                        ? "Charger connected"
                        : batteryMinutesLeft != null
                          ? `About ${Math.floor(batteryMinutesLeft / 60)}h ${batteryMinutesLeft % 60}m left`
                          : "Running on battery"
                    }
                  >
                    <Battery
                      className={`w-2.5 h-2.5 shrink-0 ${
                        batteryCharging
                          ? "text-emerald-400 animate-pulse"
                          : batteryLevel < 20
                            ? "text-red-400"
                            : "text-zinc-400"
                      }`}
                    />
                    <span className={batteryCharging ? "text-emerald-400" : batteryLevel < 20 ? "text-red-400" : undefined}>
                      {batteryLevel}%
                    </span>
                    {batteryCharging === true && <span className="text-emerald-400">⚡ Charging</span>}
                    {batteryCharging === false && batteryMinutesLeft != null && (
                      <span className="text-zinc-500">
                        {Math.floor(batteryMinutesLeft / 60)}h {batteryMinutesLeft % 60}m left
                      </span>
                    )}
                  </div>
                )}
                {/* Screen resolution — no physical size is claimed, because the
                    browser cannot measure the panel's diagonal. */}
                {clientDevice.screenWidth && clientDevice.screenHeight && (
                  <div
                    className="flex items-center gap-1 text-[9px] font-bold text-zinc-600 dark:text-zinc-400"
                    title="Native screen resolution in device pixels. The physical panel size in inches is not readable from a browser."
                  >
                    <Monitor className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                    {/* Multiply by the device pixel ratio: at 125% Windows
                        scaling a 1920×1080 panel reports 1536×864 CSS pixels,
                        which read as the wrong monitor. */}
                    <span>
                      {Math.round(clientDevice.screenWidth * (clientDevice.pixelRatio || 1))}×
                      {Math.round(clientDevice.screenHeight * (clientDevice.pixelRatio || 1))}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Honest disclaimer */}
            <p className="mt-1.5 text-[8px] leading-relaxed text-zinc-500 dark:text-zinc-500 break-words">
              Detected by your browser. Live CPU/GPU usage & exact VRAM need the host telemetry bridge.
            </p>
          </div>

          {/* Windows GPU Notice — shows when GPU not detected on Windows/Docker Desktop */}
          {showGpuNotice && (
            <div className="performance-glass-card rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-zinc-900/80 to-orange-500/10 p-3 text-left shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <h4 className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                    <span>Windows GPU not detected</span>
                  </h4>
                  <p className="text-[10px] text-zinc-300 leading-relaxed font-semibold">
                    Docker Desktop runs containers in a Linux VM (WSL2) which cannot access your Windows GPU (NVIDIA RTX, AMD, Intel).
                    The host telemetry bridge MUST run natively on Windows to detect your real GPU, VRAM, temperature, and usage.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const url = "https://github.com/shashwatmishra997/SMARAN.AI/blob/main/run-host-telemetry.ps1";
                        window.open(url, "_blank", "noopener,noreferrer");
                      }}
                      className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-black flex items-center gap-1.5 transition-all cursor-pointer"
                      title="View the Windows Host Bridge runner script on GitHub"
                    >
                      <ExternalLink className="w-3 h-3" /> View Host Bridge Script
                    </button>
                    <span className="px-2.5 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-800 text-[9px] font-mono text-zinc-400">
                      run-host-telemetry.ps1
                    </span>
                  </div>
                  <p className="text-[9px] text-zinc-500 leading-relaxed">
                    The installer runs this automatically. For manual docker-compose, run the script once to enable real GPU metrics.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Live AI Model Inference Speed Card */}
          <div className="performance-glass-card rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-transparent p-2.5 space-y-1.5 text-left shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="performance-copy min-w-0 text-[10px] font-black text-indigo-800 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-indigo-500 shrink-0" /> <span className="min-w-0">Active AI Model Speed</span>
              </span>
              <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">
                {hasMeasuredTokens ? "Runtime-reported" : "Awaiting run"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <StatCard label="Tokens / Sec" value={positive(stats?.tokens_per_sec) ? `${safeToFixed(stats.tokens_per_sec, 1)} tok/s` : "No measured run"} />
              <StatCard label="Latency" value={positive(stats?.response_time_ms) ? `${safeToFixed(stats.response_time_ms / 1000, 2)} s` : UNAVAILABLE} />
              <StatCard label="Avg Throughput" value={positive(stats?.avg_tokens_per_sec) ? `${safeToFixed(stats.avg_tokens_per_sec, 1)} tok/s` : "No measured run"} />
              <StatCard label="Session Tokens" value={positive(stats?.total_tokens) ? stats.total_tokens.toLocaleString() : "0"} />
            </div>
          </div>

          {/* Metric Selector Cards with Hover Transitions & RGB Glow */}
          <div className="grid grid-cols-1 gap-1.5">
            {metricCards.map((card) => {
              const Icon = card.icon;
              const isSelected = selectedMetric === card.id;
              return (
            <button
                  data-testid={`performance-metric-${card.id.toLowerCase()}`}
                  type="button"
                  key={card.id}
                  onClick={() => setSelectedMetric(card.id)}
                  className={"performance-metric-card sheen hover-lift w-full flex items-center justify-between gap-2 p-2 rounded-xl border text-left text-zinc-900 dark:text-zinc-100 transition-all duration-300 cursor-pointer relative overflow-hidden " + (
                    isSelected
                      ? `bg-gradient-to-r ${card.glowColor} ${card.borderColor} shadow-[0_0_16px_rgba(99,102,241,0.2)]`
                      : "bg-white dark:bg-[#1e1f20]/40 border-zinc-200 dark:border-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-black flex items-center gap-1.5">
                      <Icon className={"w-3.5 h-3.5 shrink-0 " + (isSelected ? "text-indigo-400" : "text-zinc-500")} /> <span className="performance-copy min-w-0">{card.label}</span>
                    </span>
                    <span className="block text-[9px] text-zinc-600 dark:text-zinc-400 font-semibold mt-0.5 break-words">
                      {card.sub}
                    </span>
                  </div>
                  {isTelemetry && (
                    <MiniLightningChart
                      data={history[card.id] || []}
                      maxValue={card.id === "Network" ? Math.max(1, ...(history.Network || [])) : 100}
                      colorKey={card.id}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Live History Waveform Graph */}
          {isTelemetry && activeCard && (
            <div className="performance-glass-card bg-white/70 dark:bg-[#1e1f20]/50 border border-zinc-200 dark:border-zinc-900 rounded-xl p-2.5 flex flex-col gap-2">
              <div className="text-[10px] font-black text-zinc-800 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-zinc-400" /> {selectedMetric} — {isHostTelemetry ? "Host history" : "Runtime history"}
              </div>
              <LightningChart data={activeHistory} maxValue={activeChartMax} colorKey={selectedMetric} />
              <MetricDetails metric={selectedMetric} stats={stats} gpu={{ name: gpuName, usage: gpuUsage, vramUsed: gpuVramUsed, vramTotal: gpuVramTotal, temperature: gpuTemperature }} gpus={gpus} />
              {lastUpdated && <p className="text-[9px] text-zinc-500">Last updated: {lastUpdated.toLocaleTimeString()}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 shrink-0 border-t border-zinc-200 dark:border-zinc-900 bg-white/95 dark:bg-zinc-950/95">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
            <span className="performance-copy min-w-0 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 leading-snug">
              {isCloudExecution ? "Cloud AI active; device metrics are source-labelled" : (isHostTelemetry ? `Source: ${hostPlatform || "device"} host bridge` : stats?.telemetry_source === "native_runtime" ? "Source: this device" : "Source: unavailable")}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};

const chartPoints = (data, width, height, maxValue) => data.map((value, index) => {
  const x = data.length <= 1 ? width : index / (data.length - 1) * width;
  const y = height - Math.min(maxValue, Math.max(0, value)) / maxValue * height;
  return x + "," + y;
}).join(" ");

const metricColors = {
  CPU: { stroke: "#f97316", glow: "#fb923c", fill: "rgba(249,115,22,0.08)" },
  Memory: { stroke: "#06b6d4", glow: "#22d3ee", fill: "rgba(6,182,212,0.08)" },
  Disk: { stroke: "#10b981", glow: "#34d399", fill: "rgba(16,185,129,0.08)" },
  Network: { stroke: "#3b82f6", glow: "#60a5fa", fill: "rgba(59,130,246,0.08)" },
  GPU: { stroke: "#a855f7", glow: "#c084fc", fill: "rgba(168,85,247,0.08)" },
};

const LightningChart = ({ data, maxValue, colorKey }) => {
  const colors = metricColors[colorKey] || metricColors.CPU;
  if (!data.length) return <div className="h-28 rounded-xl bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center text-[10px] text-zinc-500">Waiting for live samples</div>;
  const points = chartPoints(data, 280, 90, Math.max(1, maxValue));
  const areaPoints = `0,90 ${points} 280,90`;

  return (
    <div className="h-28 rounded-xl overflow-hidden bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 relative">
      <svg width="100%" height="100%" viewBox="0 0 280 90" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`gradient-${colorKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.stroke} stopOpacity="0.3" />
            <stop offset="50%" stopColor={colors.stroke} stopOpacity="0.08" />
            <stop offset="100%" stopColor={colors.stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon fill={`url(#gradient-${colorKey})`} points={areaPoints} />
        <polyline fill="none" stroke={colors.stroke} strokeWidth="2.5" points={points} opacity="0.9" />
      </svg>
    </div>
  );
};

const MiniLightningChart = ({ data, maxValue, colorKey }) => {
  const colors = metricColors[colorKey] || metricColors.CPU;
  if (!data.length) return <span className="performance-mini-chart text-[9px] text-zinc-500 shrink-0">Waiting...</span>;

  // Zoom each series to its own observed band. Against a fixed 0-100 axis a
  // steady 70% memory reading or a 0% disk reading draws as a dead straight
  // line; scaling to the band reveals the real movement. A series that truly
  // does not change stays flat, drawn through the middle rather than pinned to
  // the floor, so "steady" no longer looks like "broken".
  const low = Math.min(...data);
  const high = Math.max(...data);
  const span = high - low;
  const plotted = span > 0.001
    ? data.map((value) => ((value - low) / span) * 80 + 10)
    : data.map(() => 50);
  const points = chartPoints(plotted, 74, 26, 100);
  void maxValue;

  return (
    <svg width="74" height="26" className="performance-mini-chart shrink-0" aria-hidden="true">
      <polyline fill="none" stroke={colors.stroke} strokeWidth="1.5" points={points} opacity="0.85" />
    </svg>
  );
};

const StatCard = ({ label, value }) => (
  <div className="flex flex-col bg-zinc-50 dark:bg-zinc-950/40 p-2 rounded-lg border border-zinc-100 dark:border-zinc-900 overflow-hidden">
    <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider">{label}</span>
    <span className="text-[11px] font-extrabold font-mono mt-0.5 break-words text-zinc-900 dark:text-white">{value}</span>
  </div>
);

const MetricDetails = ({ metric, stats, gpu, gpus }) => {
  if (metric === "GPU") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        <StatCard label="Utilization" value={percent(gpu?.usage, 1)} />
        <StatCard label="VRAM used" value={gigabytes(gpu?.vramUsed, 2)} />
        <StatCard label="VRAM total" value={gigabytes(gpu?.vramTotal, 2)} />
        <StatCard label="Temperature" value={finite(gpu?.temperature) ? `${safeToFixed(gpu.temperature, 0)} °C` : UNAVAILABLE} />
      </div>
    );
  }
  if (metric === "CPU") return (
    <div className="grid grid-cols-2 gap-1.5">
      <StatCard label="Utilization" value={percent(stats?.cpu_usage, 1)} />
        <StatCard label={(stats?.telemetry_source === "host_bridge" || String(stats?.telemetry_source || "").endsWith("_host_bridge")) ? "Physical cores" : "Runtime CPU count"} value={positive(stats?.cpu_cores) ? `${stats.cpu_cores}` : UNAVAILABLE} />
        <StatCard label={(stats?.telemetry_source === "host_bridge" || String(stats?.telemetry_source || "").endsWith("_host_bridge")) ? "Logical threads" : "Runtime threads"} value={positive(stats?.cpu_threads) ? `${stats.cpu_threads}` : UNAVAILABLE} />
      <StatCard label="Source" value={stats?.telemetry_source || UNAVAILABLE} />
    </div>
  );
  if (metric === "Memory") {
    const totalRam = positive(stats?.memory_total_gb) ? stats.memory_total_gb : null;
    const usedRam = finite(stats?.memory_used_gb) ? stats.memory_used_gb : null;
    const available = finite(totalRam) && finite(usedRam) ? Math.max(0, totalRam - usedRam) : null;
    return (
      <div className="grid grid-cols-2 gap-1.5">
        <StatCard label="In use" value={gigabytes(usedRam, 1)} />
        <StatCard label="Total RAM" value={gigabytes(totalRam, 1)} />
        <StatCard label="Utilization" value={percent(stats?.memory_usage, 1)} />
        <StatCard label="Available" value={gigabytes(available, 1)} />
      </div>
    );
  }
  if (metric === "Disk") return (
    <div className="grid grid-cols-2 gap-1.5">
      <StatCard label="Activity" value={percent(stats?.disk_usage, 1)} />
      <StatCard label="Capacity" value={positive(stats?.disk_total_gb) ? gigabytes(stats.disk_total_gb) : UNAVAILABLE} />
      <StatCard label="Read" value={rate(stats?.disk_read_kb)} />
      <StatCard label="Write" value={rate(stats?.disk_write_kb)} />
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <StatCard label="Download" value={rate(stats?.net_down_kb)} />
      <StatCard label="Upload" value={rate(stats?.net_up_kb)} />
    </div>
  );
};

export default RightPanel;
