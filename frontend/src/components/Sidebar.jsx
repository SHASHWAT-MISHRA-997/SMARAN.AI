import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageSquare, Plus, Trash2, X,
  Settings, Pencil, Check, Brain, Sparkles,
  ChevronLeft, PanelLeftOpen, PanelLeftClose, Menu, Bot, Database, Boxes, UserCheck, User,
  Activity, LayoutDashboard, QrCode, LogIn, Blocks, FolderOpen,} from 'lucide-react';
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


/* Collapsed icon button */
const RailBtn = ({ icon, label, onClick, active = false, danger = false, violet = false }) => (
  <Tip label={label}>
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`
        flex flex-col items-center justify-center gap-1 w-12 h-12 rounded-xl
        transition-all duration-200 cursor-pointer group relative
        btn-lightning-hover sidebar-item-highlight nav-neon sheen
        ${active
          ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-400/40'
          : danger
            ? 'text-rose-400 hover:bg-rose-500/15 hover:text-rose-300'
            : violet
              ? 'text-violet-400 hover:bg-violet-500/15 hover:text-violet-300'
              : 'text-zinc-400 hover:bg-zinc-700/60 hover:text-white'
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
  onOpenDeveloper, onOpenPairing, onOpenAuth, onOpenHub,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Editing
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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
      bg-[#f3f4f6] dark:bg-[#1a1b1e] text-zinc-900 dark:text-zinc-100 sidebar-cyber-border
      ${position === 'right' ? 'md:order-3 h-screen sticky top-0 border-l border-zinc-300/70 dark:border-zinc-800' : 'md:order-1 h-screen sticky top-0 border-r border-zinc-300/70 dark:border-zinc-800'}
      transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
      ${expanded ? 'w-[268px]' : 'w-[64px]'}
    `}>

      {/* TOP: 3D Motion Logo + Toggle */}
      <div className={`
        flex items-center border-b border-zinc-300/60 dark:border-zinc-800/80 shrink-0 h-[64px] bg-zinc-200/50 dark:bg-zinc-950/40 backdrop-blur-md
        ${expanded ? 'px-4 justify-between' : 'justify-center px-0'}
      `}>
        {expanded ? (
          <>
            <Logo3DMotion size="sm" />
            <div className="ml-2.5 flex-1 min-w-0 animate-in fade-in duration-200 select-none flex items-center">
              <div className="text-sm sm:text-base font-black tracking-wider uppercase leading-none flex items-center">
                <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-400 bg-clip-text text-transparent font-extrabold filter drop-shadow-[0_0_10px_rgba(249,115,22,0.5)]">SMARAN</span>
                <span className="text-white font-extrabold ml-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 text-[10px] shadow-[0_0_10px_rgba(99,102,241,0.5)]">.AI</span>
              </div>
            </div>
            <Tip label="Collapse sidebar">
              <button
                type="button"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                onClick={() => setExpanded(false)}
                className="ml-2 p-2 rounded-xl text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-white bg-zinc-200/80 dark:bg-zinc-900/80 hover:bg-indigo-600/20 border border-zinc-300/70 dark:border-zinc-800 hover:border-indigo-500/50 shadow-xs hover:scale-105 transition-all cursor-pointer btn-lightning-hover"
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
      <div className={`shrink-0 ${expanded ? 'p-3' : 'flex justify-center py-3 px-2'}`}>
        {expanded ? (
          <button
            onClick={() => { onCreateSession(); onNavigate('chat'); }}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800/60 hover:bg-zinc-700/70 text-zinc-200 font-bold text-xs uppercase tracking-wider rounded-full py-2.5 border border-zinc-700/40 hover:border-indigo-500/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-indigo-400" />
            New Conversation
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

      {/* Chat history */}
      <div className={`flex-1 overflow-y-auto ${expanded ? 'px-3 py-1' : 'px-2 py-1 flex flex-col items-center gap-1'}`}>
        {expanded && (
          <span className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest px-2 mb-2">
            Chat History
          </span>
        )}

        {sessions.length === 0 && expanded && (
          <p className="text-xs text-zinc-600 italic px-2 py-1 font-bold">No conversations yet.</p>
        )}

        {sessions.map((s) => {
          const isActive = activeSessionId === s.id && activeView === 'chat';
          const isEditing = editingSessionId === s.id;
          const isConfirmDel = confirmDeleteId === s.id;

          if (!expanded) {
            return (
              <Tip key={s.id} label={s.title || 'Chat'}>
                <button
                  onClick={() => handleSessionClick(s.id)}
                  className={`
                    w-12 h-10 flex items-center justify-center rounded-xl transition-all cursor-pointer
                    ${isActive
                      ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-400/30'
                      : 'text-zinc-500 hover:bg-zinc-700/60 hover:text-white'}
                  `}
                >
                  <MessageSquare className="w-4.5 h-4.5" />
                </button>
              </Tip>
            );
          }

          return (
            <div
              key={s.id}
              onClick={() => !isEditing && handleSessionClick(s.id)}
              className={`
                group w-full flex items-center justify-between rounded-full px-3 py-2 text-xs font-bold
                cursor-pointer transition-all duration-200 border mb-1
                sidebar-item-highlight btn-lightning-hover
                ${isActive
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20 active shadow-[0_0_12px_rgba(99,102,241,0.2)]'
                  : 'text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-200/60 dark:hover:bg-zinc-800/40 hover:shadow-[0_0_10px_rgba(99,102,241,0.08)]'}
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
      <div className={`shrink-0 border-t border-zinc-300/60 dark:border-zinc-800/80 p-2 space-y-1 ${expanded ? '' : 'flex flex-col items-center'}`}>
        {expanded ? (
          <>
            <button onClick={() => setIsModelHubOpen(true)} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-indigo-400 hover:bg-indigo-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
              <Boxes className="w-4 h-4 shrink-0 text-indigo-400" /> Model Catalog & Matrix
            </button>
            <button onClick={onOpenWorkspace} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-cyan-400 hover:bg-cyan-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
              <FolderOpen className="w-4 h-4 shrink-0 text-cyan-400" /> Project Folder
            </button>
            <button onClick={onOpenAnalytics} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-emerald-400 hover:bg-emerald-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
              <Activity className="w-4 h-4 shrink-0 text-emerald-400" /> Analytics Dashboard
            </button>
            <button onClick={() => setIsMemoryOpen(true)} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-violet-400 hover:bg-violet-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
              <Brain className="w-4 h-4 shrink-0" /> Manage AI Memory
            </button>
            {onOpenHub && (
              <button onClick={onOpenHub} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-indigo-300 hover:bg-indigo-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
                <Blocks className="w-4 h-4 shrink-0 text-indigo-300" /> Skills & Connectors
              </button>
            )}
            {onOpenAuth && (
              <button onClick={onOpenAuth} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-rose-400 hover:bg-rose-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
                <LogIn className="w-4 h-4 shrink-0 text-rose-400" /> Sign In / Register
              </button>
            )}
            {onOpenPairing && (
              <button onClick={onOpenPairing} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-sky-400 hover:bg-sky-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
                <QrCode className="w-4 h-4 shrink-0 text-sky-400" /> Link Your Phone
              </button>
            )}
            <button onClick={onOpenDeveloper} className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black border border-transparent cursor-pointer text-cyan-400 hover:bg-cyan-500/8 btn-lightning-hover sidebar-item-highlight sidebar-item-glow nav-neon sheen transition-all duration-300">
              <UserCheck className="w-4 h-4 shrink-0 text-cyan-400" /> About Developer
            </button>

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => onNavigate('settings')} className="flex items-center gap-2 px-3 py-2.5 border border-zinc-400 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-indigo-700 dark:hover:text-white hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 rounded-xl cursor-pointer text-xs font-bold sidebar-item-glow hover-lift transition-all duration-300 shadow-sm"><Settings className="w-4 h-4" /><span>Settings</span></button>
              {onClearHistory && <button onClick={onClearHistory} className="flex items-center gap-2 px-3 py-2.5 border border-orange-400 dark:border-rose-700 text-orange-700 dark:text-rose-300 hover:text-white hover:bg-orange-600 dark:hover:bg-rose-600 hover:border-orange-600 dark:hover:border-rose-500 rounded-xl cursor-pointer text-xs font-bold sidebar-item-glow hover-lift transition-all duration-300 shadow-sm hover:shadow-[0_0_14px_rgba(244,63,94,0.25)]"><Trash2 className="w-4 h-4" /><span>Clear History</span></button>}
            </div>
          </>
        ) : (
          <>
            <RailBtn icon={<Boxes className="w-5 h-5" />} label="Model Catalog & Matrix" onClick={() => setIsModelHubOpen(true)} violet />
            <RailBtn icon={<FolderOpen className="w-5 h-5 text-cyan-400" />} label="Project Folder" onClick={onOpenWorkspace} />
            <RailBtn icon={<Activity className="w-5 h-5 text-emerald-400" />} label="Analytics Dashboard" onClick={onOpenAnalytics} />
            <RailBtn icon={<Brain className="w-5 h-5" />} label="Manage AI Memory" onClick={() => setIsMemoryOpen(true)} />
            {onOpenHub && <RailBtn icon={<Blocks className="w-5 h-5 text-indigo-300" />} label="Skills & Connectors" onClick={onOpenHub} />}
            {onOpenAuth && <RailBtn icon={<LogIn className="w-5 h-5 text-rose-400" />} label="Sign In / Register" onClick={onOpenAuth} />}
            {onOpenPairing && <RailBtn icon={<QrCode className="w-5 h-5 text-sky-400" />} label="Link Your Phone" onClick={onOpenPairing} />}
            <RailBtn icon={<UserCheck className="w-5 h-5" />} label="About Developer" onClick={onOpenDeveloper} />
            <RailBtn icon={<Settings className="w-5 h-5" />} label="Settings" onClick={() => onNavigate('settings')} />
          </>
        )}
      </div>
    </aside>
  );

  /* Mobile sidebar */
  const mobileSidebar = (
    <>
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#1a1b1e] border-b border-zinc-800 shrink-0 z-30 mobile-px-4 mobile-py-3">
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
          className="text-zinc-400 hover:text-white p-1.5 rounded-xl bg-zinc-800 border border-zinc-700 cursor-pointer"
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
        className={`md:hidden fixed top-0 bottom-0 left-0 w-[268px] max-w-full bg-[#1a1b1e] border-r border-zinc-800 flex flex-col z-50 transition-transform duration-300 sidebar-mobile-fix sidebar-mobile-scroll ${mobileOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}`}
      >
        <div className="p-4 flex items-center justify-between border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Logo3DMotion size="sm" />
            <div>
              <div className="text-sm font-black tracking-wider uppercase leading-none flex items-center">
                <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-400 bg-clip-text text-transparent font-extrabold">SMARAN</span>
                <span className="text-white font-extrabold ml-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 text-[10px]">.AI</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} className="text-zinc-500 hover:text-white cursor-pointer" aria-label="Close navigation menu"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-3 shrink-0">
          <button onClick={() => { onCreateSession(); onNavigate('chat'); setMobileOpen(false); }}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800/60 hover:bg-zinc-700/70 text-zinc-200 font-bold text-xs uppercase tracking-wider rounded-full py-2.5 border border-zinc-700/40 transition-all cursor-pointer">
            <Plus className="w-4 h-4 text-indigo-400" /> New Conversation
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-1 space-y-1">
          <span className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest px-2 mb-2">Chat History</span>
          {sessions.length === 0 ? (
            <p className="text-xs text-zinc-600 italic px-2 py-1 font-bold">No conversations yet.</p>
          ) : sessions.map(s => (
            <div key={s.id} onClick={() => handleSessionClick(s.id)}
              className={`group w-full flex items-center justify-between rounded-full px-3 py-2 text-xs font-bold cursor-pointer transition-all border btn-lightning-hover ${activeSessionId === s.id && activeView === 'chat' ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'text-zinc-400 hover:bg-zinc-800/60 border-transparent hover:shadow-[0_0_8px_rgba(99,102,241,0.08)]'}`}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                <span className="truncate">{s.title}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => handleStartEdit(e, s)} className="p-0.5 text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 rounded cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={e => { e.stopPropagation(); onDeleteSession(s.id); }} className="p-0.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-zinc-800 space-y-1.5 shrink-0 max-h-[55dvh] overflow-y-auto overscroll-contain sidebar-mobile-footer">
          <button onClick={() => { setIsModelHubOpen(true); setMobileOpen(false); }} className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent cursor-pointer text-indigo-400 hover:bg-indigo-500/8">
            <Boxes className="w-4 h-4 shrink-0 text-indigo-400" /> Model Catalog & Matrix
          </button>
          {onOpenAnalytics && (
            <button onClick={() => { onOpenAnalytics(); setMobileOpen(false); }} className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent cursor-pointer text-emerald-400 hover:bg-emerald-500/8">
              <Activity className="w-4 h-4 shrink-0 text-emerald-400" /> Analytics Dashboard
            </button>
          )}
          <button onClick={() => { setIsMemoryOpen(true); setMobileOpen(false); }} className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent cursor-pointer text-violet-400 hover:bg-violet-500/8">
            <Brain className="w-4 h-4 shrink-0" /> Manage AI Memory
          </button>
          {onOpenPairing && (
            <button onClick={() => { onOpenPairing(); setMobileOpen(false); }} className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent cursor-pointer text-sky-400 hover:bg-sky-500/8">
              <QrCode className="w-4 h-4 shrink-0 text-sky-400" /> Link Your Phone
            </button>
          )}
          <button onClick={() => { onOpenDeveloper(); setMobileOpen(false); }} className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent cursor-pointer text-cyan-400 hover:bg-cyan-500/8">
            <UserCheck className="w-4 h-4 shrink-0 text-cyan-400" /> About Developer
          </button>
          {onTogglePerformance && (
            <button onClick={() => { onTogglePerformance(); setMobileOpen(false); }} className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent cursor-pointer text-emerald-400 hover:bg-emerald-500/10">
              <Activity className="w-4 h-4 shrink-0 text-emerald-400 animate-pulse" /> Live Hardware Performance
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { onNavigate('settings'); setMobileOpen(false); }} className="min-w-0 w-full flex items-center justify-center gap-1.5 px-2 py-2.5 border border-zinc-800 text-zinc-300 hover:text-white rounded-xl cursor-pointer text-[11px] font-bold"><Settings className="w-4 h-4 shrink-0" /><span className="break-words">Settings</span></button>
            {onClearHistory && <button onClick={() => { onClearHistory(); setMobileOpen(false); }} className="min-w-0 w-full flex items-center justify-center gap-1.5 px-2 py-2.5 border border-rose-800 text-rose-300 hover:text-white hover:border-rose-600 rounded-xl cursor-pointer text-[11px] font-bold"><Trash2 className="w-4 h-4 shrink-0" /><span className="break-words">Clear History</span></button>}
          </div>

          <div 
            onClick={() => { onOpenDeveloper(); setMobileOpen(false); }}
            className="pt-2 border-t border-zinc-800/60 text-center cursor-pointer hover:bg-zinc-800/40 py-1.5 rounded-xl transition-all"
            title="Click to view Developer Profile & Architecture"
          >
            <div className="text-[10px] font-semibold text-zinc-500">
              Developed by <span className="font-extrabold text-indigo-400 hover:underline">SHASHWAT MISHRA</span>
            </div>
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
