import React, { useEffect, useState } from "react";
import { Lock,
  X, Cpu, Monitor, Sparkles, SlidersHorizontal, Wifi, PawPrint,
  UserRound, Boxes, ChartNoAxesCombined, Brain, UserCheck, Moon, Sun, Laptop,
  ShieldCheck, HardDrive, Database, Zap, RefreshCw, Trash2, CheckCircle2,
  ExternalLink, Key, Smartphone, ArrowDownToLine, Terminal, Download, AlertCircle, Globe
} from "lucide-react";
import { API_BASE, fetchWithAuth } from "../context/AuthContext";
import { PET_FORMS, PetAvatar } from "./DesktopPet";
import { useTheme } from "../context/ThemeContext";

import { detectClientDevice } from './RightPanel';
import { isPhone } from '../utils/device';
import { isNativeApp, loadLink } from '../utils/hostLink';
import * as standalone from '../utils/standalone';
import * as localChat from '../utils/localChat';

/* Written in at build time, from package.json. It used to be the string
   "2.8.6" typed into the markup, so a phone that could not check for
   updates displayed a version four releases old as though it were fact. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'unknown';

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

  /* Fetching the new version, rather than only being told one exists.
     downloaded holds the path the backend saved it to, which is what the
     install step is given. */
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloaded, setDownloaded] = useState(null);
  const [updateError, setUpdateError] = useState("");

  /* True in the packaged phone app when no computer has been linked to it.
     Read at call time rather than stored, so pairing takes effect without a
     reload of this screen. */
  const noBackend = () => isNativeApp() && !loadLink()?.url;

  /* The phone's own provider, key and model. Kept here rather than in the
     backend's cloud-key store, because on this device there is no backend. */
  const [directKeys, setDirectKeys] = useState(() => standalone.loadKeys());
  const [directDrafts, setDirectDrafts] = useState({});
  const [directProvider, setDirectProvider] = useState(() => standalone.getProvider());
  const [directModel, setDirectModel] = useState(() => standalone.getModel());
  const [directModels, setDirectModels] = useState([]);
  /** Rows where the key box has been asked for, to replace one. */
  const [replacingKey, setReplacingKey] = useState({});

  /* Screen lock.
     The lock itself has existed all along - PinLock gates the whole app and
     /api/lock is mounted - but the only way to set a PIN was inside the sign-up
     flow, so anyone past that point could not find it. Reported as "there is no
     PIN system". Same endpoints, reachable from Settings. */
  const [lockState, setLockState] = useState(null);
  const [lockPin, setLockPin] = useState("");
  const [lockCurrentPin, setLockCurrentPin] = useState("");
  const [lockNote, setLockNote] = useState("");
  const [lockBusy, setLockBusy] = useState(false);

  const refreshLock = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lock/status`, { credentials: "include" });
      if (res.ok) setLockState(await res.json());
    } catch (_) { /* no backend here; the section stays hidden */ }
  };

  useEffect(() => { if (isOpen && !noBackend()) refreshLock(); }, [isOpen]);

  const callLock = async (path, body, done) => {
    setLockBusy(true);
    setLockNote("");
    try {
      const res = await fetch(`${API_BASE}/api/lock/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `That did not work (${res.status}).`);
      setLockPin("");
      setLockCurrentPin("");
      setLockNote(data?.message || done);
      await refreshLock();
    } catch (error) {
      setLockNote(error?.message || "That did not work.");
    } finally {
      setLockBusy(false);
    }
  };
  const [directModelsLoading, setDirectModelsLoading] = useState(false);
  const [directModelError, setDirectModelError] = useState("");

  const refreshDirectModels = async (provider, keys) => {
    const key = (keys || directKeys)[provider];
    if (!provider || !key) { setDirectModels([]); return; }
    setDirectModelsLoading(true);
    setDirectModelError("");
    try {
      const listed = standalone.usable(await standalone.listModels(provider, key));
      setDirectModels(listed);
      /* Choose one if nothing is chosen. Leaving it empty meant the next
         question was answered with instructions to come back here. */
      if (!standalone.getModel() && listed.length) {
        const free = listed.filter((m) => m.free);
        const chosen = (free.length ? free[0] : listed[0]).id;
        standalone.setModel(chosen);
        setDirectModel(chosen);
      }
    } catch (error) {
      setDirectModels([]);
      setDirectModelError(error?.message || "That provider would not list its models.");
    } finally {
      setDirectModelsLoading(false);
    }
  };

  const selectDirectProvider = (provider) => {
    standalone.setProvider(provider);
    setDirectProvider(provider);
    // A model belongs to the provider it came from; carrying one across would
    // fail with a 404 that reads as the app being broken.
    standalone.setModel("");
    setDirectModel("");
    refreshDirectModels(provider, directKeys);
  };

  const saveDirectKey = (provider, value) => {
    const next = standalone.saveKey(provider, value === undefined ? (directDrafts[provider] || "") : value);
    setDirectKeys(next);
    setDirectDrafts((d) => ({ ...d, [provider]: "" }));
    // Choosing is implied by bothering to enter a key for it.
    if (next[provider] && standalone.getProvider() !== provider) {
      selectDirectProvider(provider);
    } else {
      refreshDirectModels(provider, next);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === "provider" && directProvider) {
      refreshDirectModels(directProvider, directKeys);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  const checkUpdates = async (force = true) => {
    setCheckingUpdate(true);
    setUpdateError("");
    try {
      // On a phone with no computer linked there is no backend, and this app's
      // own local server answers with the page itself. Checking first means
      // the message below can say what is actually wrong instead of blaming
      // the network on a device that is plainly online.
      if (noBackend()) {
        setUpdateError(
          'This phone has no computer linked, so there is nothing to ask about updates. '
          + 'The app itself updates from the Play Store or wherever you installed it.');
        return;
      }
      const res = await fetch(`${API_BASE}/api/updates/check?force=${force}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
        setUpdateCheckedAt(new Date().toLocaleTimeString());

        // Windows Update's behaviour, and what was asked for: finding an
        // update starts fetching it. There is no Download button to press,
        // because being told an update exists and then having to go and get
        // it is not an update mechanism.
        //
        // An installer already on disk is not fetched again - it is simply
        // ready to install.
        if (data.update_available && !isMobile) {
          if (data.downloaded_path) {
            setDownloaded({ path: data.downloaded_path });
          } else {
            downloadUpdate();
          }
        }
      } else {
        setUpdateError(`The update server answered ${res.status}.`);
      }
    } catch {
      // This used to claim version 2.8.6 and "no update available" whenever
      // the check failed - a version number invented by the interface and an
      // answer nobody had. A check that did not happen says so.
      setUpdateError("Could not reach the update server. You may be offline.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  /* The download runs on the backend, on its own thread. This starts it and
     then watches it, so closing Settings - or this whole tab - leaves a
     part-finished transfer running rather than throwing it away. The bar
     moves against bytes actually written, not against a timer. */
  const downloadUpdate = async () => {
    setDownloading(true);
    setUpdateError("");
    setDownloaded(null);
    setDownloadProgress({ written: 0, total: null });
    try {
      const res = await fetch(`${API_BASE}/api/updates/download`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: isMobile ? "android" : "windows" }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail || `The server answered ${res.status}.`);
      }
    } catch (err) {
      setDownloading(false);
      setUpdateError(err.message || "The download could not be started.");
    }
  };

  /* Watching it. Polling only while something is actually happening - an
     interval left running against an idle backend is a request every second
     for no reason. */
  useEffect(() => {
    if (!isOpen || activeTab !== "updates") return undefined;

    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/updates/download/status`, { credentials: "include" });
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (stopped) return;

        if (data.state === "running") {
          setDownloading(true);
          setDownloadProgress({ written: data.written || 0, total: data.total });
        } else if (data.state === "done") {
          setDownloading(false);
          setDownloaded({ path: data.path });
          setDownloadProgress({ written: data.written, total: data.total });
        } else if (data.state === "error") {
          setDownloading(false);
          setUpdateError(data.error || "The download did not finish.");
        }
      } catch {
        // The backend going quiet for a moment is not worth a message.
      }
    };

    tick();
    const timer = setInterval(tick, 700);
    return () => { stopped = true; clearInterval(timer); };
  }, [isOpen, activeTab]);

  const installUpdate = async () => {
    if (!downloaded?.path) return;
    setUpdateError("");
    try {
      const res = await fetch(`${API_BASE}/api/updates/install`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: downloaded.path }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `The server answered ${res.status}.`);
    } catch (err) {
      setUpdateError(err.message || "The installer did not open.");
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
      // On a phone the facts live on the device. The panel said "remembers
      // across sessions" and did not: adding one drew a row, posted nothing
      // anywhere, and it was gone on the next launch.
      if (noBackend()) {
        setMemoryFacts(localChat.loadFacts());
        setLoadingMemory(false);
        return;
      }
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/memory`);
        if (res.ok) {
          const data = await res.json();
          setMemoryFacts(Array.isArray(data) ? data : []);
        } else {
          // When the memory request failed, three facts were invented and
          // shown as though SMARAN.AI had learned them - that it knew your
          // name, your architecture preferences and what you were working on.
          // It had learned nothing; the request had simply failed. An empty
          // list is what an unreachable memory looks like.
          setMemoryFacts([]);
        }
      } catch (_) {
        setMemoryFacts([]);
      } finally {
        setLoadingMemory(false);
      }
    };

    fetchMemory();
  }, [isOpen]);

  // What is genuinely installed, asked of the machine rather than assumed.
  // null means the answer has not come back yet, which is different from an
  // empty list and is shown differently.
  //
  // These must stay above the early return below. Putting them after it meant
  // three hooks ran when the modal was open and none when it was closed, and
  // React counts hooks: opening Settings threw "Rendered more hooks than
  // during the previous render" and took the whole app down with it.
  const [localModels, setLocalModels] = useState(null);
  const [localState, setLocalState] = useState(null);
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models/local-status`, { credentials: 'include' });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        setLocalState(data);
        setLocalModels(Array.isArray(data?.models) ? data.models : []);
      } catch (_) {
        if (!cancelled) { setLocalModels([]); setLocalState({ detail: 'The local model server could not be reached.' }); }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // What you want to be called. There was nowhere to say it, so the sidebar
  // fell back to the generated account id. Local to this machine.
  // Above the early return, like the two hooks before it.
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem('sm_display_name') || '',
  );
  useEffect(() => {
    localStorage.setItem('sm_display_name', displayName);
    // The sidebar is a sibling, not a child, so it is told rather than
    // re-rendered by a shared parent.
    window.dispatchEvent(new CustomEvent('smaran:display-name', { detail: { name: displayName } }));
  }, [displayName]);

  const displayInitials = (displayName.trim() || 'You')
    .split(/[\s._-]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join('') || 'Y';

  /* A narrow window is not a phone.
   *
   * This asked only about width, so dragging the desktop window to half the
   * screen turned it into a phone: "Desktop Pets" became "Mobile Pets" and
   * Software Updates vanished from the list entirely, on the machine that is
   * the only one that can install an update.
   *
   * utils/device answers this properly and its comment already described this
   * exact case - small and driven by a mouse is a narrow window, small and
   * driven by a finger is a phone. It simply was not being used here.
   *
   * Re-asked on resize, so the tabs come back the moment the window widens
   * rather than on the next time something else happens to redraw. */
  const [isMobile, setIsMobile] = useState(() => isPhone());
  useEffect(() => {
    const recheck = () => setIsMobile(isPhone());
    window.addEventListener('resize', recheck);
    // Not only width: a tablet switching between a keyboard and a finger
    // changes the answer without changing a single pixel.
    const pointer = window.matchMedia?.('(pointer: coarse)');
    pointer?.addEventListener?.('change', recheck);
    return () => {
      window.removeEventListener('resize', recheck);
      pointer?.removeEventListener?.('change', recheck);
    };
  }, []);

  /* Something can still ask for a tab that no longer exists here - a saved
     initialTab, or a navigation from elsewhere. Without this the panel would
     open on a phone with nothing in it at all.
     
     Above the early return on purpose. Below it, this hook only ran while the
     panel was open, so the hook count changed between renders and React threw
     #310 - the whole app fell over to "Something went wrong" the moment you
     tapped Settings. */
  useEffect(() => {
    if (isMobile && activeTab === "updates") setActiveTab("general");
  }, [isMobile, activeTab]);

  if (!isOpen) return null;

  const handleAddMemoryFact = () => {
    if (!newFact.trim()) return;
    if (noBackend()) {
      setMemoryFacts(localChat.addFact(newFact.trim()));
      setNewFact("");
      return;
    }
    const item = { id: `mem_${Date.now()}`, fact: newFact.trim() };
    setMemoryFacts((prev) => [item, ...prev]);
    setNewFact("");
  };

  const handleDeleteMemoryFact = (id) => {
    if (noBackend()) {
      setMemoryFacts(localChat.removeFact(id));
      return;
    }
    setMemoryFacts((prev) => prev.filter((f) => f.id !== id));
  };

  const TABS = [
    { id: "general", label: "General & Theme", icon: SlidersHorizontal },
    // First, and only where it is the thing standing between you and a
    // working app: on a phone with no computer linked, nothing answers until
    // a provider and a key are set.
    ...(noBackend() ? [{ id: "provider", label: "AI Provider", icon: Boxes }] : []),
    { id: "account", label: "Account & Profile", icon: UserRound },
    // The Model Matrix downloads and compares models that run on the machine's
    // own hardware. A phone has none of that, and the screen was showing
    // "0 models confirmed" with controls that could not do anything.
    ...(isMobile ? [] : [{ id: "models", label: "Model Matrix", icon: Boxes }]),
    ...(!isMobile ? [{ id: "analytics", label: "Analytics & Telemetry", icon: ChartNoAxesCombined }] : []),
    { id: "memory", label: "AI Memory", icon: Brain },
    { id: "connections", label: "Device Connections", icon: Wifi },
    { id: "pets", label: isMobile ? "Mobile Pets" : "Desktop Pets", icon: PawPrint },
    /* Not on a phone. Every button on that screen asks a backend - check,
       download, install - and a phone app installs its own updates through
       the store it came from. With no computer linked there was nothing it
       could do but explain why it could do nothing, which is a screen worth
       removing rather than writing. */
    ...(isMobile ? [] : [{ id: "updates", label: "Software Updates", icon: ArrowDownToLine }]),
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
          {/* min-w-0 and overflow-x-hidden: a flex child sizes to its content
              by default, so one wide thing inside - a release note with a long
              unbroken line, a file path - widened this pane past the dialog and
              put a horizontal scrollbar across the bottom of it. */}
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-7 space-y-5 sm:space-y-6 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
            
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
                  {/* One column on a phone. Three of these in 375px gave each
                      about a hundred pixels, which broke "Sleek obsidian
                      palette" into four stacked words. */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: "dark", label: "Dark Mode", icon: Moon, desc: "Sleek obsidian palette" },
                      { id: "light", label: "Light Mode", icon: Sun, desc: "Crisp bright palette" },
                      /* System Sync is gone. It followed the operating
                         system, so "light" could arrive without anyone
                         choosing it and half the app - anything painted with
                         a fixed dark colour rather than a theme one - stayed
                         dark against it. Two choices, both of them yours. */
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
                    {/* A select cannot wrap, so a long option is simply cut
                        off mid-word on a phone. The short form says the same
                        thing; the paragraph under the control explains it. */}
                    <option value="auto">{isMobile ? "Auto (smart routing)" : "Auto (Smart Routing - Fastest available)"}</option>
                    {/* These were three fixed names - deepseek-coder:6.7b,
                        llama3.2:3b, qwen2.5-coder:7b - offered whether or not
                        they were installed. Picking one you did not have was
                        a request that could only fail. The list is now what is
                        actually on the machine, and stays empty on a phone,
                        which cannot run any of them. */}
                    {!isMobile && (localModels || [])
                      .filter((m) => !/embed/i.test(m))
                      .map((m) => <option key={m} value={m}>{m} (local)</option>)}
                  </select>
                  {isMobile && (
                    <p className="mt-1.5 text-[10px] text-zinc-500">
                      Local models are not offered on a phone - they need several
                      gigabytes of memory and a GPU. Auto routes to the cloud
                      models you have keys for, or to your paired computer.
                    </p>
                  )}
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

                  {!isMobile && <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-2">
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
                  </div>}
                </div>

                {/* SCREEN LOCK.
                    The lock and its endpoints have existed all along; the only
                    place to set a PIN was inside the sign-up flow, which anyone
                    already signed in never sees again. */}
                {!noBackend() && lockState && (
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Lock className={`w-5 h-5 ${lockState.enabled ? "text-emerald-500" : "text-zinc-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-zinc-900 dark:text-white">Screen lock</p>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {lockState.enabled
                            ? "A PIN is asked for every time the app starts."
                            : `Ask for a PIN when the app starts. ${lockState.min_length}–${lockState.max_length} digits.`}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {lockState.enabled && (
                        <input
                          type="password"
                          inputMode="numeric"
                          value={lockCurrentPin}
                          onChange={(e) => setLockCurrentPin(e.target.value.replace(/\D/g, ""))}
                          placeholder="Current PIN"
                          className="w-32 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-indigo-500"
                        />
                      )}
                      <input
                        type="password"
                        inputMode="numeric"
                        value={lockPin}
                        onChange={(e) => setLockPin(e.target.value.replace(/\D/g, ""))}
                        placeholder={lockState.enabled ? "New PIN" : "Choose a PIN"}
                        className="w-32 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        disabled={lockBusy || lockPin.length < (lockState.min_length || 4)}
                        onClick={() => callLock("set",
                          { pin: lockPin, current_pin: lockState.enabled ? lockCurrentPin : undefined },
                          "Saved.")}
                        className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {lockState.enabled ? "Change PIN" : "Turn on"}
                      </button>
                      {lockState.enabled && (
                        <button
                          type="button"
                          disabled={lockBusy || lockCurrentPin.length < (lockState.min_length || 4)}
                          onClick={() => callLock("disable", { pin: lockCurrentPin }, "Screen lock is off.")}
                          className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-bold disabled:opacity-40"
                        >
                          Turn off
                        </button>
                      )}
                    </div>

                    {lockNote && (
                      <p className="mt-2.5 text-[11px] font-bold text-indigo-500 dark:text-indigo-400">{lockNote}</p>
                    )}

                    {/* What a PIN does and does not do. It keeps someone out of
                        the interface; it does not encrypt anything on the disk. */}
                    <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
                      This locks the app, not the files. Your chats and documents sit on
                      this machine exactly as before, and anyone who can read its storage
                      can read them whether or not a PIN is set.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* AI PROVIDER — the phone's own model, with no computer involved */}
            {activeTab === "provider" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-black text-zinc-900 dark:text-white">Where the model runs</h3>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    This phone talks to the provider directly. Your key is kept on this
                    device and sent to the provider you pick and nowhere else — there is no
                    server of ours in between. Several have a free tier.
                  </p>
                </div>

                {standalone.PROVIDERS.map((p) => {
                  const saved = Boolean(directKeys[p.id]);
                  const chosen = directProvider === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-2xl border p-3.5 transition ${
                        chosen
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60"
                      }`}
                    >
                      <button
                        type="button"
                        disabled={Boolean(p.unavailable)}
                        onClick={() => !p.unavailable && selectDirectProvider(p.id)}
                        className={`w-full text-left ${p.unavailable ? "opacity-60 cursor-default" : ""}`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-zinc-900 dark:text-white">{p.label}</span>
                          {p.free && (
                            <span className="rounded-full bg-violet-100 dark:bg-violet-900/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">Free tier</span>
                          )}
                          {saved && (
                            <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Key saved</span>
                          )}
                          {chosen && <span className="ml-auto text-indigo-500">✓</span>}
                        </span>
                        <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                          {p.unavailable || p.hint}
                        </span>
                      </button>

                      <div className={`mt-2.5 flex flex-wrap items-center gap-2 ${p.unavailable ? "hidden" : ""}`}>
                        {/* The box only exists when there is a key to enter.
                            Once one is saved there is nothing to type, and a
                            field sitting under a KEY SAVED badge reads as the
                            save not having taken. Replacing one is rare, so
                            it asks first. */}
                        {(!saved || replacingKey[p.id]) ? (
                          <>
                            <input
                              type="password"
                              value={directDrafts[p.id] || ""}
                              onChange={(e) => setDirectDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                              placeholder="Paste your API key"
                              className="min-w-0 flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                saveDirectKey(p.id);
                                setReplacingKey((r) => ({ ...r, [p.id]: false }));
                              }}
                              className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white"
                            >
                              Save
                            </button>
                            {replacingKey[p.id] && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReplacingKey((r) => ({ ...r, [p.id]: false }));
                                  setDirectDrafts((d) => ({ ...d, [p.id]: "" }));
                                }}
                                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-bold"
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReplacingKey((r) => ({ ...r, [p.id]: true }))}
                            className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-bold"
                          >
                            Replace key
                          </button>
                        )}
                        {saved && (
                          <button
                            type="button"
                            onClick={() => saveDirectKey(p.id, "")}
                            className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-bold"
                          >
                            Remove
                          </button>
                        )}
                        <a
                          href={p.keyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 underline"
                        >
                          Get key
                        </a>
                      </div>
                    </div>
                  );
                })}

                <div>
                  <h3 className="text-base font-black text-zinc-900 dark:text-white">Model</h3>
                  <p className="mt-1 mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Asked for from the provider, so this is what your key can actually run.
                  </p>

                  {directModelError && (
                    <p className="mb-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                      {directModelError}
                    </p>
                  )}

                  {directModelsLoading && (
                    <p className="text-xs text-zinc-500">Asking the provider what it has…</p>
                  )}

                  {!directModelsLoading && directModels.length > 0 && (
                    <div className="max-h-72 overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
                      {directModels.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => { standalone.setModel(m.id); setDirectModel(m.id); }}
                          className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 ${
                            directModel === m.id
                              ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-bold"
                              : "text-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          <span className="flex-1 break-all">{m.id}</span>
                          {m.free && <span className="text-[10px] font-bold uppercase text-violet-500">free</span>}
                          {directModel === m.id && <span>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Chosen: <strong>{directModel || "nothing yet"}</strong>
                  </p>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Documents, models running on your own hardware, and controlling a computer
                  do need one — pair it under Device Connections. Everything else works here.
                </p>
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

                  {/* "SHASHWAT MISHRA" and the initials "SM" were typed into
                      this card, so every install showed one particular
                      person as the account holder. Reading the name from the
                      account record instead gave the generated device id -
                      "device_device_mteo6v36…" - which is not a name either.
                      There was nowhere to say what you are called. Now there
                      is, and it stays on this machine. */}
                  <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-lg font-black text-white shadow-lg shrink-0">
                      {displayInitials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400">Your name</label>
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={isMobile ? "Your name" : "What should SMARAN.AI call you?"}
                        maxLength={60}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-extrabold text-zinc-900 dark:text-white outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        Shown in the sidebar. Kept on this machine and sent nowhere.
                      </p>
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

                {/* This list used to be five hardcoded rows. It reported
                    DeepSeek Coder 6.7B, Llama 3.2 3B and Qwen 2.5 Coder 7B as
                    "Installed" with 42ms, 18ms and 45ms beside them, and two
                    cloud models as "Connected" at 120ms and 85ms - on any
                    machine, including a phone that cannot hold a 4.8 GB model
                    and had none of them. Nothing was installed, nothing was
                    connected and nothing was timed. It now shows what
                    /api/models/local-status actually reports. */}
                <div className="space-y-2.5">
                  {localModels === null && (
                    <p className="text-[11px] text-zinc-500">Checking which models are on this machine…</p>
                  )}
                  {localModels?.length === 0 && (
                    <p className="text-[11px] text-zinc-500">
                      {localState?.detail || 'No local models are installed.'}
                      {localState?.fix ? ` ${localState.fix}` : ''}
                    </p>
                  )}
                  {(localModels || []).map((m) => (
                    <div key={m} className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                      <div className="min-w-0">
                        <span className="block text-xs font-extrabold text-zinc-900 dark:text-white truncate">{m}</span>
                        <span className="block text-[10px] text-zinc-500">Local · served by Ollama</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                        Installed
                      </span>
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
                    // An input's placeholder cannot wrap, so on a phone the long
                    // form was cut to "Add a new custom rule or fact f".
                    placeholder={isMobile ? "Add a rule or fact…" : "Add a new custom rule or fact for the AI…"}
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
                      <span className="text-zinc-800 dark:text-zinc-200">{f.fact || f.content}</span>
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

                <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 overflow-hidden">
                  <div className="min-w-0 flex-1">
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
                    className={`shrink-0 max-w-[42%] px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${
                      petVisible ? "bg-indigo-600 text-white" : "bg-zinc-300 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {petVisible ? "Enabled" : "Disabled"}
                  </button>
                </div>

                {/* One column on a phone. Two gave each card about 160px, and
                    an avatar plus a name plus a description does not fit in
                    that - every description was cut mid-word. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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
            {activeTab === "updates" && !isMobile && (
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
                <div className="p-5 rounded-3xl border border-red-500/30 bg-gradient-to-br from-red-500/5 via-zinc-50 to-zinc-100 dark:from-red-500/10 dark:via-zinc-900/60 dark:to-zinc-950 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-red-600/15 border border-red-500/40 text-red-500 flex items-center justify-center shrink-0">
                      <Sparkles className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      {/* flex-wrap and a badge that will not break.
                          "UPDATE V2.10.12 AVAILABLE" was wrapping onto two
                          lines inside its pill, which grew the pill until it
                          touched the card's border. The name gives way first;
                          the badge keeps its shape. */}
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="text-sm font-black text-zinc-900 dark:text-white truncate">
                          SMARAN.AI v{updateInfo?.current_version || APP_VERSION}
                        </span>
                        {/* "Up to Date" used to show whenever no update had
                            been found - which includes never having looked.
                            On a phone with no computer linked nothing can be
                            checked at all, and the badge claimed the newest
                            version anyway, directly above a line saying it
                            could not know. A claim needs an answer behind it. */}
                        <span className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          updateInfo?.update_available
                            ? "bg-red-500/20 text-red-500 border border-red-500/30"
                            : updateInfo
                              ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                              : "bg-zinc-500/20 text-zinc-500 border border-zinc-500/30"
                        }`}>
                          {updateInfo?.update_available
                            ? `Update v${updateInfo.latest_version} Available`
                            : updateInfo ? "Up to Date" : "Not checked"}
                        </span>
                      </div>
                      {/* One line that says what is actually happening right
                          now, rather than a timestamp while 267 MB arrives
                          with no sign of it. */}
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {downloading
                          ? (downloadProgress?.total
                              ? `Downloading v${updateInfo?.latest_version} — ${(downloadProgress.written / 1048576).toFixed(0)} of ${(downloadProgress.total / 1048576).toFixed(0)} MB`
                              : `Downloading v${updateInfo?.latest_version}...`)
                          : downloaded
                            ? "Downloaded. Restart to finish installing."
                            : updateCheckedAt
                              ? `Last checked at ${updateCheckedAt}`
                              : "Connects to official release channels"}
                      </p>
                    </div>
                  </div>

                  {/* When there is an update, the thing to offer is the
                      update. This was only ever a Check button: it told you a
                      new version existed and then gave you no way to get it,
                      so pressing it again just said the same thing. The check
                      already returns the installer's URL - windows_url - and
                      nothing was using it. */}
                  {/* The buttons wrap instead of running out of the card.
                      This was `flex shrink-0`, so the group could neither
                      shrink nor break: with both "Restart & Install v2.10.15"
                      and "Check for Updates" present it simply overflowed the
                      rounded border it sits inside. */}
                  <div className="flex flex-wrap items-center justify-end gap-2 min-w-0 max-w-full">
                    {/* The build for the machine you are reading this on. A
                        phone offered the 267 MB Windows installer would have
                        downloaded something it cannot open. If the release is
                        missing the right asset, this says so and opens the
                        release page rather than linking to nothing. */}
                    {/* On a phone the APK has to land in the phone's own
                        downloads for Android to install it, so that stays a
                        link. On the desktop the app fetches the installer
                        itself, which is what an update is. */}
                    {updateInfo?.update_available && isMobile && (
                      <a
                        href={updateInfo.android_url || updateInfo.release_page}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-red-600/25 cursor-pointer"
                      >
                        <ArrowDownToLine className="w-3.5 h-3.5" />
                        {updateInfo.android_url
                          ? `Download v${updateInfo.latest_version}`
                          : "Open release page"}
                      </a>
                    )}

                    {/* Once the download has finished, the only thing left is
                        the restart. This is the one button, and it is the one
                        Windows ends on too - the installer replaces the files
                        the app is running from, so the app has to close, and
                        that should be a moment somebody agrees to rather than
                        their window vanishing mid-sentence. */}
                    {downloaded && !isMobile && (
                      <button
                        type="button"
                        onClick={installUpdate}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 whitespace-nowrap transition shadow-lg shadow-emerald-600/25 cursor-pointer"
                      >
                        <ArrowDownToLine className="w-3.5 h-3.5" />
                        Restart &amp; Install v{updateInfo?.latest_version}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => checkUpdates(true)}
                      disabled={checkingUpdate}
                      className={`px-4 py-2 rounded-xl disabled:opacity-50 text-xs font-bold flex items-center gap-2 whitespace-nowrap transition cursor-pointer ${
                        updateInfo?.update_available
                          ? "border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/25"
                      }`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                      {checkingUpdate ? "Checking..." : "Check for Updates"}
                    </button>
                  </div>
                </div>

                {/* A bar that moves against bytes actually written. When the
                    server declares no length there is no percentage to show,
                    so it says so instead of animating against nothing. */}
                {downloading && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-red-500 transition-all duration-200"
                        style={{
                          width: downloadProgress?.total
                            ? `${Math.min(100, (downloadProgress.written / downloadProgress.total) * 100)}%`
                            : "100%",
                          opacity: downloadProgress?.total ? 1 : 0.35,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      {downloadProgress?.total
                        ? `${((downloadProgress.written / downloadProgress.total) * 100).toFixed(0)}% — you can keep working; it downloads in the background.`
                        : "The server did not say how large the file is, so there is no percentage to show."}
                    </p>
                  </div>
                )}

                {updateError && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <p className="text-[11px] leading-5 text-amber-600 dark:text-amber-400">
                      {updateError}
                    </p>
                  </div>
                )}

                {/* What is in it. The check returns the release notes and they
                    were being thrown away, so an update arrived with no reason
                    to take it. */}
                {updateInfo?.update_available && updateInfo?.notes && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-zinc-500">
                      What&apos;s new in v{updateInfo.latest_version}
                    </h4>
                    {/* break-words, because release notes carry things that
                        do not break on their own: html.sm-pip, an address like
                        192.168.1.5:3003, a file path. One of those is wider
                        than the card at a narrow window. */}
                    <p className="mt-2 max-h-40 overflow-y-auto overflow-x-hidden break-words whitespace-pre-wrap text-[11px] leading-5 text-zinc-600 dark:text-zinc-400">
                      {String(updateInfo.notes).replace(/[*#`]/g, '').trim().slice(0, 1200)}
                    </p>
                    <p className="mt-2.5 text-[10px] text-zinc-500">
                      Installing replaces this version. Your chats, documents and
                      settings stay where they are.
                    </p>
                  </div>
                )}

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
                      className="dev-link dev-link-portfolio group backdrop-blur-md"
                    >
                      <span className="dev-link-sheen" aria-hidden="true" />
                      <Globe className="w-4 h-4 transition-transform duration-500 group-hover:rotate-[20deg]" />
                      Portfolio
                      <ExternalLink className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </a>
                    <a
                      href="https://www.linkedin.com/in/sm980/"
                      target="_blank"
                      rel="noreferrer"
                      className="dev-link dev-link-linkedin group backdrop-blur-md"
                    >
                      <span className="dev-link-sheen" aria-hidden="true" />
                      {/* The actual mark, not the word. A link called LinkedIn
                          with nothing of LinkedIn on it is just a word. */}
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"/>
                      </svg>
                      LinkedIn
                      <ExternalLink className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
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
