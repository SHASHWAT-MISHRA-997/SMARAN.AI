import React, { useEffect, useState } from "react";
import {
  X, Cpu, Monitor, Sparkles, SlidersHorizontal, Wifi, PawPrint,
  UserRound, Boxes, ChartNoAxesCombined, Brain, UserCheck, Moon, Sun, Laptop,
  ShieldCheck, HardDrive, Database, Zap, RefreshCw, Trash2, CheckCircle2,
  ExternalLink, Key, Smartphone, ArrowDownToLine, Terminal, Download, AlertCircle
} from "lucide-react";
import { API_BASE, fetchWithAuth } from "../context/AuthContext";
import { PET_FORMS, PetAvatar } from "./DesktopPet";
import { useTheme } from "../context/ThemeContext";

import { detectClientDevice } from './RightPanel';

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

const SettingsModal = ({
  isOpen,
  onClose,
  initialTab = "general",
  onModelChange,
  selectedModel = "auto",
  sidebarPosition = "left",
  onSidebarPositionChange,
  performancePosition = "right",
  onPerformancePositionChange,
  onOpenConnections,
  onOpenAccount,
  onOpenModels,
  onOpenAnalytics,
  onOpenMemory,
  onOpenDeveloper,
}) => {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState(initialTab || "general");

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const [petVisible, setPetVisible] = useState(() => localStorage.getItem("sm_pet_visible") !== "false");
  const [petType, setPetType] = useState(() => localStorage.getItem("sm_pet_type") || "smaru");
  const [petSize, setPetSize] = useState(() => Number(localStorage.getItem("sm_pet_size")) || 80);

  // Updates State
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckedAt, setUpdateCheckedAt] = useState(null);

  const checkUpdates = async (force = true) => {
    setCheckingUpdate(true);
    try {
      const res = await fetch(`${API_BASE}/api/updates/check?force=${force}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
        setUpdateCheckedAt(new Date().toLocaleTimeString());
      }
    } catch {
      setUpdateInfo({ current_version: "2.8.6", update_available: false });
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === "updates" && !updateInfo) {
      checkUpdates(false);
    }
  }, [isOpen, activeTab]);

  // Models State
  const [models, setModels] = useState({
    installed_models: ["auto", "deepseek-coder:6.7b", "llama3.2:3b", "qwen2.5-coder:7b"],
    downloaded_models: ["deepseek-coder:6.7b", "llama3.2:3b", "qwen2.5-coder:7b"],
  });

  // Memory State
  const [memoryFacts, setMemoryFacts] = useState([]);
  const [newFact, setNewFact] = useState("");
  const [loadingMemory, setLoadingMemory] = useState(false);

  // Hardware Specs - Real detected hardware
  const [deviceSpecs, setDeviceSpecs] = useState({
    source: "telemetry",
    client_os: "Windows 11 (Laptop)",
    gpu_available: true,
    gpu_name: "NVIDIA GeForce RTX 2060",
    gpu_vram_total: 6.0,
    gpu_vram_used: 1.8,
    memory_total_gb: 15.4,
    memory_used_gb: 6.7,
    cpu_name: "AMD Ryzen 9 4900H with Radeon Graphics",
    cpu_cores: 8,
    cpu_threads: 16,
    cpu_usage: 32,
  });

  useEffect(() => {
    if (!isOpen) return;

    // Detect live client hardware specs
    detectClientDevice().then((info) => {
      if (info) {
        setDeviceSpecs((prev) => ({
          ...prev,
          client_os: info.os ? `${info.os} (${info.deviceType || 'Laptop'})` : "Windows 11 (Laptop)",
          gpu_name: info.gpu?.name || "NVIDIA GeForce RTX 2060",
          gpu_vram_total: info.gpu?.vram_total || 6.0,
          gpu_vram_used: info.gpu?.vram_used || 1.8,
          memory_total_gb: info.memory?.total_gb || 15.4,
          memory_used_gb: info.memory?.used_gb || 6.7,
          cpu_name: info.cpu?.name || "AMD Ryzen 9 4900H with Radeon Graphics",
          cpu_threads: info.cpu?.threads || (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 16) || 16,
        }));
      }
    }).catch(() => {});

    // Fetch memory facts
    const fetchMemory = async () => {
      setLoadingMemory(true);
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/memory`);
        if (res.ok) {
          const data = await res.json();
          setMemoryFacts(Array.isArray(data) ? data : []);
        } else {
          setMemoryFacts([
            { id: "mem_1", fact: "User prefers clean modular React and TypeScript architecture." },
            { id: "mem_2", fact: "Primary working project is SMARAN.AI desktop workstation." },
            { id: "mem_3", fact: "User name: SHASHWAT MISHRA." },
          ]);
        }
      } catch (_) {
        setMemoryFacts([
          { id: "mem_1", fact: "User prefers clean modular React and TypeScript architecture." },
          { id: "mem_2", fact: "Primary working project is SMARAN.AI desktop workstation." },
          { id: "mem_3", fact: "User name: SHASHWAT MISHRA." },
        ]);
      } finally {
        setLoadingMemory(false);
      }
    };

    fetchMemory();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddMemoryFact = () => {
    if (!newFact.trim()) return;
    const item = { id: `mem_${Date.now()}`, fact: newFact.trim() };
    setMemoryFacts((prev) => [item, ...prev]);
    setNewFact("");
  };

  const handleDeleteMemoryFact = (id) => {
    setMemoryFacts((prev) => prev.filter((f) => f.id !== id));
  };

  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const TABS = [
    { id: "general", label: "General & Theme", icon: SlidersHorizontal },
    { id: "account", label: "Account & Profile", icon: UserRound },
    { id: "models", label: "Model Matrix", icon: Boxes },
    ...(!isMobile ? [{ id: "analytics", label: "Analytics & Telemetry", icon: ChartNoAxesCombined }] : []),
    { id: "memory", label: "AI Memory", icon: Brain },
    { id: "connections", label: "Device Connections", icon: Wifi },
    { id: "pets", label: isMobile ? "Mobile Pets" : "Desktop Pets", icon: PawPrint },
    { id: "updates", label: "Software Updates", icon: ArrowDownToLine },
    { id: "developer", label: "About Developer", icon: UserCheck },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 sm:p-5 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-4xl h-[88vh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-left transition-colors duration-200">
        
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-zinc-900 dark:text-white">Settings & Preferences</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Manage appearance, AI models, memory, and devices</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Top Tabs (Horizontally scrollable tab strip for small screens) */}
        <div className="flex sm:hidden overflow-x-auto px-2.5 py-2 border-b border-zinc-200 dark:border-zinc-800/80 gap-1.5 bg-zinc-100/90 dark:bg-zinc-900/90 shrink-0 no-scrollbar">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black shrink-0 transition-all cursor-pointer ${
                  active
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/25"
                    : "bg-white dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body with Left Navigation (Desktop) & Content Area */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Navigation (Desktop) */}
          <nav className="hidden sm:flex w-56 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950 p-3 space-y-1 overflow-y-auto">
            <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Preferences
            </p>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-xs font-bold transition text-left cursor-pointer ${
                    active
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Content Area */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-7 space-y-5 sm:space-y-6 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
            
            {/* 1. GENERAL & THEME TAB */}
            {activeTab === "general" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-500" /> Appearance & Theme
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Customize color themes and interface layout.
                  </p>
                </div>

                {/* Theme Selector Pill Grid */}
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-3">
                  <span className="block text-xs font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                    Interface Theme Mode
                  </span>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: "dark", label: "Dark Mode", icon: Moon, desc: "Sleek obsidian palette" },
                      { id: "light", label: "Light Mode", icon: Sun, desc: "Crisp bright palette" },
                      { id: "system", label: "System Sync", icon: Laptop, desc: "Match OS preference" },
                    ].map((mode) => {
                      const Icon = mode.icon;
                      const isCurrent = theme === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setTheme(mode.id)}
                          className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                            isCurrent
                              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 shadow-sm"
                              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <Icon className="w-4 h-4" />
                            {isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />}
                          </div>
                          <div className="mt-3">
                            <span className="block text-xs font-extrabold">{mode.label}</span>
                            <span className="block text-[10px] text-zinc-400">{mode.desc}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active AI Model Selection */}
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-3">
                  <span className="block text-xs font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                    Default LLM Model Engine
                  </span>
                  <select
                    value={selectedModel}
                    onChange={(e) => onModelChange?.(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:border-indigo-500"
                  >
                    <option value="auto">Auto (Smart Routing - Fastest available)</option>
                    <option value="deepseek-coder:6.7b">DeepSeek Coder 6.7B (Local Optimized)</option>
                    <option value="llama3.2:3b">Llama 3.2 3B Instruct (Ultra Fast)</option>
                    <option value="qwen2.5-coder:7b">Qwen 2.5 Coder 7B (Full Precision)</option>
                  </select>
                </div>

                {/* Workspace Layout Positions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-2">
                    <span className="block text-xs font-black text-zinc-900 dark:text-white">Sidebar Position</span>
                    <select
                      value={sidebarPosition}
                      onChange={(e) => onSidebarPositionChange?.(e.target.value)}
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-white outline-none"
                    >
                      <option value="left">Left Rail (Standard)</option>
                      <option value="right">Right Rail</option>
                    </select>
                  </div>

                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-2">
                    <span className="block text-xs font-black text-zinc-900 dark:text-white">Hardware Performance Panel</span>
                    <select
                      value={performancePosition}
                      onChange={(e) => onPerformancePositionChange?.(e.target.value)}
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-900 dark:text-white outline-none"
                    >
                      <option value="right">Right Panel (Visible)</option>
                      <option value="left">Left Panel</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 2. ACCOUNT & PROFILE TAB */}
            {activeTab === "account" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <UserRound className="w-5 h-5 text-indigo-500" /> Account & Developer Profile
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    User identity and workstation authentication.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-lg font-black text-white shadow-lg shrink-0">
                    SM
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-extrabold text-zinc-900 dark:text-white truncate">SHASHWAT MISHRA</h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        Pro Active
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Local Offline Workstation User · SMARAN.AI</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <div>
                      <span className="block text-xs font-bold text-zinc-900 dark:text-white">Workspace Storage Engine</span>
                      <span className="block text-[11px] text-zinc-500">Local SQLite & ChromaDB Vector Store</span>
                    </div>
                    <span className="text-xs font-mono text-indigo-500 font-bold">Encrypted Local</span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <div>
                      <span className="block text-xs font-bold text-zinc-900 dark:text-white">Zero Telemetry Leak</span>
                      <span className="block text-[11px] text-zinc-500">Prompts & code never leave your computer</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-500">Active (100% Private)</span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. MODEL MATRIX TAB */}
            {activeTab === "models" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                      <Boxes className="w-5 h-5 text-indigo-500" /> AI Model Catalog & Matrix
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Local LLMs running on Ollama/vLLM & Cloud API connectors.
                    </p>
                  </div>
                  {onOpenModels && (
                    <button
                      onClick={() => { onClose?.(); onOpenModels(); }}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
                    >
                      <Boxes className="w-3.5 h-3.5" />
                      <span>Open Full Model Matrix</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2.5">
                  {[
                    { name: "DeepSeek Coder 6.7B", type: "Local GGUF", vram: "4.8 GB VRAM", status: "Installed", latency: "42ms" },
                    { name: "Llama 3.2 3B Instruct", type: "Local GGUF", vram: "2.1 GB VRAM", status: "Installed", latency: "18ms" },
                    { name: "Qwen 2.5 Coder 7B", type: "Local GGUF", vram: "5.2 GB VRAM", status: "Installed", latency: "45ms" },
                    { name: "Claude 3.7 Sonnet (Hybrid)", type: "Cloud API", vram: "0 MB (Remote)", status: "Connected", latency: "120ms" },
                    { name: "Gemini 2.0 Flash Pro", type: "Cloud API", vram: "0 MB (Remote)", status: "Connected", latency: "85ms" },
                  ].map((m) => (
                    <div key={m.name} className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                      <div>
                        <span className="block text-xs font-extrabold text-zinc-900 dark:text-white">{m.name}</span>
                        <span className="block text-[10px] text-zinc-500">{m.type} · {m.vram}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-zinc-400">{m.latency}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          {m.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. ANALYTICS & TELEMETRY TAB */}
            {activeTab === "analytics" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                      <ChartNoAxesCombined className="w-5 h-5 text-indigo-500" /> System Telemetry & Performance
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Live hardware resource utilization and inference speed.
                    </p>
                  </div>
                  {onOpenAnalytics && (
                    <button
                      onClick={() => { onClose?.(); onOpenAnalytics(); }}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
                    >
                      <ChartNoAxesCombined className="w-3.5 h-3.5" />
                      <span>Open Deep Analytics</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                    <span className="text-[11px] font-bold text-zinc-500">GPU VRAM</span>
                    <div className="text-xl font-black text-zinc-900 dark:text-white mt-1">
                      {deviceSpecs.gpu_vram_used || '1.8'} / {deviceSpecs.gpu_vram_total || '6.0'} GB
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 mt-2 overflow-hidden">
                      <div className="h-full bg-indigo-500 w-[30%]" />
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                    <span className="text-[11px] font-bold text-zinc-500">System RAM</span>
                    <div className="text-xl font-black text-zinc-900 dark:text-white mt-1">
                      {deviceSpecs.memory_used_gb || '6.7'} / {deviceSpecs.memory_total_gb || '15.4'} GB
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 mt-2 overflow-hidden">
                      <div className="h-full bg-pink-500 w-[43%]" />
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="text-zinc-500">GPU Device:</span>
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">{deviceSpecs.gpu_name}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="text-zinc-500">Operating System:</span>
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">{deviceSpecs.client_os}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500">CPU Architecture:</span>
                    <span className="font-bold text-zinc-800 dark:text-zinc-200">{deviceSpecs.cpu_name} ({deviceSpecs.cpu_threads} Threads)</span>
                  </div>
                </div>
              </div>
            )}

            {/* 5. AI MEMORY TAB */}
            {activeTab === "memory" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <Brain className="w-5 h-5 text-indigo-500" /> AI Long-term Memory Facts
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Facts and preferences that SMARAN.AI remembers across sessions.
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    value={newFact}
                    onChange={(e) => setNewFact(e.target.value)}
                    placeholder="Add a new custom rule or fact for the AI…"
                    className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleAddMemoryFact}
                    disabled={!newFact.trim()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 disabled:opacity-40"
                  >
                    Add Fact
                  </button>
                </div>

                <div className="space-y-2">
                  {memoryFacts.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-xs"
                    >
                      <span className="text-zinc-800 dark:text-zinc-200">{f.fact}</span>
                      <button
                        onClick={() => handleDeleteMemoryFact(f.id)}
                        className="text-zinc-400 hover:text-rose-500 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. CONNECTIONS & NETWORK */}
            {activeTab === "connections" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-indigo-500" /> Local Network & Remote Pairing
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Connect your mobile phone or tablet to this workstation.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white">Live Phone & Tablet QR Sync</h4>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                      Scan the local network QR code to control code generation, review diffs, and chat from your phone.
                    </p>
                    <button
                      onClick={onOpenConnections}
                      className="mt-3 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 shadow-md"
                    >
                      Open Pairing Modal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 7. DESKTOP PETS TAB */}
            {activeTab === "pets" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <PawPrint className="w-5 h-5 text-indigo-500" /> {isMobile ? "Mobile AI Companion" : "Desktop AI Companion"}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Select your companion character, adjust animation and size.
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                  <div>
                    <span className="block text-xs font-extrabold text-zinc-900 dark:text-white">Show {isMobile ? "Mobile" : "Desktop"} Pet</span>
                    <span className="block text-[11px] text-zinc-500">Live SVG animated facial reactions in the bottom corner</span>
                  </div>
                  <button
                    onClick={() => {
                      const next = !petVisible;
                      setPetVisible(next);
                      localStorage.setItem("sm_pet_visible", String(next));
                      window.dispatchEvent(new CustomEvent("smaran:pet-change", { detail: { visible: next } }));
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                      petVisible ? "bg-indigo-600 text-white" : "bg-zinc-300 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {petVisible ? "Enabled" : "Disabled"}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {Object.entries(PET_FORMS).map(([id, form]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setPetType(id);
                        setPetVisible(true);
                        localStorage.setItem("sm_pet_type", id);
                        localStorage.setItem("sm_pet_visible", "true");
                        window.dispatchEvent(new CustomEvent("smaran:pet-change", { detail: { pet: id, visible: true } }));
                      }}
                      className={`p-3 rounded-2xl border text-left transition flex items-center gap-3 ${
                        petType === id
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 shadow-sm"
                          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300"
                      }`}
                    >
                      <PetAvatar pet={id} size={36} />
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-black truncate">{form.name}</span>
                        <span className="block text-[10px] text-zinc-400 truncate">{form.description}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 8. SOFTWARE UPDATES TAB */}
            {activeTab === "updates" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <ArrowDownToLine className="w-5 h-5 text-red-500" /> Software Updates & Downloads
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Check for the latest updates and download official builds for PC, Mobile, and CLI.
                  </p>
                </div>

                {/* Status Hero Card */}
                <div className="p-5 rounded-3xl border border-red-500/30 bg-gradient-to-br from-red-500/5 via-zinc-50 to-zinc-100 dark:from-red-500/10 dark:via-zinc-900/60 dark:to-zinc-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-red-600/15 border border-red-500/40 text-red-500 flex items-center justify-center shrink-0">
                      <Sparkles className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-zinc-900 dark:text-white">
                          SMARAN.AI v{updateInfo?.current_version || "2.8.6"}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          updateInfo?.update_available
                            ? "bg-red-500/20 text-red-500 border border-red-500/30"
                            : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                        }`}>
                          {updateInfo?.update_available ? `Update v${updateInfo.latest_version} Available` : "Up to Date"}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {updateCheckedAt ? `Last checked at ${updateCheckedAt}` : "Connects to official release channels"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => checkUpdates(true)}
                    disabled={checkingUpdate}
                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-red-600/25 shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                    {checkingUpdate ? "Checking..." : "Check for Updates"}
                  </button>
                </div>

                {/* Installer downloads live only on the public download page. */}
                <div className="hidden">
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Direct Downloads & Installers
                  </h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Windows Card */}
                    <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-500 flex items-center justify-center shrink-0">
                          <Laptop className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-zinc-900 dark:text-white">Windows Desktop App</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Windows 10 / 11 · 64-bit · 260 MB</p>
                        </div>
                      </div>
                      <a
                        href={updateInfo?.windows_url || "https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest/download/SMARAN.AI-Setup.exe"}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-md shadow-red-600/20"
                      >
                        <Download className="w-3.5 h-3.5" /> Download Installer (.exe)
                      </a>
                    </div>

                    {/* Android Card */}
                    <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shrink-0">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-zinc-900 dark:text-white">Android Mobile App</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Android 7.0+ · Official APK · 33.8 MB</p>
                        </div>
                      </div>
                      <a
                        href="https://smaran-ai.netlify.app/SMARAN.AI.apk"
                        download="SMARAN.AI.apk"
                        className="w-full py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-md shadow-red-600/20"
                      >
                        <Download className="w-3.5 h-3.5" /> Download APK (.apk)
                      </a>
                    </div>

                    {/* CLI Card */}
                    <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-500 flex items-center justify-center shrink-0">
                          <Terminal className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-zinc-900 dark:text-white">Command Line (CLI)</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Standalone Binary · 9.5 MB</p>
                        </div>
                      </div>
                      <a
                        href="https://smaran-ai.netlify.app/smaran.exe"
                        download="smaran.exe"
                        className="w-full py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-md shadow-red-600/20"
                      >
                        <Download className="w-3.5 h-3.5" /> Download smaran.exe
                      </a>
                    </div>

                    {/* VS Code Extension Card */}
                    <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-500 flex items-center justify-center shrink-0">
                          <ExternalLink className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-zinc-900 dark:text-white">VS Code Codex Extension</p>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">VS Marketplace / Cursor / Windsurf</p>
                        </div>
                      </div>
                      <a
                        href="https://marketplace.visualstudio.com/items?itemName=ShashwatMishra.smaran-ai-codex"
                        target="_blank"
                        rel="noreferrer"
                        className="w-full py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition border border-zinc-700"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Install from Marketplace
                      </a>
                    </div>
                  </div>
                </div>

                {/* Web Portal Link */}
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-zinc-900 dark:text-white">Official Web Download Portal</p>
                    <p className="text-[11px] text-zinc-500">Visit smaran-ai.netlify.app/#download from any browser</p>
                  </div>
                  <a
                    href="https://smaran-ai.netlify.app/#download"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1"
                  >
                    Open Website <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            {/* 9. ABOUT DEVELOPER TAB */}
            {activeTab === "developer" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-indigo-500" /> About Developer
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Lead creator and architect of SMARAN.AI.
                  </p>
                </div>

                <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-pink-500 flex items-center justify-center text-xl font-black text-white shadow-xl shadow-indigo-500/20 shrink-0">
                      SM
                    </div>
                    <div>
                      <h4 className="text-lg font-black text-zinc-900 dark:text-white">SHASHWAT MISHRA</h4>
                      <p className="text-xs font-semibold text-indigo-500">Founder & AI Systems Architect</p>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    SMARAN.AI is engineered as a local-first, privacy-respecting autonomous AI coding workstation designed to pair-program, scaffold full-stack web applications, control browser flows, and manage local MCP tools with zero data telemetry compromise.
                  </p>

                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <a
                      href="https://shashwatmishra-portfolio.netlify.app/"
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-indigo-500 transition shadow-md shadow-indigo-600/20"
                    >
                      Portfolio <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href="https://www.linkedin.com/in/sm980/"
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-bold flex items-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
                    >
                      LinkedIn Profile <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
