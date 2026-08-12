import React, { useEffect, useState, useRef } from "react";
import {
  Cpu,
  HardDrive,
  Wifi,
  Shield,
  LayoutDashboard,
  Terminal,
  CheckCircle,
  X,
  Thermometer,
  Activity,
  Zap,
} from "lucide-react";
import { API_BASE } from "../context/AuthContext";

const RightPanel = ({
  token,
  selectedModel,
  showPanel,
  onClose,
  position = "right",
}) => {
  const isCloudExecution = Boolean(selectedModel?.startsWith("cloud:"));
  const [stats, setStats] = useState(null);
  const [connected, setConnected] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState("CPU"); // default to CPU, will switch to GPU if available
  const [history, setHistory] = useState({
    CPU: Array(60).fill(0),
    Memory: Array(60).fill(0),
    Disk: Array(60).fill(0),
    WiFiUp: Array(60).fill(0),
    WiFiDown: Array(60).fill(0),
    GPU: Array(60).fill(0),
  });

  const wsRef = useRef(null);

  useEffect(() => {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsHost = window.location.host;
    if (API_BASE && API_BASE.startsWith("http")) {
      const url = new URL(API_BASE);
      wsHost = url.host;
    }
    const wsUrl = `${wsProto}//${wsHost}/ws/telemetry`;

    const connectWS = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setStats(data);

          setHistory((prev) => {
            const nextCPU = [...prev.CPU.slice(1), data.cpu_usage || 0];
            const nextMemory = [
              ...prev.Memory.slice(1),
              data.memory_usage || 0,
            ];
            const nextDisk = [...prev.Disk.slice(1), data.disk_usage || 0];
            const nextWiFiUp = [...prev.WiFiUp.slice(1), data.net_up_kb || 0];
            const nextWiFiDown = [
              ...prev.WiFiDown.slice(1),
              data.net_down_kb || 0,
            ];
            const nextGPU = [...prev.GPU.slice(1), data.gpu_usage || 0];
            return {
              CPU: nextCPU,
              Memory: nextMemory,
              Disk: nextDisk,
              WiFiUp: nextWiFiUp,
              WiFiDown: nextWiFiDown,
              GPU: nextGPU,
            };
          });

          // Auto-switch to GPU tab if GPU becomes available
          if (data.gpu_available && selectedMetric === "CPU") {
            setSelectedMetric("GPU");
          }
        } catch (e) {
          console.error("Telemetry parse error:", e);
        }
      };

      ws.onerror = () => setConnected(false);

      ws.onclose = () => {
        setConnected(false);
        setTimeout(() => {
          if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
            connectWS();
          }
        }, 3000);
      };
    };

    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ── Mini sparkline chart (60-point history) ───────────────────────────────
  const renderMiniChart = (
    data,
    colorClass = "stroke-indigo-500",
    maxVal = 100,
  ) => {
    const w = 80,
      h = 28;
    const pts = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - (maxVal > 0 ? v / maxVal : 0) * h;
        return `${x},${y}`;
      })
      .join(" ");
    return (
      <svg
        width={w}
        height={h}
        className="overflow-visible select-none pointer-events-none shrink-0"
      >
        <polyline
          fill="none"
          strokeWidth="1.5"
          className={colorClass}
          points={pts}
        />
      </svg>
    );
  };

  // ── Large area chart (detail view) ───────────────────────────────────────
  const renderLargeChart = (
    data,
    colorClass = "stroke-indigo-500 fill-indigo-500/10",
    maxVal = 100,
  ) => {
    const w = 280,
      h = 100;
    const gridLines = [];
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * h;
      gridLines.push(
        <line
          key={`h${i}`}
          x1="0"
          y1={y}
          x2={w}
          y2={y}
          stroke="currentColor"
          className="text-zinc-200 dark:text-zinc-800"
          strokeDasharray="3,3"
        />,
      );
    }
    for (let i = 1; i < 7; i++) {
      const x = (i / 7) * w;
      gridLines.push(
        <line
          key={`v${i}`}
          x1={x}
          y1="0"
          x2={x}
          y2={h}
          stroke="currentColor"
          className="text-zinc-200 dark:text-zinc-800"
          strokeDasharray="3,3"
        />,
      );
    }
    const pts = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - (maxVal > 0 ? v / maxVal : 0) * h;
        return `${x},${y}`;
      })
      .join(" ");
    const areaPts = `0,${h} ${pts} ${w},${h}`;
    const [strokeCls, fillCls] = colorClass.split(" ");
    return (
      <div
        className="relative bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-xl overflow-hidden"
        style={{ height: 120 }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="select-none"
        >
          {gridLines}
          <polygon
            className={fillCls || "fill-indigo-500/10"}
            points={areaPts}
          />
          <polyline
            fill="none"
            strokeWidth="2"
            className={strokeCls}
            points={pts}
          />
        </svg>
        {/* Y-axis labels */}
        <div className="absolute right-2 top-1 text-[9px] font-mono text-zinc-400 dark:text-zinc-600">
          100%
        </div>
        <div className="absolute right-2 bottom-1 text-[9px] font-mono text-zinc-400 dark:text-zinc-600">
          0%
        </div>
      </div>
    );
  };

  const formatSpeed = (kbps) => {
    if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
    return `${(kbps || 0).toFixed(0)} KB/s`;
  };

  // ── Live values ───────────────────────────────────────────────────────────
  const cpuVal = stats?.cpu_usage ?? 0;
  const memVal = stats?.memory_usage ?? 0;
  const memUsed = stats?.memory_used_gb ?? 0;
  const memTotal = stats?.memory_total_gb ?? 32;
  const diskVal = stats?.disk_usage ?? 0; // I/O activity % — matches Task Manager
  const diskSpacePct = stats?.disk_space_pct ?? 0; // disk space used %
  const diskUsedGB = stats?.disk_used_gb ?? 0;
  const diskTotalGB = stats?.disk_total_gb ?? 0;
  const diskRead = stats?.disk_read_kb ?? 0;
  const diskWrite = stats?.disk_write_kb ?? 0;
  const netUp = stats?.net_up_kb ?? 0;
  const netDown = stats?.net_down_kb ?? 0;
  const gpuVal = stats?.gpu_usage ?? 0;
  const gpuVramUsed = stats?.gpu_vram_used ?? 0;
  const gpuVramTotal = stats?.gpu_vram_total ?? 16;
  const gpuTemp = stats?.gpu_temperature ?? 0;
  const gpuAvailable = stats?.gpu_available ?? false;
  // GPU name: live from telemetry, or fallback
  const gpuName = gpuAvailable ? (stats?.gpu_name ?? "N/A") : "No GPU Detected";
  const gpuShortName =
    gpuName
      .replace("NVIDIA GeForce ", "")
      .replace("NVIDIA ", "")
      .replace(" Laptop GPU", "")
      .trim() || "RTX 5060 Ti";

  // Model info synced live from hardware_config.json → backend → WS
  const modelDisplayName = stats?.model_display_name ?? "";
  const ctxWindow = stats?.ctx_window ?? 0;
  const reasoningModel = stats?.reasoning_model ?? false;

  // Colour for GPU temperature
  const tempColor =
    gpuTemp === 0
      ? "text-zinc-400 dark:text-zinc-500"
      : gpuTemp < 60
        ? "text-emerald-600 dark:text-emerald-400"
        : gpuTemp < 80
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  // VRAM fill %
  const vramPct =
    gpuVramTotal > 0 ? Math.min(100, (gpuVramUsed / gpuVramTotal) * 100) : 0;

  const TABS = [
    {
      id: "GPU",
      label: `GPU (${gpuShortName})`,
      sub: `${gpuVal.toFixed(0)}% • VRAM ${gpuVramUsed.toFixed(1)}/${gpuVramTotal.toFixed(0)} GB`,
      icon: (
        <Zap className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
      ),
      chartData: history.GPU,
      chartColor: "stroke-purple-500",
      activeClasses:
        "bg-purple-500/10 border-purple-500/30 text-purple-800 dark:text-purple-300",
    },
    {
      id: "CPU",
      label: "CPU",
      sub: `${cpuVal.toFixed(0)}% Util · ${stats?.cpu_cores ?? 8} Cores / ${stats?.cpu_threads ?? 16} Threads`,
      icon: (
        <Cpu className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
      ),
      chartData: history.CPU,
      chartColor: "stroke-indigo-500",
      activeClasses:
        "bg-indigo-500/10 border-indigo-500/30 text-indigo-800 dark:text-indigo-300",
    },
    {
      id: "Memory",
      label: "Memory",
      sub: `${memUsed.toFixed(1)} / ${memTotal.toFixed(0)} GB (${memVal.toFixed(0)}%)`,
      icon: (
        <LayoutDashboard className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
      ),
      chartData: history.Memory,
      chartColor: "stroke-blue-500",
      activeClasses:
        "bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300",
    },
    {
      id: "Disk",
      label: "Disk (C:)",
      sub: `Activity: ${diskVal.toFixed(0)}%  Space: ${diskUsedGB.toFixed(0)}/${diskTotalGB.toFixed(0)} GB (${diskSpacePct.toFixed(0)}%)  R:${formatSpeed(diskRead)} W:${formatSpeed(diskWrite)}`,
      icon: (
        <HardDrive className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
      ),
      chartData: history.Disk,
      chartColor: "stroke-amber-500",
      activeClasses:
        "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300",
    },
    {
      id: "WiFi",
      label: "Network",
      sub: `↓ ${formatSpeed(netDown)} ↑ ${formatSpeed(netUp)}`,
      icon: (
        <Wifi className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
      ),
      chartData: history.WiFiDown,
      chartColor: "stroke-emerald-500",
      activeClasses:
        "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300",
    },
  ];

  const activeTab = TABS.find((t) => t.id === selectedMetric) || TABS[0];

  return (
    <>
      {/* Mobile overlay */}
      {showPanel && (
        <div
          className="xl:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={[
          "flex-col overflow-hidden select-none shrink-0 relative transition-all duration-300",
          position === "left"
            ? "xl:order-1 border-r border-zinc-200 dark:border-zinc-900"
            : "xl:order-3 border-l border-zinc-200 dark:border-zinc-900",
          "bg-[#f8f9fa] dark:bg-[#131314]",
          showPanel
            ? `xl:flex xl:w-[310px] xl:static xl:z-auto fixed ${position === "left" ? "left-0" : "right-0"} top-0 bottom-0 w-[310px] z-50 flex shadow-2xl xl:shadow-none`
            : "hidden",
        ].join(" ")}
      >
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-[200px] h-[200px] rounded-full blur-[80px] bg-indigo-500/5 dark:bg-indigo-500/10 pointer-events-none z-0" />
        <div className="absolute bottom-0 left-0 w-[200px] h-[200px] rounded-full blur-[80px] bg-purple-500/5 dark:bg-purple-500/10 pointer-events-none z-0" />

        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-900 shrink-0 z-10 relative bg-white/90 dark:bg-zinc-950/40 backdrop-blur-md flex items-start justify-between">
          <div>
            <h2 className="text-sm font-black tracking-widest text-orange-600 dark:text-orange-500 uppercase flex items-center gap-1.5">
              <Shield className="w-4.5 h-4.5 text-orange-600 dark:text-orange-500 shrink-0 filter drop-shadow-xs" />
              SMARAN.AI
            </h2>
            <p className="text-[10px] text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider mt-0.5">
              {isCloudExecution
                ? "Cloud API execution — local device telemetry"
                : "Local System Performance Matrix"}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 z-10 relative flex flex-col gap-3">
          {/* Section label + live indicator */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest">
              Performance — Task Manager
            </span>
            <span
              className={`flex items-center gap-1 text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                connected
                  ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20 animate-pulse"
                  : "text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <CheckCircle className="w-2.5 h-2.5" />
              {connected ? "Live Sync" : "Connecting…"}
            </span>
          </div>

          {/* ── GPU HERO CARD (only visible when GPU is detected) ── */}
          {gpuAvailable && (
            <div
              className={`rounded-2xl border p-3 transition-all cursor-pointer ${
                selectedMetric === "GPU"
                  ? "bg-purple-500/10 border-purple-500/30"
                  : "bg-white dark:bg-[#1e1f20]/60 border-zinc-200 dark:border-zinc-800 hover:border-purple-300 dark:hover:border-purple-800"
              }`}
              onClick={() => setSelectedMetric("GPU")}
            >
              {/* GPU header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                  <span className="text-[11px] font-black text-zinc-800 dark:text-zinc-200">
                    GPU
                  </span>
                  <span
                    className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold truncate max-w-[130px]"
                    title={gpuName}
                  >
                    {gpuShortName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {gpuTemp > 0 && (
                    <span
                      className={`flex items-center gap-0.5 text-[10px] font-extrabold font-mono ${tempColor}`}
                    >
                      <Thermometer className="w-3 h-3" />
                      {gpuTemp.toFixed(0)}°C
                    </span>
                  )}
                  <span className="text-[13px] font-black text-purple-700 dark:text-purple-300 font-mono">
                    {gpuVal.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* GPU utilization bar */}
              <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${gpuVal}%`,
                    background:
                      gpuVal > 80
                        ? "linear-gradient(90deg,#a855f7,#ec4899)"
                        : "linear-gradient(90deg,#7c3aed,#a855f7)",
                  }}
                />
              </div>

              {/* VRAM row */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  VRAM
                </span>
                <span className="text-[10px] font-extrabold text-zinc-800 dark:text-zinc-200 font-mono">
                  {gpuVramUsed.toFixed(1)} / {gpuVramTotal.toFixed(0)} GB
                </span>
              </div>

              {/* VRAM bar */}
              <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${vramPct}%`,
                    background:
                      vramPct > 85
                        ? "linear-gradient(90deg,#f59e0b,#ef4444)"
                        : "linear-gradient(90deg,#6366f1,#7c3aed)",
                  }}
                />
              </div>

              {/* Sparkline */}
              <div className="w-full">
                {renderMiniChart(history.GPU, "stroke-purple-500", 100)}
              </div>
            </div>
          )}

          {/* ── No GPU Info Banner ── */}
          {!gpuAvailable && (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-zinc-400" />
              <div>
                <span className="text-[11px] font-black text-zinc-600 dark:text-zinc-400">
                  GPU — Not Detected
                </span>
                <p className="text-[9px] text-zinc-500 dark:text-zinc-500 mt-0.5">
                  CPU-only inference mode active
                </p>
              </div>
            </div>
          )}

          {/* ── Resource Tab List (CPU / Memory / Disk / Network) ── */}
          <div className="grid grid-cols-1 gap-1.5">
            {TABS.filter((t) =>
              gpuAvailable ? t.id !== "GPU" : t.id !== "GPU",
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedMetric(tab.id)}
                className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                  selectedMetric === tab.id
                    ? tab.activeClasses
                    : "bg-white dark:bg-[#1e1f20]/40 border-zinc-200 dark:border-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-900/30"
                }`}
              >
                <div className="flex flex-col text-left">
                  <span className="text-[11px] font-black flex items-center gap-1.5">
                    {tab.icon}
                    {tab.label}
                  </span>
                  <span className="text-[9px] text-zinc-500 dark:text-zinc-400 font-bold mt-0.5 font-mono">
                    {tab.sub}
                  </span>
                </div>
                {renderMiniChart(
                  tab.chartData,
                  tab.chartColor,
                  tab.id === "WiFi" ? Math.max(...tab.chartData, 10) : 100,
                )}
              </button>
            ))}
          </div>

          {/* ── Detail Chart (selected metric) ── */}
          <div className="bg-white dark:bg-[#1e1f20]/50 border border-zinc-200 dark:border-zinc-900 rounded-2xl p-3 flex flex-col gap-3">
            <div className="text-[10px] font-black text-zinc-800 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-zinc-400" />
              {activeTab.label} — 60s History
            </div>

            {/* Area chart */}
            {gpuAvailable &&
              selectedMetric === "GPU" &&
              renderLargeChart(
                history.GPU,
                "stroke-purple-500 fill-purple-500/10",
                100,
              )}
            {selectedMetric === "CPU" &&
              renderLargeChart(
                history.CPU,
                "stroke-indigo-500 fill-indigo-500/10",
                100,
              )}
            {selectedMetric === "Memory" &&
              renderLargeChart(
                history.Memory,
                "stroke-blue-500 fill-blue-500/10",
                100,
              )}
            {selectedMetric === "Disk" &&
              renderLargeChart(
                history.Disk,
                "stroke-amber-500 fill-amber-500/10",
                100,
              )}
            {selectedMetric === "WiFi" &&
              renderLargeChart(
                history.WiFiDown,
                "stroke-emerald-500 fill-emerald-500/10",
                Math.max(...history.WiFiDown, 50),
              )}

            {/* Detail stats grid */}
            <div className="grid grid-cols-2 gap-1.5">
              {selectedMetric === "GPU" && (
                <>
                  <StatCard
                    label="GPU Utilization"
                    value={`${gpuVal.toFixed(1)}%`}
                  />
                  <StatCard
                    label="VRAM Used"
                    value={`${gpuVramUsed.toFixed(2)} GB`}
                  />
                  <StatCard
                    label="VRAM Total"
                    value={`${gpuVramTotal.toFixed(0)} GB`}
                  />
                  <StatCard
                    label="Temperature"
                    value={gpuTemp > 0 ? `${gpuTemp.toFixed(0)} °C` : "N/A"}
                    valueClass={tempColor}
                  />
                  <div className="col-span-2">
                    <StatCard label="Device" value={gpuName} />
                  </div>
                  {modelDisplayName && (
                    <div className="col-span-2 flex flex-col bg-indigo-50 dark:bg-indigo-950/20 p-2 rounded-lg border border-indigo-200 dark:border-indigo-900 gap-1">
                      <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">
                        AI Model — Live Sync
                      </span>
                      <span className="text-[10px] font-extrabold text-indigo-900 dark:text-indigo-200 truncate">
                        {modelDisplayName}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-bold text-indigo-400 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md shadow-[0_0_8px_rgba(99,102,241,0.2)]">
                          {ctxWindow && ctxWindow > 0
                            ? ctxWindow >= 1000
                              ? `${Math.round(ctxWindow / 1000)}K Context Window`
                              : `${ctxWindow} Context Window`
                            : "32K Context Window"}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            reasoningModel
                              ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                              : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {reasoningModel ? "✓ Reasoning" : "⊘ Instruct"}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {selectedMetric === "CPU" && (
                <>
                  <StatCard
                    label="Utilization"
                    value={`${cpuVal.toFixed(1)}%`}
                  />
                  <StatCard
                    label="Physical Cores"
                    value={stats?.cpu_cores ?? 8}
                  />
                  <StatCard
                    label="Logical Threads"
                    value={stats?.cpu_threads ?? 16}
                  />
                  <div className="col-span-2">
                    <StatCard
                      label="Processor"
                      value={stats?.cpu_name || "Detecting…"}
                    />
                  </div>
                </>
              )}

              {selectedMetric === "Memory" && (
                <>
                  <StatCard label="In Use" value={`${memUsed.toFixed(2)} GB`} />
                  <StatCard
                    label="Total RAM"
                    value={`${memTotal.toFixed(0)} GB`}
                  />
                  <StatCard
                    label="Utilization"
                    value={`${memVal.toFixed(1)}%`}
                  />
                  <StatCard
                    label="Available"
                    value={`${(memTotal - memUsed).toFixed(1)} GB`}
                  />
                </>
              )}

              {selectedMetric === "Disk" && (
                <>
                  <StatCard
                    label="Disk Usage"
                    value={`${diskVal.toFixed(1)}%`}
                  />
                  <StatCard
                    label="Total Space"
                    value={`${(stats?.disk_total_gb ?? 0).toFixed(0)} GB`}
                  />
                  <StatCard label="Read Speed" value={formatSpeed(diskRead)} />
                  <StatCard
                    label="Write Speed"
                    value={formatSpeed(diskWrite)}
                  />
                </>
              )}

              {selectedMetric === "WiFi" && (
                <>
                  <StatCard label="Download" value={formatSpeed(netDown)} />
                  <StatCard label="Upload" value={formatSpeed(netUp)} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-900 z-10 shrink-0 bg-white/40 dark:bg-zinc-950/20 backdrop-blur-xs">
          <div className="flex items-center gap-2.5">
            <div className="relative flex shrink-0">
              <span className="w-3 h-3 rounded-full bg-[#f97316] shadow-[0_0_12px_#f97316] dark:shadow-[0_0_15px_#f97316] animate-ping absolute" />
              <span className="w-3 h-3 rounded-full bg-[#f97316] relative border border-white/20" />
            </div>
            <span className="text-xs font-black text-zinc-900 dark:text-zinc-200">
              Hello, I am here to help you.
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};

// ── Small stat tile ──────────────────────────────────────────────────────────
const StatCard = ({ label, value, valueClass = "" }) => (
  <div className="flex flex-col bg-zinc-50 dark:bg-zinc-950/30 p-2 rounded-lg border border-zinc-100 dark:border-zinc-900 overflow-hidden">
    <span className="text-[8px] text-zinc-500 dark:text-zinc-500 font-bold uppercase tracking-wider">
      {label}
    </span>
    <span
      className={`text-[11px] font-extrabold font-mono mt-0.5 truncate ${valueClass || "text-zinc-900 dark:text-white"}`}
    >
      {value}
    </span>
  </div>
);

export default RightPanel;
