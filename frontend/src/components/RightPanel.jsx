import React, { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle, Cpu, HardDrive, LayoutDashboard, Shield, Thermometer, Wifi, X, Zap, Gauge, Timer, Rocket } from "lucide-react";
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
const percent = (value, digits = 0) => finite(value) ? `${value.toFixed(digits)}%` : UNAVAILABLE;
const gigabytes = (value, digits = 1) => finite(value) && value >= 0 ? `${value.toFixed(digits)} GB` : UNAVAILABLE;
const rate = (value) => {
  if (!finite(value) || value < 0) return UNAVAILABLE;
  return value >= 1024 ? `${(value / 1024).toFixed(1)} MB/s` : `${value.toFixed(0)} KB/s`;
};
const wsUrl = () => {
  const base = new URL(API_BASE || window.location.origin, window.location.origin);
  return `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}/ws/telemetry`;
};
const browserCapabilities = async () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  let storage = null;
  try { storage = (await navigator.storage?.estimate?.()) || null; } catch { storage = null; }
  return {
    source: "browser",
    logical_processors: positive(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
    memory_class_gb: positive(navigator.deviceMemory) ? navigator.deviceMemory : null,
    storage_used_gb: finite(storage?.usage) ? storage.usage / 1024 ** 3 : null,
    storage_quota_gb: positive(storage?.quota) ? storage.quota / 1024 ** 3 : null,
    connection_type: cleanText(connection?.effectiveType),
    estimated_downlink_mbps: positive(connection?.downlink) ? connection.downlink : null,
  };
};
const emptyHistory = () => ({ CPU: [], Memory: [], Disk: [], Network: [], GPU: [] });
const addSample = (items, value) => finite(value) ? [...items, Math.max(0, value)].slice(-60) : items;

let lastKnownTelemetryStats = null;

const RightPanel = ({ selectedModel, showPanel, onClose, position = "right" }) => {
  const isCloudExecution = Boolean(selectedModel?.startsWith("cloud:"));
  const [stats, setStats] = useState(() => lastKnownTelemetryStats);
  const [connectionState, setConnectionState] = useState(() => (lastKnownTelemetryStats ? "telemetry" : "connecting"));
  const [lastUpdated, setLastUpdated] = useState(() => (lastKnownTelemetryStats ? new Date() : null));
  const [selectedMetric, setSelectedMetric] = useState("CPU");
  const [history, setHistory] = useState(emptyHistory);

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
      // Preserve inference stats if backend returned zeros but we had real data
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

    // Listen for real-time inference updates pushed from ChatArea stream
    const handleInferenceUpdate = (e) => {
      if (disposed || !e.detail) return;
      const d = e.detail;
      lastKnownTelemetryStats = { ...lastKnownTelemetryStats, ...d };
      setStats(prev => ({ ...prev, ...d }));
    };
    window.addEventListener('smaran-inference-update', handleInferenceUpdate);

    const fetchDirectTelemetry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/telemetry`);
        if (res.ok) {
          const payload = await res.json();
          applyTelemetry(payload);
        }
      } catch {
        // Handled by polling and fallback timer
      }
    };

    const showBrowserFallback = async () => {
      if (disposed || receivedTelemetry) return;
      const profile = await browserCapabilities();
      if (disposed || receivedTelemetry) return;
      setStats(profile);
      setConnectionState("browser");
      setLastUpdated(new Date());
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
          if (!receivedTelemetry) {
            fetchDirectTelemetry();
          }
          reconnectTimer = window.setTimeout(connectWebSocket, 4000);
        };
        socket.onerror = () => {
          socket?.close();
        };
      } catch {
        fetchDirectTelemetry();
      }
    };

    // 1. Fetch immediately via REST endpoint for 0ms latency display
    fetchDirectTelemetry();

    // 2. Start WebSocket connection for high-frequency 1s push
    connectWebSocket();

    // 3. Fallback active HTTP polling every 2s in case WebSockets are blocked
    pollingTimer = window.setInterval(fetchDirectTelemetry, 2000);

    // 4. Only show browser-only fallback if no telemetry after 8 seconds
    fallbackTimer = window.setTimeout(showBrowserFallback, 8000);

    return () => {
      disposed = true;
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollingTimer);
      window.removeEventListener('smaran-inference-update', handleInferenceUpdate);
      socket?.close();
    };
  }, [showPanel]);

  const isTelemetry = stats?.source === "telemetry";
  const isLoading = connectionState === "connecting" && !stats;
  const gpuName = isTelemetry ? cleanText(stats?.gpu_name) : "";
  const gpuAvailable = Boolean(isTelemetry && stats?.gpu_available && gpuName);
  const gpuUsage = gpuAvailable && finite(stats?.gpu_usage) ? stats.gpu_usage : null;
  const gpuVramUsed = gpuAvailable && finite(stats?.gpu_vram_used) ? stats.gpu_vram_used : null;
  const gpuVramTotal = gpuAvailable && positive(stats?.gpu_vram_total) ? stats.gpu_vram_total : null;
  const gpuTemperature = gpuAvailable && finite(stats?.gpu_temperature) ? stats.gpu_temperature : null;
  const vramPercent = positive(gpuVramTotal) && finite(gpuVramUsed)
    ? Math.min(100, Math.max(0, gpuVramUsed / gpuVramTotal * 100)) : null;
  const allGpus = isTelemetry && Array.isArray(stats?.gpus) ? stats.gpus : [];
  const gpus = allGpus.filter(g => g.has_live_metrics !== false || allGpus.length === 1);
  const gpuCount = gpus.length;

  const metricCards = useMemo(() => {
    if (!stats) return [];
    if (!isTelemetry) {
      const logical = positive(stats.logical_processors)
        ? String(stats.logical_processors) + ' logical processors reported by browser'
        : 'Logical processor count unavailable';
      const memory = positive(stats.memory_class_gb)
        ? 'Browser memory class: approximately ' + String(stats.memory_class_gb) + ' GB (not installed RAM)'
        : 'Browser memory class unavailable';
      const storage = positive(stats.storage_quota_gb)
        ? gigabytes(stats.storage_used_gb) + ' used of ' + gigabytes(stats.storage_quota_gb) + ' browser quota'
        : 'Browser storage quota unavailable';
      const network = positive(stats.estimated_downlink_mbps)
        ? 'Estimated downlink: ' + stats.estimated_downlink_mbps.toFixed(1) + ' Mbps' + (stats.connection_type ? ' (' + stats.connection_type + ')' : '')
        : 'Connection estimate unavailable';
      return [
        { id: 'CPU', label: 'CPU', sub: logical + '; live usage unavailable', icon: Cpu },
        { id: 'Memory', label: 'Memory', sub: memory + '; live usage unavailable', icon: LayoutDashboard },
        { id: 'Disk', label: 'Browser storage', sub: storage, icon: HardDrive },
        { id: 'Network', label: 'Network', sub: network + '; live throughput unavailable', icon: Wifi },
      ];
    }
    const cpu = [
      'Usage ' + percent(stats.cpu_usage),
      positive(stats.cpu_cores) ? stats.cpu_cores + ' physical cores' : 'physical cores unavailable',
      positive(stats.cpu_threads) ? stats.cpu_threads + ' logical threads' : 'logical threads unavailable',
    ].join(' / ');
    const memory = positive(stats.memory_total_gb)
      ? gigabytes(stats.memory_used_gb) + ' used of ' + gigabytes(stats.memory_total_gb) + ' (' + percent(stats.memory_usage) + ')'
      : 'Usage ' + percent(stats.memory_usage) + '; total RAM unavailable';
    const disk = positive(stats.disk_total_gb)
      ? gigabytes(stats.disk_used_gb) + ' used of ' + gigabytes(stats.disk_total_gb) + '; activity ' + percent(stats.disk_usage)
      : 'Activity ' + percent(stats.disk_usage) + '; capacity unavailable';
    return [
      { id: 'CPU', label: 'CPU', sub: cpu, icon: Cpu },
      { id: 'Memory', label: 'Memory', sub: memory, icon: LayoutDashboard },
      { id: 'Disk', label: 'Local runtime storage', sub: disk, icon: HardDrive },
      { id: 'Network', label: 'Network', sub: 'Down ' + rate(stats.net_down_kb) + ' / Up ' + rate(stats.net_up_kb), icon: Wifi },
    ];
  }, [isTelemetry, stats]);

  const activeCard = metricCards.find((item) => item.id === selectedMetric) || metricCards[0];
  const activeHistory = history[selectedMetric] || [];
  const activeChartMax = selectedMetric === 'Network' ? Math.max(1, ...activeHistory) : 100;
  const statusLabel = connectionState === 'telemetry' ? 'Live telemetry'
    : connectionState === 'reconnecting' ? 'Reconnecting'
      : connectionState === 'browser' ? 'Browser only' : 'Connecting';

  return (
    <>
      {showPanel && <div className='xl:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm' onClick={onClose} />}
      <aside className={[
        'flex-col overflow-hidden select-none shrink-0 relative transition-all duration-300',
        position === 'left' ? 'xl:order-1 border-r border-zinc-200 dark:border-zinc-900' : 'xl:order-3 border-l border-zinc-200 dark:border-zinc-900',
        'bg-[#f8f9fa] dark:bg-[#131314]',
        showPanel
          ? 'xl:flex xl:w-[330px] xl:static xl:z-auto fixed ' + (position === 'left' ? 'left-0' : 'right-0') + ' top-0 bottom-0 w-[330px] max-w-[92vw] z-50 flex shadow-2xl xl:shadow-none'
          : 'hidden',
      ].join(' ')}>
        <div className='p-4 border-b border-zinc-200 dark:border-zinc-900 shrink-0 bg-white/90 dark:bg-zinc-950/40 backdrop-blur-md flex items-start justify-between animate-lightning-border'>
          <div>
            <h2 className='text-sm font-black tracking-widest text-orange-900 dark:text-orange-300 uppercase flex items-center gap-1.5 glow-text'>
              <Shield className='w-4 h-4' /> SMARAN.AI
            </h2>
            <p className='text-[10px] text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider mt-0.5'>
              {isTelemetry ? 'Local system performance' : 'Browser capability summary'}
            </p>
          </div>
          {onClose && <button onClick={onClose} className='p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-all cursor-pointer' title='Close performance panel'><X className='w-4 h-4' /></button>}
        </div>

        <div className='flex-1 overflow-y-auto p-3 flex flex-col gap-3'>
          <div className='flex items-center justify-between px-1 gap-2'>
            <span className='text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest'>
              {isTelemetry ? 'Reported by local SMARAN service' : isLoading ? 'Connecting to sensors...' : 'Browser capability summary'}
            </span>
            <span className={'flex items-center gap-1 text-[9px] font-extrabold px-2 py-0.5 rounded-full border whitespace-nowrap ' + (
              connectionState === 'telemetry'
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-500/20 border-emerald-500/30'
                : connectionState === 'browser'
                  ? 'text-amber-900 dark:text-amber-200 bg-amber-500/20 border-amber-500/30'
                  : 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/15 border-indigo-500/30 animate-pulse'
            )}>
              <CheckCircle className='w-2.5 h-2.5' /> {statusLabel}
            </span>
          </div>

          {isLoading && (
            <div className='rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-3.5 space-y-2 text-left animate-in fade-in duration-200'>
              <div className='flex items-center justify-between'>
                <span className='text-[11px] font-black text-indigo-700 dark:text-indigo-300 flex items-center gap-2'>
                  <span className='w-2 h-2 rounded-full bg-indigo-500 animate-ping' />
                  Querying Hardware Telemetry...
                </span>
                <span className='text-[10px] font-mono text-indigo-400 font-bold'>Live sync</span>
              </div>
              <div className='h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden'>
                <div className='h-full w-2/3 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse' />
              </div>
            </div>
          )}

          {connectionState === 'browser' && !isTelemetry && (
            <div className='rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200'>
              Live CPU, RAM, disk, network, and GPU sensors are establishing connection. Showing browser hardware capabilities in the interim.
            </div>
          )}

          {isTelemetry && (
            <div className='rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 space-y-2 text-left'>
              <div className='flex items-center justify-between'>
                <span className='text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1.5'>
                  <Gauge className='w-3.5 h-3.5 text-emerald-500' /> Live AI Inference Throughput
                </span>
                <span className='text-[9px] font-mono text-emerald-600 dark:text-emerald-400 font-bold'>Real-Time</span>
              </div>
              <div className='grid grid-cols-2 gap-1.5 pt-1'>
                <StatCard label='Tokens / sec' value={positive(stats.tokens_per_sec) ? `${stats.tokens_per_sec.toFixed(1)} tok/s` : 'Ready'} />
                <StatCard label='Response time' value={positive(stats.response_time_ms) ? `${(stats.response_time_ms / 1000).toFixed(2)} s` : '0.0 s'} />
                <StatCard label='Avg speed' value={positive(stats.avg_tokens_per_sec) ? `${stats.avg_tokens_per_sec.toFixed(1)} tok/s` : 'Ready'} />
                <StatCard label='Total tokens' value={positive(stats.total_tokens) ? stats.total_tokens.toLocaleString() : '0'} />
              </div>
            </div>
          )}

          {gpuAvailable ? (
            <>
              {gpus.map((gpu, idx) => {
                const hasLive = gpu.has_live_metrics !== false;
                const usage = hasLive && finite(gpu.usage) ? gpu.usage : null;
                const vramUsed = hasLive && finite(gpu.vram_used_gb) ? gpu.vram_used_gb : null;
                const vramTotal = positive(gpu.vram_total_gb) ? gpu.vram_total_gb : null;
                const temp = hasLive && finite(gpu.temperature) && gpu.temperature > 0 ? gpu.temperature : null;
                const vPct = positive(vramTotal) && vramUsed !== null ? Math.min(100, Math.max(0, vramUsed / vramTotal * 100)) : null;
                const isPrimary = idx === 0;
                return (
                  <button type='button' key={gpu.index} onClick={() => setSelectedMetric('GPU')}
                    className={'text-left rounded-2xl border p-3 transition-all duration-300 hover:shadow-[0_0_18px_rgba(168,85,247,0.2)] hover:-translate-y-0.5 ' + (selectedMetric === 'GPU' && isPrimary ? 'bg-purple-500/10 border-purple-500/40 shadow-[0_0_18px_rgba(168,85,247,0.35)]' : 'bg-white dark:bg-[#1e1f20]/60 border-zinc-200 dark:border-zinc-800 hover:border-purple-500/30')}>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-1.5'><Zap className='w-3.5 h-3.5 text-purple-500' /><span className='text-[11px] font-black'>GPU {gpu.index}</span></div>
                        <p className='mt-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 break-words'>{gpu.name || gpuName}</p>
                        {gpuCount > 1 && <span className='text-[9px] text-zinc-500 font-bold uppercase tracking-wider'>Device {gpu.index + 1} of {gpuCount}</span>}
                        {!hasLive && <span className='text-[9px] text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider'>Static info only</span>}
                      </div>
                      <span className={'text-[14px] font-black font-mono ' + (hasLive ? 'text-purple-700 dark:text-purple-300' : 'text-zinc-400')}>{hasLive ? percent(usage, 1) : 'N/A'}</span>
                    </div>
                    <div className='mt-2 h-2 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800'>
                      {hasLive && finite(usage) && <div className='h-full bg-purple-500 transition-all duration-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]' style={{ width: Math.min(100, Math.max(0, usage)) + '%' }} />}
                    </div>
                    <div className='mt-2 flex justify-between gap-2 text-[10px] font-mono text-zinc-600 dark:text-zinc-300'>
                      <span>VRAM {vramUsed !== null ? gigabytes(vramUsed) : 'N/A'} / {positive(vramTotal) ? gigabytes(vramTotal) : UNAVAILABLE}</span>
                      {temp && <span className='flex items-center gap-1'><Thermometer className='w-3 h-3' />{temp.toFixed(0)} C</span>}
                    </div>
                    {hasLive && finite(vPct) && <div className='mt-1 h-1.5 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800'><div className='h-full bg-indigo-500 transition-all duration-500 shadow-[0_0_6px_rgba(99,102,241,0.5)]' style={{ width: vPct + '%' }} /></div>}
                  </button>
                );
              })}
            </>
          ) : (
            <div className='rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-3 flex items-start gap-2'>
              <Zap className='w-4 h-4 text-zinc-400 mt-0.5' />
              <div>
                <p className='text-[11px] font-black text-zinc-700 dark:text-zinc-300'>GPU information unavailable</p>
                <p className='text-[9px] text-zinc-500 mt-0.5'>The connected local telemetry service did not report a GPU. Browsers cannot reliably expose GPU model or VRAM.</p>
              </div>
            </div>
          )}
          <div className='grid grid-cols-1 gap-1.5'>
            {metricCards.map((card) => {
              const Icon = card.icon;
               return <button type='button' key={card.id} onClick={() => setSelectedMetric(card.id)}
                 className={'w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-all duration-300 hover:shadow-[0_0_14px_rgba(99,102,241,0.12)] hover:-translate-y-0.5 ' + (selectedMetric === card.id ? 'bg-indigo-500/10 border-indigo-500/35 shadow-[0_0_14px_rgba(99,102,241,0.15)]' : 'bg-white dark:bg-[#1e1f20]/40 border-zinc-200 dark:border-zinc-900')}>
                <div className='min-w-0'>
                  <span className='text-[11px] font-black flex items-center gap-1.5'><Icon className='w-3.5 h-3.5 text-indigo-500' />{card.label}</span>
                  <span className='block text-[9px] text-zinc-700 dark:text-zinc-300 font-semibold mt-0.5 break-words'>{card.sub}</span>
                </div>
                {isTelemetry && <MiniLightningChart data={history[card.id] || []} maxValue={card.id === 'Network' ? Math.max(1, ...(history.Network || [])) : 100} colorKey={card.id} />}
              </button>;
            })}
          </div>

          {isTelemetry && activeCard && <div className='bg-white dark:bg-[#1e1f20]/50 border border-zinc-200 dark:border-zinc-900 rounded-2xl p-3 flex flex-col gap-3'>
            <div className='text-[10px] font-black text-zinc-800 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5'>
              <Activity className='w-3 h-3 text-zinc-400' /> {selectedMetric} - live history
            </div>
            <LightningChart data={activeHistory} maxValue={activeChartMax} colorKey={selectedMetric} />
            <MetricDetails metric={selectedMetric} stats={stats} gpu={{ name: gpuName, usage: gpuUsage, vramUsed: gpuVramUsed, vramTotal: gpuVramTotal, temperature: gpuTemperature }} gpus={gpus} />
            {lastUpdated && <p className='text-[9px] text-zinc-500'>Last sample: {lastUpdated.toLocaleTimeString()}</p>}
          </div>}
        </div>
        <div className='p-4 border-t border-zinc-200 dark:border-zinc-900 bg-white/40 dark:bg-zinc-950/20'>
          <div className='flex items-center gap-2.5'>
            <span className='w-3 h-3 rounded-full bg-orange-500 shadow-[0_0_12px_#f97316]' />
            <span className='text-xs font-black text-zinc-900 dark:text-zinc-200'>{isCloudExecution ? 'Cloud model selected; metrics remain local.' : 'Local model and device status.'}</span>
          </div>
        </div>
      </aside>
    </>
  );
};

const chartPoints = (data, width, height, maxValue) => data.map((value, index) => {
  const x = data.length <= 1 ? width : index / (data.length - 1) * width;
  const y = height - Math.min(maxValue, Math.max(0, value)) / maxValue * height;
  return x + ',' + y;
}).join(' ');

const metricColors = {
  CPU:     { stroke: '#f97316', glow: '#fb923c', fill: 'rgba(249,115,22,0.08)', bg: 'bg-orange-500/5',  border: 'border-orange-500/20', text: 'text-orange-600',   darkText: 'dark:text-orange-400',   mini: 'text-orange-500',   large: 'text-orange-500' },
  Memory:  { stroke: '#06b6d4', glow: '#22d3ee', fill: 'rgba(6,182,212,0.08)',  bg: 'bg-cyan-500/5',    border: 'border-cyan-500/20',  text: 'text-cyan-600',    darkText: 'dark:text-cyan-400',     mini: 'text-cyan-500',    large: 'text-cyan-500' },
  Disk:    { stroke: '#10b981', glow: '#34d399', fill: 'rgba(16,185,129,0.08)', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-600', darkText: 'dark:text-emerald-400',  mini: 'text-emerald-500', large: 'text-emerald-500' },
  Network: { stroke: '#3b82f6', glow: '#60a5fa', fill: 'rgba(59,130,246,0.08)', bg: 'bg-blue-500/5',    border: 'border-blue-500/20',   text: 'text-blue-600',    darkText: 'dark:text-blue-400',     mini: 'text-blue-500',    large: 'text-blue-500' },
  GPU:     { stroke: '#a855f7', glow: '#c084fc', fill: 'rgba(168,85,247,0.08)', bg: 'bg-violet-500/5',  border: 'border-violet-500/20',  text: 'text-violet-600',  darkText: 'dark:text-violet-400',   mini: 'text-violet-500',  large: 'text-violet-500' },
};

const LightningChart = ({ data, maxValue, colorKey }) => {
  const colors = metricColors[colorKey] || metricColors.CPU;
  if (!data.length) return <div className='h-28 rounded-xl bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center text-[10px] text-zinc-500'>Waiting for live samples</div>;
  const points = chartPoints(data, 280, 90, Math.max(1, maxValue));
  const areaPoints = `0,90 ${points} 280,90`;
  
  return (
    <div className='h-28 rounded-xl overflow-hidden bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 relative animate-message-glow transition-all duration-300 hover:border-indigo-500/30 hover:shadow-[0_0_18px_rgba(99,102,241,0.15)]'>
      <svg width='100%' height='100%' viewBox='0 0 280 90' preserveAspectRatio='none' aria-label='Live usage history'>
        <defs>
          <linearGradient id={`gradient-${colorKey}`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={colors.stroke} stopOpacity='0.3' />
            <stop offset='50%' stopColor={colors.stroke} stopOpacity='0.08' />
            <stop offset='100%' stopColor={colors.stroke} stopOpacity='0' />
          </linearGradient>
          <filter id={`glow-${colorKey}`} x='-20%' y='-20%' width='140%' height='140%'>
            <feGaussianBlur stdDeviation='3' result='blur' />
            <feComposite in='SourceGraphic' in2='blur' operator='over' />
          </filter>
          <filter id={`lightning-${colorKey}`} x='-20%' y='-20%' width='140%' height='140%'>
            <feGaussianBlur stdDeviation='1.5' result='blur' />
            <feComposite in='SourceGraphic' in2='blur' operator='over' />
          </filter>
        </defs>
        <polygon fill={`url(#gradient-${colorKey})`} points={areaPoints} />
        <polyline fill='none' stroke={colors.stroke} strokeWidth='2.5' filter={`url(#glow-${colorKey})`} points={points} opacity='0.9' />
        <polyline fill='none' stroke={colors.glow} strokeWidth='1' filter={`url(#lightning-${colorKey})`} points={points} opacity='0.6' />
      </svg>
    </div>
  );
};

const MiniLightningChart = ({ data, maxValue, colorKey }) => {
  const colors = metricColors[colorKey] || metricColors.CPU;
  if (!data.length) return <span className='text-[9px] text-zinc-500'>Waiting for samples</span>;
  const points = chartPoints(data, 74, 26, Math.max(1, maxValue));
  
  return (
    <svg width='74' height='26' className='shrink-0' aria-label='Recent usage chart'>
      <defs>
        <filter id={`mini-glow-${colorKey}`} x='-20%' y='-20%' width='140%' height='140%'>
          <feGaussianBlur stdDeviation='1.5' result='blur' />
          <feComposite in='SourceGraphic' in2='blur' operator='over' />
        </filter>
      </defs>
      <polyline fill='none' stroke={colors.stroke} strokeWidth='1.5' filter={`url(#mini-glow-${colorKey})`} points={points} opacity='0.85' />
      <polyline fill='none' stroke={colors.glow} strokeWidth='0.75' points={points} opacity='0.5' />
    </svg>
  );
};

const StatCard = ({ label, value }) => <div className='flex flex-col bg-zinc-50 dark:bg-zinc-950/30 p-2 rounded-lg border border-zinc-100 dark:border-zinc-900 overflow-hidden'>
  <span className='text-[8px] text-zinc-500 font-bold uppercase tracking-wider'>{label}</span>
  <span className='text-[11px] font-extrabold font-mono mt-0.5 break-words text-zinc-900 dark:text-white'>{value}</span>
</div>;

const MetricDetails = ({ metric, stats, gpu, gpus }) => {
  if (metric === 'GPU') {
    if (gpus && gpus.length > 1) {
      return <div className='flex flex-col gap-2'>
        {gpus.map((g, idx) => {
          const hasLive = g.has_live_metrics !== false;
          return (
            <div key={g.index} className='grid grid-cols-2 gap-1.5 p-2 rounded-xl bg-zinc-50 dark:bg-zinc-950/30 border border-zinc-100 dark:border-zinc-900'>
              <div className='col-span-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest'>GPU {g.index} — {cleanText(g.name) || UNAVAILABLE}</div>
              {!hasLive && <div className='col-span-2 text-[9px] text-amber-600 dark:text-amber-400 font-bold'>Live metrics unavailable — showing static hardware info only</div>}
              <StatCard label='Utilization' value={hasLive ? percent(g.usage, 1) : UNAVAILABLE} />
              <StatCard label='Temperature' value={hasLive && finite(g.temperature) && g.temperature > 0 ? g.temperature.toFixed(0) + ' C' : UNAVAILABLE} />
              <StatCard label='VRAM used' value={hasLive && finite(g.vram_used_gb) ? gigabytes(g.vram_used_gb, 2) : UNAVAILABLE} />
              <StatCard label='VRAM total' value={positive(g.vram_total_gb) ? gigabytes(g.vram_total_gb) : UNAVAILABLE} />
            </div>
          );
        })}
      </div>;
    }
    const hasLive = gpu.has_live_metrics !== false;
    return <div className='grid grid-cols-2 gap-1.5'>
      <StatCard label='Utilization' value={hasLive ? percent(gpu.usage, 1) : UNAVAILABLE} />
      <StatCard label='VRAM used' value={hasLive && finite(gpu.vramUsed) ? gigabytes(gpu.vramUsed, 2) : UNAVAILABLE} />
      <StatCard label='VRAM total' value={positive(gpu.vramTotal) ? gigabytes(gpu.vramTotal) : UNAVAILABLE} />
      <StatCard label='Temperature' value={hasLive && finite(gpu.temperature) && gpu.temperature > 0 ? gpu.temperature.toFixed(0) + ' C' : UNAVAILABLE} />
      <div className='col-span-2'><StatCard label='Device' value={gpu.name || UNAVAILABLE} /></div>
    </div>;
  }
  if (metric === 'CPU') return <div className='grid grid-cols-2 gap-1.5'>
    <StatCard label='Utilization' value={percent(stats.cpu_usage, 1)} />
    <StatCard label='Physical cores' value={positive(stats.cpu_cores) ? stats.cpu_cores : UNAVAILABLE} />
    <StatCard label='Logical threads' value={positive(stats.cpu_threads) ? stats.cpu_threads : UNAVAILABLE} />
    <div className='col-span-2'><StatCard label='Processor' value={cleanText(stats.cpu_name) || UNAVAILABLE} /></div>
  </div>;
  if (metric === 'Memory') {
    const available = positive(stats.memory_total_gb) && finite(stats.memory_used_gb)
      ? Math.max(0, stats.memory_total_gb - stats.memory_used_gb) : null;
    return <div className='grid grid-cols-2 gap-1.5'>
      <StatCard label='In use' value={finite(stats.memory_used_gb) ? gigabytes(stats.memory_used_gb, 2) : UNAVAILABLE} />
      <StatCard label='Total RAM' value={positive(stats.memory_total_gb) ? gigabytes(stats.memory_total_gb) : UNAVAILABLE} />
      <StatCard label='Utilization' value={percent(stats.memory_usage, 1)} />
      <StatCard label='Available' value={finite(available) ? gigabytes(available) : UNAVAILABLE} />
    </div>;
  }
  if (metric === 'Disk') return <div className='grid grid-cols-2 gap-1.5'>
    <StatCard label='Activity' value={percent(stats.disk_usage, 1)} />
    <StatCard label='Capacity' value={positive(stats.disk_total_gb) ? gigabytes(stats.disk_total_gb) : UNAVAILABLE} />
    <StatCard label='Read' value={rate(stats.disk_read_kb)} />
    <StatCard label='Write' value={rate(stats.disk_write_kb)} />
  </div>;
  return <div className='grid grid-cols-2 gap-1.5'>
    <StatCard label='Download' value={rate(stats.net_down_kb)} />
    <StatCard label='Upload' value={rate(stats.net_up_kb)} />
  </div>;
};

export default RightPanel;
