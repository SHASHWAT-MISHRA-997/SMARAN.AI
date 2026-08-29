import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageSquare, Plus, Trash2, X,
  Settings, Pencil, Check, Brain, Sparkles,
  ChevronLeft, ChevronDown, PanelLeftOpen, PanelLeftClose, Menu, Bot, Database, Boxes, UserCheck, User,
  Activity, LayoutDashboard, QrCode, LogIn, Blocks, FolderOpen, Globe2, Volume2, ArrowDownToLine, Terminal
} from 'lucide-react';
import ModelHubModal from './ModelHubModal';
import { SmaranLogo } from './SmaranLogo';
import { API_BASE, logoutUser, getCurrentUser, fetchWithAuth } from '../context/AuthContext';
import { parseJsonResponse } from '../utils/api';

/* Tooltip uses a React Portal so parent overflow never clips it. */
const Tip = ({ label, children }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  const handleEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 10,
      });
    }
    setShow(true);
  };

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {show && createPortal(
        <div
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: 'translateY(-50%)',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
          className="whitespace-nowrap px-3 py-1.5 rounded-lg
            bg-zinc-900 text-white text-[11px] font-bold shadow-2xl
            border border-zinc-700/80
            animate-in fade-in zoom-in-95 duration-100"
        >
          <span
            style={{
              position: 'absolute',
              right: '100%',
              top: '50%',
              transform: 'translateY(-50%)',
              borderTop: '5px solid transparent',
              borderBottom: '5px solid transparent',
              borderRight: '6px solid #18181b',
            }}
          />
          {label}
        </div>,
        document.body
      )}
    </div>
  );
};

/* Collapsed icon button with high contrast in light & dark modes */
const RailBtn = ({ icon, label, onClick, active = false, danger = false, violet = false }) => (
  <Tip label={label}>
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`
        flex flex-col items-center justify-center gap-1 w-11 h-11 rounded-xl
        transition-all duration-200 cursor-pointer group relative border
        ${active
          ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-500/20'
          : danger
            ? 'text-rose-500 hover:bg-rose-500/15 border-transparent'
            : violet
              ? 'text-violet-600 dark:text-violet-400 hover:bg-violet-500/15 border-transparent'
              : 'text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white shadow-xs'
        }
      `}
    >
      <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
    </button>
  </Tip>
);

const Sidebar = ({
  token, user, sessions, activeSessionId, setActiveSessionId,
  onCreateSession, onDeleteSession, onRenameSession, onClearHistory,
  activeCollections, setActiveCollections,
  onNavigate, activeView, onExpandChange,
  isModelHubOpen: externalModelHubOpen,
  onOpenWorkspace,
  setIsModelHubOpen: externalSetIsModelHubOpen,
  onModelChange, position = 'left',
  onTogglePerformance, showPerformance, onOpenAnalytics,
  onOpenDeveloper, onOpenPairing, onOpenAuth,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  // The profile row had "SHASHWAT MISHRA" and the initials "SM" written into
  // it, so every install of SMARAN.AI showed one particular person's name as
  // the signed-in user. The user record was already being passed in and was
  // simply not read.
  // A name you chose beats anything derived. Without one the account's
  // username was used, and on this build that is a generated device id -
  // "device_device_mteo6v36…" - which is not a name and should not be shown
  // as one. Those are recognised and skipped.
  const [chosenName, setChosenName] = useState(
    () => (typeof window === 'undefined' ? '' : localStorage.getItem('sm_display_name') || ''),
  );
  useEffect(() => {
    const update = (event) => setChosenName(event.detail?.name || '');
    window.addEventListener('smaran:display-name', update);
    return () => window.removeEventListener('smaran:display-name', update);
  }, []);

  const looksGenerated = (value) => !value || /^(device[_-]|local[_-]|user[_-]?\d)/i.test(value) || /^[0-9a-f]{12,}$/i.test(value);
  const derived = [user?.full_name, user?.name, user?.username, user?.email]
    .find((candidate) => candidate && !looksGenerated(candidate));
  const profileName = (chosenName.trim() || derived || 'You').toString();
  const profileInitials = profileName
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'Y';

  const [dictationError, setDictationError] = useState('');
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const isLoggedIn = Boolean(user || token || (typeof window !== 'undefined' && localStorage.getItem('sm_token')));

  useEffect(() => {
    const openMemory = () => setIsMemoryOpen(true);
    const dictationState = (event) => setVoiceOutputEnabled(Boolean(event.detail?.active));
    const dictationFailed = (event) => setDictationError(event.detail?.message || 'Voice dictation could not start.');
    window.addEventListener('smaran:open-memory', openMemory);
    window.addEventListener('smaran:dictation-state', dictationState);
    window.addEventListener('smaran:dictation-error', dictationFailed);
    return () => {
      window.removeEventListener('smaran:open-memory', openMemory);
      window.removeEventListener('smaran:dictation-state', dictationState);
      window.removeEventListener('smaran:dictation-error', dictationFailed);
    };
  }, []);

  // Editing
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const requestClearHistory = async () => {
    if (!confirmClearHistory) {
      setConfirmClearHistory(true);
      return false;
    }
    const cleared = await onClearHistory?.();
    if (cleared) setConfirmClearHistory(false);
    return Boolean(cleared);
  };

  // Memory
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryToast, setMemoryToast] = useState(null);

  // Model Hub Modal (Controlled externally or fallback to internal)
  const [internalModelHubOpen, setInternalModelHubOpen] = useState(false);
  const isModelHubOpen = externalModelHubOpen !== undefined ? externalModelHubOpen : internalModelHubOpen;
  const setIsModelHubOpen = externalSetIsModelHubOpen || setInternalModelHubOpen;

  // Plugin & Skills Hub Modal (Removed)

  const fetchMemoryFacts = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory`);
      if (res.ok) {
        const data = await parseJsonResponse(res);
        setMemoryFacts(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setMemoryLoading(false);
    }
  };

  useEffect(() => {
    if (isMemoryOpen) {
      fetchMemoryFacts();
    }
  }, [isMemoryOpen]);

  const handleDeleteFact = async (id) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMemoryFacts((prev) => prev.filter((fact) => fact.id !== id));
        setMemoryToast('Fact deleted.');
      } else {
        setMemoryToast('Failed to delete fact.');
      }
    } catch (err) {
      console.error(err);
      setMemoryToast('Failed to delete fact.');
    } finally {
      setTimeout(() => setMemoryToast(null), 3000);
    }
  };

  const handleClearAllMemory = async () => {
    if (!window.confirm("Are you sure you want to clear ALL memory facts? This cannot be undone.")) return;
    setMemoryLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory/clear`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMemoryFacts([]);
        setMemoryToast('All memory cleared.');
        setIsMemoryOpen(false);
      } else {
        setMemoryToast('Failed to clear memory.');
      }
    } catch (err) {
      console.error(err);
      setMemoryToast('Failed to clear memory.');
    } finally {
      setMemoryLoading(false);
      setTimeout(() => setMemoryToast(null), 3000);
    }
  };

  useEffect(() => { if (onExpandChange) onExpandChange(expanded); }, [expanded]);

  useEffect(() => {
    if (!mobileOpen) return undefined;

    document.body.classList.add('sidebar-open');
    const handleEscape = (event) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const handleViewportChange = (event) => {
      if (event.matches) setMobileOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    desktopQuery.addEventListener('change', handleViewportChange);

    return () => {
      document.body.classList.remove('sidebar-open');
      window.removeEventListener('keydown', handleEscape);
      desktopQuery.removeEventListener('change', handleViewportChange);
    };
  }, [mobileOpen]);

  const handleStartEdit = (e, session) => { e.stopPropagation(); setEditingSessionId(session.id); setEditTitle(session.title); };
  const handleSave = (id) => { if (editTitle.trim()) onRenameSession(id, editTitle.trim()); setEditingSessionId(null); };
  const handleCancel = () => setEditingSessionId(null);

  useEffect(() => { fetchCollections(); }, []);
  const fetchCollections = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/collections`);
      if (res.ok) {
        await parseJsonResponse(res);
      }
    } catch (err) { console.error(err); }
  };

  const handleSessionClick = (id) => { setActiveSessionId(id); onNavigate('chat'); setMobileOpen(false); };

  /* Memory vault modal */
  const memoryModal = isMemoryOpen && (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#1e1f20] border border-zinc-800 rounded-3xl w-full max-w-xl flex flex-col max-h-[80vh] shadow-[0_0_50px_rgba(99,102,241,0.15)] overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400">
              <Brain className="w-4 h-4" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">AI Memory Vault</h3>
              <p className="text-[10px] text-zinc-500 font-semibold uppercase mt-0.5">Selective memory facts dashboard</p>
            </div>
          </div>
          <button
            onClick={() => setIsMemoryOpen(false)}
            className="text-zinc-500 hover:text-white p-1 hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {memoryLoading && memoryFacts.length === 0 ? (
            <div className="py-8 flex flex-col items-center justify-center space-y-2">
              <span className="w-6 h-6 rounded-full border-2 border-t-transparent border-violet-400 animate-spin" />
              <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Querying Vault...</span>
            </div>
          ) : memoryFacts.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <span className="text-3xl"><Database className="w-8 h-8 text-zinc-600" /></span>
              <div>
                <p className="text-xs font-black text-zinc-400 uppercase">Vault is empty</p>
                <p className="text-[10px] text-zinc-600 mt-1 max-w-xs font-bold leading-normal">
                  The AI has not recorded any profile preferences or project tags for you yet.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {memoryFacts.map((fact) => (
                <div
                  key={fact.id}
                  className="flex items-start justify-between gap-3 p-3.5 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded-2xl transition-all group/fact text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-300 font-semibold leading-relaxed whitespace-pre-wrap">{fact.fact}</p>
                    <span className="text-[9px] text-zinc-600 font-mono block mt-1.5">
                      Recorded on {new Date(fact.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteFact(fact.id)}
                    title="Erase this memory fact"
                    className="text-zinc-600 hover:text-rose-400 p-1.5 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer opacity-0 group-hover/fact:opacity-100 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/20 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
            {memoryFacts.length} total facts stored
          </span>
          {memoryFacts.length > 0 && (
            <button
              onClick={handleClearAllMemory}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 text-[11px] font-black uppercase tracking-wider hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Wipe Vault
            </button>
          )}
        </div>
      </div>
    </div>
  );


  /* 3D Motion Animated Logo Component */
  const Logo3DMotion = ({ size = "md" }) => {
    const isSm = size === "sm";
    const containerClass = isSm ? "w-9 h-9" : "w-10 h-10";

    return (
      <div className={`relative ${containerClass} flex items-center justify-center shrink-0 select-none group cursor-pointer`}>
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-indigo-500 opacity-90 blur-[4px] animate-pulse group-hover:scale-110 transition-transform duration-500" />
        <div className="relative w-full h-full rounded-xl bg-zinc-950 p-0.5 border border-amber-500/40 flex items-center justify-center shadow-[0_0_18px_rgba(249,115,22,0.4)] overflow-hidden">
          <SmaranLogo
            alt="SMARAN.AI"
            className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      </div>
    );
  };

  /* Desktop sidebar: collapsed icon rail or expanded panel */
  const sidebarDesktop = (
    <aside className={`
      hidden md:flex flex-col shrink-0 z-40
      bg-[#f3f4f6] dark:bg-[#171717] text-zinc-900 dark:text-zinc-100 sidebar-cyber-border
      ${position === 'right' ? 'md:order-3 h-screen sticky top-0 border-l border-zinc-300/70 dark:border-zinc-800' : 'md:order-1 h-screen sticky top-0 border-r border-zinc-300/70 dark:border-zinc-800'}
      transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
      ${expanded ? 'w-[304px]' : 'w-[64px]'}
    `}>

      {/* TOP: 3D Motion Logo + Toggle */}
      <div className={`
        flex items-center shrink-0 h-[56px]
        ${expanded ? 'px-5 justify-between' : 'justify-center px-0'}
      `}>
        {expanded ? (
          <>
            <div className="flex-1 min-w-0 animate-in fade-in duration-200 select-none flex items-center">
              <div className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center">
                <span>SMARAN.AI</span><ChevronDown className="ml-1 h-3.5 w-3.5 text-zinc-500" />
              </div>
            </div>
            <Tip label="Collapse sidebar">
              <button
                type="button"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                onClick={() => setExpanded(false)}
                className="ml-2 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <PanelLeftClose className="w-4.5 h-4.5" />
              </button>
            </Tip>
          </>
        ) : (
          <Tip label="Expand sidebar">
            <button
              type="button"
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={() => setExpanded(true)}
              className="p-2.5 rounded-xl text-indigo-600 dark:text-indigo-400 hover:text-white bg-zinc-200/80 dark:bg-zinc-900/80 hover:bg-indigo-600 border border-zinc-300 dark:border-zinc-800 hover:border-indigo-500 shadow-xs hover:scale-105 transition-all cursor-pointer flex items-center justify-center btn-lightning-hover"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          </Tip>
        )}
      </div>

      {/* New conversation button */}
      <div className={`shrink-0 ${expanded ? 'px-2 pb-1' : 'flex justify-center py-3 px-2'}`}>
        {expanded ? (
          <button
            onClick={() => { onCreateSession(); onNavigate('chat'); }}
            className="nav-neon sheen w-full flex items-center gap-3 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-white font-normal text-sm rounded-lg px-3 py-2 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
        ) : (
          <RailBtn
            icon={<Plus className="w-5 h-5" />}
            label="New Conversation"
            onClick={() => { onCreateSession(); onNavigate('chat'); }}
            active={false}
          />
        )}
      </div>

      {/* Product destinations stay visible instead of being buried in a modal. */}
      <div className={`shrink-0 ${expanded ? 'px-2 pb-2 space-y-0.5' : 'px-2 py-2 flex flex-col items-center gap-1'}`}>
        {expanded ? <>
          <button onClick={() => onNavigate('sites')} className={`nav-neon sheen w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${activeView === 'sites' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-950 dark:text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-white'}`}><Globe2 className="h-4 w-4"/> Sites</button>
          <button onClick={() => onNavigate('plugins')} className={`nav-neon sheen w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${activeView === 'plugins' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-950 dark:text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-white'}`}><Blocks className="h-4 w-4"/> Plugins</button>
          <button onClick={() => onNavigate('terminal')} className="nav-neon sheen w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-white"><Terminal className="h-4 w-4"/> Terminal</button>
          <p className="px-3 pb-1 pt-4 text-xs font-medium text-zinc-500">Projects</p>
          <button onClick={() => onNavigate('chat')} className={`nav-neon sheen w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${activeView === 'chat' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-950 dark:text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-white'}`}><FolderOpen className="h-4 w-4"/><span className="truncate">SMARAN.AI</span></button>
        </> : <>
          <RailBtn icon={<Globe2 className="h-5 w-5"/>} label="Sites" active={activeView === 'sites'} onClick={() => onNavigate('sites')}/>
          <RailBtn icon={<Blocks className="h-5 w-5"/>} label="Plugins & Skills" active={activeView === 'plugins'} onClick={() => onNavigate('plugins')}/>
          <RailBtn icon={<Terminal className="h-5 w-5"/>} label="Terminal" onClick={() => onNavigate('terminal')}/>
        </>}
      </div>

      {/* Chat history */}
      <div className={`flex-1 overflow-y-auto ${expanded ? 'px-3 py-1' : 'px-2 py-1 flex flex-col items-center gap-1'}`}>
        {expanded && (
          <span className="block text-xs font-medium text-zinc-500 px-3 mb-2 mt-2">
            Recents
          </span>
        )}

        {sessions.length === 0 && expanded && (
          <p className="text-xs text-zinc-600 italic px-2 py-1 font-bold">No conversations yet.</p>
        )}

        {expanded && sessions.map((s) => {
          const isActive = activeSessionId === s.id && activeView === 'chat';
          const isEditing = editingSessionId === s.id;
          const isConfirmDel = confirmDeleteId === s.id;

          return (
            <div
              key={s.id}
              onClick={() => !isEditing && handleSessionClick(s.id)}
              className={`
                nav-neon sheen group w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm font-normal
                cursor-pointer transition-all duration-200 mb-0.5
                ${isActive
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-950 dark:text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'}
              `}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{s.title}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isEditing ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSave(s.id); if (e.key === 'Escape') handleCancel(); }}
                      className="w-24 px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white outline-none"
                      autoFocus
                    />
                    <button onClick={() => handleSave(s.id)} className="p-1 text-emerald-500 hover:text-emerald-400"><Check className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <>
                    <button onClick={e => handleStartEdit(e, s)} className="p-1 text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 rounded cursor-pointer" title="Rename session"><Pencil className="w-3.5 h-3.5" /></button>
                    {confirmDeleteId === s.id ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { onDeleteSession(s.id); setConfirmDeleteId(null); }} className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded-lg cursor-pointer">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-0.5 bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 text-zinc-700 dark:text-zinc-300 text-[10px] font-bold rounded-lg cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(s.id); }} className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded cursor-pointer" title="Delete session"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* BOTTOM: Actions */}
      <div className={`relative shrink-0 border-t border-zinc-200 dark:border-zinc-800/80 p-2.5 ${expanded ? 'space-y-2' : 'flex flex-col items-center gap-1.5'}`}>
        {expanded ? (
          <>
            {showUtilityMenu && (
              <div className="absolute bottom-[110px] left-2 right-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 shadow-2xl z-50 backdrop-blur-md">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => { onNavigate('settings'); setShowUtilityMenu(false); }}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-2 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer text-xs font-bold transition"
                  >
                    <Settings className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Settings</span>
                  </button>
                  {onClearHistory && (
                    <button
                      onClick={requestClearHistory}
                      className={`flex items-center justify-center gap-1.5 px-2.5 py-2 border rounded-xl cursor-pointer text-xs font-bold transition ${
                        confirmClearHistory
                          ? 'border-rose-500 bg-rose-600 text-white'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{confirmClearHistory ? 'Confirm' : 'Clear'}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {dictationError && (
              <div role="alert" className="mb-1 rounded-xl border border-amber-700/50 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                {dictationError}
                <button type="button" onClick={() => setDictationError('')} className="ml-1 font-bold underline text-indigo-600 dark:text-white">Dismiss</button>
              </div>
            )}

            {/* Distinct Voice Control Card */}
            <div className="flex items-center justify-between p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 shadow-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                  voiceOutputEnabled
                    ? 'bg-emerald-500 text-white animate-pulse'
                    : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400'
                }`}>
                  <Volume2 className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {voiceOutputEnabled ? 'Listening…' : 'Voice Dictate'}
                  </span>
                  <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                    {voiceOutputEnabled ? 'Speak - it types for you' : 'Speak into the message box'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onNavigate('chat');
                  window.setTimeout(() => window.dispatchEvent(new CustomEvent('smaran:toggle-dictation')), 120);
                }}
                className={`px-2.5 py-1 text-xs font-black rounded-lg transition border cursor-pointer ${
                  voiceOutputEnabled
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                    : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700'
                }`}
              >
                {voiceOutputEnabled ? 'Stop' : 'Speak'}
              </button>
            </div>

            {/* Distinct User Profile & Sign In Row */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 p-2 shadow-xs">
              <button
                type="button"
                onClick={() => setShowUtilityMenu((v) => !v)}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer group"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-500 to-pink-500 flex items-center justify-center text-[10px] font-black text-white shadow-xs shrink-0">
                  {profileInitials}
                </div>
                <div className="min-w-0 flex-1 truncate">
                  <span className="block text-xs font-extrabold text-zinc-900 dark:text-white tracking-wide truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                    {profileName}
                  </span>
                  <span className="block text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                    Pro Workspace
                  </span>
                </div>
              </button>

              {isLoggedIn ? (
                <button
                  type="button"
                  onClick={() => onNavigate('account')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-black text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition cursor-pointer"
                  title="Pro Workspace Active"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>PRO</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenAuth ? onOpenAuth() : onNavigate('account')}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white transition cursor-pointer"
                  title="Sign in or register"
                >
                  <LogIn className="w-3 h-3 text-indigo-500" />
                  <span>Sign in</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Voice toggle button in collapsed rail */}
            <RailBtn
              icon={<Volume2 className={`w-5 h-5 ${voiceOutputEnabled ? 'text-emerald-400 animate-pulse' : 'text-indigo-600 dark:text-indigo-400'}`} />}
              label={voiceOutputEnabled ? 'Dictating' : 'Voice Dictate'}
              active={voiceOutputEnabled}
              onClick={() => {
                onNavigate('chat');
                window.setTimeout(() => window.dispatchEvent(new CustomEvent('smaran:toggle-dictation')), 120);
              }}
            />

            {/* Sign in button in collapsed rail — only if not logged in */}
            {!isLoggedIn && (
              <RailBtn
                icon={<LogIn className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
                label="Sign in / Register"
                onClick={() => onOpenAuth ? onOpenAuth() : onNavigate('account')}
              />
            )}

            {/* Software Updates & Downloads button in collapsed rail */}
            <RailBtn
              icon={<ArrowDownToLine className="w-5 h-5 text-red-500 hover:text-red-400" />}
              label="Software Updates & Downloads"
              onClick={() => onNavigate('updates')}
            />

            {/* Profile Avatar button in collapsed rail */}
            <Tip label={profileName}>
              <button
                type="button"
                aria-label={`${profileName} profile`}
                onClick={() => { setExpanded(true); setShowUtilityMenu(true); }}
                className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-pink-500 flex items-center justify-center text-xs font-black text-white shadow-md hover:scale-105 transition cursor-pointer border border-indigo-400/30"
              >
                SM
              </button>
            </Tip>
          </>
        )}
      </div>
    </aside>
  );

  /* Mobile sidebar */
  const mobileSidebar = (
    <>
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white/95 dark:bg-[#1a1b1e] border-b border-zinc-200 dark:border-zinc-800 shrink-0 z-30 mobile-px-4 mobile-py-3">
        <div className="flex items-center gap-2">
          <Logo3DMotion size="sm" />
          <span className="font-black text-sm tracking-wide select-none flex items-center ml-1">
            <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-400 bg-clip-text text-transparent">SMARAN</span>
            <span className="text-white ml-1 px-1 rounded bg-gradient-to-r from-indigo-600 to-purple-600 text-[10px]">.AI</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white p-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 cursor-pointer"
          aria-label="Open navigation menu"
          aria-controls="smaran-mobile-navigation"
          aria-expanded={mobileOpen}
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {mobileOpen && <div onClick={() => setMobileOpen(false)} className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-xs z-40 mobile-full-width" aria-hidden="true" />}

      <aside
        id="smaran-mobile-navigation"
        aria-label="SMARAN.AI navigation"
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
        className={`md:hidden fixed top-0 bottom-0 left-0 w-[268px] max-w-full bg-white dark:bg-[#1a1b1e] border-r border-zinc-200 dark:border-zinc-800 flex flex-col z-50 transition-transform duration-300 sidebar-mobile-fix sidebar-mobile-scroll ${mobileOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}`}
      >
        <div className="p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Logo3DMotion size="sm" />
            <div>
              <div className="text-sm font-black tracking-wider uppercase leading-none flex items-center">
                <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-400 bg-clip-text text-transparent font-extrabold">SMARAN</span>
                <span className="text-white font-extrabold ml-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 text-[10px]">.AI</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} className="text-zinc-500 hover:text-zinc-950 dark:hover:text-white cursor-pointer" aria-label="Close navigation menu"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-3 shrink-0">
          <button onClick={async () => { setMobileOpen(false); onNavigate('chat'); await onCreateSession(); }}
            className="w-full flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-800/60 hover:bg-zinc-200 dark:hover:bg-zinc-700/70 text-zinc-800 dark:text-zinc-200 font-bold text-xs uppercase tracking-wider rounded-full py-2.5 border border-zinc-200 dark:border-zinc-700/40 transition-all cursor-pointer">
            <Plus className="w-4 h-4 text-indigo-400" /> New Conversation
          </button>
        </div>

        <nav className="px-3 pb-3 space-y-1 border-b border-zinc-200 dark:border-zinc-800">
          <button onClick={() => { onNavigate('sites'); setMobileOpen(false); }} className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black ${activeView === 'sites' ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><Globe2 className="h-4 w-4"/> Sites</button>
          <button onClick={() => { onNavigate('plugins'); setMobileOpen(false); }} className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black ${activeView === 'plugins' ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><Blocks className="h-4 w-4"/> Plugins & Skills</button>
        </nav>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-1 space-y-1">
          <span className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest px-2 mb-2">Chat History</span>
          {sessions.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-600 italic px-2 py-1 font-bold">No conversations yet.</p>
          ) : sessions.map(s => (
            <div key={s.id} onClick={() => handleSessionClick(s.id)}
              className={`group w-full flex items-center justify-between rounded-full px-3 py-2 text-xs font-bold cursor-pointer transition-all border btn-lightning-hover ${activeSessionId === s.id && activeView === 'chat' ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 border-transparent hover:shadow-[0_0_8px_rgba(99,102,241,0.08)]'}`}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
                <span className="truncate">{s.title}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => handleStartEdit(e, s)} className="p-0.5 text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 rounded cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={e => { e.stopPropagation(); onDeleteSession(s.id); }} className="p-0.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2 shrink-0 max-h-[55dvh] overflow-y-auto overscroll-contain sidebar-mobile-footer">
          {/* User Profile & Voice Pill */}
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2 shadow-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center text-[10px] font-black text-white shadow-xs shrink-0">
                {profileInitials}
              </div>
              <span className="text-xs font-black text-zinc-900 dark:text-white truncate">
                {profileName}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                onNavigate('chat');
                setMobileOpen(false);
                window.setTimeout(() => window.dispatchEvent(new CustomEvent('smaran:toggle-dictation')), 120);
              }}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black transition border shadow-xs ${
                voiceOutputEnabled
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-300 dark:border-zinc-700'
              }`}
            >
              <Volume2 className="h-3.5 w-3.5 text-white" />
              <span className="text-white font-bold">{voiceOutputEnabled ? 'Listening' : 'Voice'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { onNavigate('settings'); setMobileOpen(false); }} className="min-w-0 w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-zinc-300 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl cursor-pointer text-[11px] font-bold"><Settings className="w-4 h-4 shrink-0" /><span className="break-words">Settings</span></button>
            {onClearHistory && <button onClick={async () => { if (await requestClearHistory()) setMobileOpen(false); }} className={`min-w-0 w-full flex items-center justify-center gap-1.5 px-2 py-2 border rounded-xl cursor-pointer text-[11px] font-bold ${confirmClearHistory ? 'border-rose-500 bg-rose-600 text-white' : 'border-rose-800 text-rose-300 hover:text-white hover:border-rose-600'}`}><Trash2 className="w-4 h-4 shrink-0" /><span className="break-words">{confirmClearHistory ? 'Confirm Clear' : 'Clear History'}</span></button>}
          </div>

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800/60 text-center py-1.5">
            <div className="flex items-center justify-center gap-2 mt-1 text-[10px]">
              <a href="https://www.linkedin.com/in/sm980/" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-cyan-400 hover:underline font-bold">
                LinkedIn
              </a>
              <span className="text-zinc-600" aria-hidden="true">|</span>
              <a href="https://shashwatmishra-portfolio.netlify.app/" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-purple-400 hover:underline font-bold">
                Portfolio
              </a>
            </div>
          </div>
        </div>
      </aside>
    </>
  );

  return (
    <>
      {sidebarDesktop}
      {mobileSidebar}
      {memoryModal}
      <ModelHubModal
        isOpen={isModelHubOpen}
        onClose={() => setIsModelHubOpen(false)}
        token={token}
      />
    </>
  );
};

export default Sidebar;
