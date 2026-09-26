import React, { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import WorkspacePanel from './components/WorkspacePanel';
import DirectorPanel from './components/DirectorPanel';
import ChatArea from './components/ChatArea';
import CollectionManager from './components/CollectionManager';
import SettingsModal from './components/SettingsModal';
import RightPanel from './components/RightPanel';
import StarfieldCanvas from './components/StarfieldCanvas';
import ErrorBoundary from './components/ErrorBoundary';
import AnalyticsModal from './components/AnalyticsModal';
import ModelHubModal from './components/ModelHubModal';
import DeveloperModal from './components/DeveloperModal';
import DevicePairing from './components/DevicePairing';
import PinLock from './components/PinLock';
import GoogleAuthGate, { getSavedGoogleUser, signOutEverywhere } from './components/GoogleAuthGate';
import { couldBePinned, isPhone, isHandheld } from './utils/device';
import UpdateNotice from './components/UpdateNotice';
import ExtensionsHub from './components/ExtensionsHub';
import DesktopPet from './components/DesktopPet';
import PipCompanion from './components/PipCompanion';
import NoticeToast from './components/NoticeToast';
import TerminalPanel from './components/TerminalPanel';
import SmaranDesignView from './components/SmaranDesignView';
import ScheduledTasksView from './components/ScheduledTasksView';
import { loadShortcuts, matches, SHORTCUTS_EVENT } from './utils/shortcuts';
import ImageStudio from './components/ImageStudio';
import LiveBrowser from './components/LiveBrowser';
import VideoStudio from './components/VideoStudio';
import DispatchView from './components/DispatchView';
import { API_BASE, fetchWithAuth, getCurrentUser } from './context/AuthContext';
import { isNativeApp, loadLink } from './utils/hostLink';
import { useBackClose } from './utils/backStack';
import * as standalone from './utils/standalone';
import * as localChat from './utils/localChat';
import * as usage from './utils/usage';

/** Written in at build time, so the count says which version it came from. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'unknown';

/** No computer linked, in the packaged phone app: nothing behind /api. */
const noBackendHere = () => isNativeApp() && !loadLink()?.url;



/* The phone app needs a model, not a computer.
 *
 * This used to sit at the top of the screen for ever, on every launch, saying
 * that nothing would work until a computer was paired. That was true when the
 * only way to answer anything was a backend - and it is not true now: the app
 * talks to a provider directly, with a key kept on the device.
 *
 * So the only thing worth saying is when there is no model set up yet, and it
 * links to the screen that fixes that. Pairing a computer is still offered
 * from Settings, for the things that genuinely need one: documents, local
 * models, and driving that machine.
 */
const needsModel = () => isNativeApp() && !loadLink()?.url && !standalone.isReady();

/** Mounted from the first visit on; hidden, not destroyed, when not in front. */
function KeepAlive({ active, seen, children }) {
  if (!seen && !active) return null;
  return <div className={active ? 'contents' : 'hidden'} aria-hidden={!active}>{children}</div>;
}

const App = () => {
  // Strict Auth state — gated strictly by GoogleAuthGate; must sign in with Google
  const [currentUser, setCurrentUser] = useState(() => getSavedGoogleUser());

  // Navigation & View state
  const [activeView, setActiveView] = useState('chat');
  // Every view opened so far; those wrapped in KeepAlive stay mounted.
  const [visitedViews, setVisitedViews] = useState(() => new Set(['chat']));
  useEffect(() => {
    setVisitedViews((prev) => (prev.has(activeView) ? prev : new Set(prev).add(activeView)));
  }, [activeView]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelHubOpen, setIsModelHubOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isDirectorOpen, setIsDirectorOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isDeveloperOpen, setIsDeveloperOpen] = useState(false);
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  // Opened from the sidebar, or by asking for it. There was no terminal
  // before this; what looked like one on the extensions screen was a name
  // in an array with nothing behind it.
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  useEffect(() => {
    const updatePhoneLayout = () => {
      const phone = isPhone();
      document.documentElement.classList.toggle('sm-phone-device', phone);
      document.documentElement.classList.toggle('sm-phone-landscape', phone && window.innerWidth > window.innerHeight);
    };
    updatePhoneLayout();
    window.addEventListener('resize', updatePhoneLayout);
    return () => window.removeEventListener('resize', updatePhoneLayout);
  }, []);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const sessionRetryRef = useRef(null);
  const sessionsMountedRef = useRef(true);
  const [activeCollections, setActiveCollections] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('sm_selected_model');
    return (saved && saved !== 'auto') ? saved : 'qwen2.5-coder:7b';
  });
  const [turboMode] = useState(false);
  const [, setSidebarExpanded] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(() => {
    const saved = localStorage.getItem('showRightPanel');
    return saved !== 'false';
  });
  const [sidebarPosition, setSidebarPosition] = useState(() => {
    const saved = localStorage.getItem('sm_sidebar_position');
    return saved === 'right' ? 'right' : 'left';
  });
  const [performancePosition, setPerformancePosition] = useState(() => {
    const saved = localStorage.getItem('sm_performance_position');
    return ['left', 'right', 'hidden'].includes(saved) ? saved : 'right';
  });
  const [activeSection, setActiveSection] = useState(
    () => (typeof window !== 'undefined' ? localStorage.getItem('sm_active_section') || 'code' : 'code'),
  );

  const handleSectionChange = (section) => {
    setActiveSection(section);
    if (typeof window !== 'undefined') localStorage.setItem('sm_active_section', section);
    setActiveSessionId(null);
    fetchSessions(section);
    // Chat and Code are both the conversation view; from Images or Design the
    // tab changed the list but left you looking at the other page.
    setActiveView('chat');
  };

  /* The pinned layout follows the window, not the button.

     sm-pip was only ever applied by the picture-in-picture button, so the
     page had no idea it was pinned unless it had been told. Enter it any
     other way - a voice command, a restart while pinned, the window dragged
     small by hand - and the full workspace stayed laid out inside a 300px
     window: the phone header, the composer and the desktop pet all drawn
     over the character.

     Width is the honest signal on a desktop. It is a terrible one on a phone,
     and that was the bug behind "the input bar does not show": every phone is
     360 to 430 pixels wide, so every phone matched, and html.sm-pip sets
     display:none on the composer, the pet and the header controls. The app
     was treating each of them as a pinned window and hiding the thing you
     type into. Nothing about the packaged phone app is ever pinned. */
  useEffect(() => {
    if (isNativeApp()) return undefined;

    /* Width alone was never the signal, and guarding on the packaged app was
       not enough. A phone pointed at a paired computer - 192.168.1.5:3003 in
       a browser - is not the packaged app, so it matched again: 375px wide,
       html.sm-pip applied, and display:none on the composer, the pet and
       everything marked pip-hide. Tapping the input made the input vanish.
       Same bug, one guard short.
    
       A pinned window is small AND driven by a mouse. A phone is small and
       driven by a finger, and no phone is ever a picture-in-picture window.
       Pointer type separates the two honestly, where width cannot. */
    const mouse = window.matchMedia('(pointer: fine)');
    const apply = () => {
      document.documentElement.classList.toggle('sm-pip', couldBePinned());
    };
    apply();
    window.addEventListener('resize', apply);
    mouse.addEventListener('change', apply);
    return () => {
      window.removeEventListener('resize', apply);
      mouse.removeEventListener('change', apply);
    };
  }, []);

  /* Fill in anything the backend knows and the stored session does not.

     This used to spread the whole reply over the signed-in user, and on the
     desktop that quietly erased them. /api/auth/me resolves a loopback caller
     to the machine's own device account - `{id: 1, username:
     "device_local_default_user", email: null}` - by design, because the
     person at that keyboard owns the install. Spreading it put `email: null`
     and a generated username on top of a real identity, so a successful
     sign-in showed "No email address on this session" in Settings and "You"
     in the sidebar, seconds after the backend had logged the real address.

     Two rules now. Only truthy values are taken, so nothing known is
     replaced by nothing. And a reply that is the generated device account is
     ignored outright - it is not a person, and it must never overwrite one. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = getSavedGoogleUser();
        if (!saved) return;
        const user = await getCurrentUser();
        if (cancelled || !user) return;
        const generated = /^(device[_-]|local[_-])/i.test(user.username || '');
        if (generated) return;
        const known = Object.fromEntries(
          Object.entries(user).filter(([, value]) => value !== null && value !== undefined && value !== ''),
        );
        if (!Object.keys(known).length) return;
        setCurrentUser((prev) => ({ ...(prev || saved), ...known }));
      } catch {
        /* keep current authenticated user */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem('showRightPanel', showRightPanel);
  }, [showRightPanel]);
  useEffect(() => { localStorage.setItem('sm_sidebar_position', sidebarPosition); }, [sidebarPosition]);
  useEffect(() => { localStorage.setItem('sm_performance_position', performancePosition); }, [performancePosition]);
  useEffect(() => { localStorage.setItem('sm_selected_model', selectedModel); }, [selectedModel]);

  // Keyboard shortcuts - whatever Settings -> Shortcuts has saved (utils/shortcuts).
  useEffect(() => {
    let list = loadShortcuts();
    const reload = () => { list = loadShortcuts(); };
    const actions = {
      new_chat: () => handleCreateSession(),
      open_settings: () => setIsSettingsOpen((prev) => !prev),
      toggle_panel: () => setShowRightPanel((prev) => !prev),
      toggle_terminal: () => setIsTerminalOpen((prev) => !prev),
      voice_speak: () => { setActiveView('chat'); window.dispatchEvent(new CustomEvent('smaran:toggle-voice')); },
      stop_control: () => fetch(`${API_BASE}/api/control/stop`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).catch(() => {}),
      mute_audio: () => fetch(`${API_BASE}/api/desktop/execute`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_mute', params: {}, confirmed: false }),
      }).catch(() => {}),
    };
    const handleKeyDown = (e) => {
      const hit = list.find((s) => matches(e, s.keys));
      if (!hit || !actions[hit.id]) return;
      e.preventDefault();
      actions[hit.id]();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(SHORTCUTS_EVENT, reload);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(SHORTCUTS_EVENT, reload);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every control in the composer - the text box, Speak, RAG, Web, attach
  // and send - is disabled while activeSessionId is null. So if this function
  // ends without a session, the app opens looking perfectly normal and
  // accepts nothing at all. That was the "Start a new conversation" box that
  // would not take typing: an empty session list was handled, but a request
  // that simply failed was not, and that left the id null. On a phone talking
  // to a paired computer, a failed request is the common case.
  async function fetchSessions(section = activeSection) {
    /* No backend: the conversation list lives on the device.
       Without this a fresh session id was invented on every launch, so the
       previous conversation was still on disk and nothing ever went looking
       for it - the app opened empty every time. */
    if (noBackendHere()) {
      const stored = (localChat.loadSessions() || []).filter(s => !s.section || s.section === section);
      if (stored.length) {
        setSessions(stored);
        setActiveSessionId(current => current || stored[0].id);
        return;
      }
      const first = {
        id: `local-${Date.now()}`,
        title: section === 'code' ? 'New Coding Task' : 'New Conversation',
        section,
        created_at: new Date().toISOString(),
      };
      localChat.saveSessions([first]);
      setSessions([first]);
      setActiveSessionId(first.id);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions?section=${encodeURIComponent(section)}`);
      if (res.ok) {
        const data = await res.json();
        if (!sessionsMountedRef.current) return;
        const sessionList = Array.isArray(data) ? data : [];
        setSessions(sessionList);
        if (sessionList.length > 0) {
          const withContent = sessionList.find((item) => (item.message_count || 0) > 0);
          setActiveSessionId(current => current || (withContent || sessionList[0]).id);
          return;
        } else {
          setActiveSessionId(null);
        }
        return;
      }
    } catch (err) {
      console.error(err);
    }

    if (!activeSessionId && sessionsMountedRef.current) {
      clearTimeout(sessionRetryRef.current);
      sessionRetryRef.current = setTimeout(() => { void fetchSessions(section); }, 2000);
    }
  }

  /* How tall the window really is.
   *
   * The CSS viewport lies in an Android WebView: 100dvh, and height:100% from
   * html, are both the whole screen including the strip the gesture bar sits
   * over. visualViewport.height is what is actually visible, and it also
   * shrinks when the keyboard opens - so publishing it keeps the composer on
   * screen in both cases with one measurement.
   *
   * Written to the document so CSS can use it; see .sm-app-shell. */
  useEffect(() => {
    const viewport = window.visualViewport;
    const publish = () => {
      const height = Math.round(viewport?.height || window.innerHeight);
      if (height > 0) {
        document.documentElement.style.setProperty('--sm-vh', `${height}px`);
      }
    };
    publish();
    viewport?.addEventListener('resize', publish);
    window.addEventListener('resize', publish);
    window.addEventListener('orientationchange', publish);
    return () => {
      viewport?.removeEventListener('resize', publish);
      window.removeEventListener('resize', publish);
      window.removeEventListener('orientationchange', publish);
    };
  }, []);

  useEffect(() => {
    sessionsMountedRef.current = true;
    fetchSessions();
    return () => {
      sessionsMountedRef.current = false;
      clearTimeout(sessionRetryRef.current);
    };
  }, []);

  /* Counted once per start, and only from the packaged phone app - the
     desktop build has the backend's own reporter and would otherwise be
     counted twice. */
  useEffect(() => {
    if (!isNativeApp()) return;
    usage.reportStartup({ platform: 'android', appVersion: APP_VERSION });
  }, []);

  /* `switchView` exists because Design Studio needs a session without being
     sent to the chat. It generates in place now, but asking for a session
     dragged the whole view along: every caller got setActiveView('chat'), so
     pressing Generate still jumped to the chat screen even though Design
     Studio itself no longer navigates. Chat callers keep the old behaviour by
     default. */
  async function handleCreateSession({ switchView = true, section = activeSection } = {}) {
    const isIsolated = switchView === false;
    const sessionSection = section || activeSection;
    if (noBackendHere()) {
      const created = {
        id: `local-${Date.now()}`,
        title: sessionSection === 'code' ? 'New Coding Task' : (sessionSection === 'design' ? 'Design Session' : 'New Conversation'),
        section: sessionSection,
        created_at: new Date().toISOString(),
      };
      const all = [created, ...localChat.loadSessions()].slice(0, 60);
      localChat.saveSessions(all);
      if (!isIsolated) {
        setSessions(all.filter(s => !s.section || s.section === activeSection));
        setActiveSessionId(created.id);
        setActiveView('chat');
      }
      return created;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: sessionSection,
          title: sessionSection === 'code' ? 'New Coding Task' : (sessionSection === 'design' ? 'Design Session' : 'New Conversation'),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!isIsolated) {
          setSessions((prev) => [data, ...(Array.isArray(prev) ? prev : [])]);
          setActiveSessionId(data.id);
          setActiveView('chat');
        }
        return data;
      }
    } catch (err) {
      console.error(err);
    }
    const localSession = {
      id: `local-${Date.now()}`,
      title: sessionSection === 'code' ? 'New Coding Task' : (sessionSection === 'design' ? 'Design Session' : 'New Conversation'),
      section: sessionSection,
      created_at: new Date().toISOString(),
    };
    if (!isIsolated) {
      setSessions((prev) => [localSession, ...(Array.isArray(prev) ? prev : [])]);
      setActiveSessionId(localSession.id);
      setActiveView('chat');
    }
    return localSession;
  }

  const handleMoveSession = async (id, targetSection) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions/${id}/section`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: targetSection }),
      });
      if (res.ok) {
        fetchSessions(activeSection);
      }
    } catch (err) {
      console.error('Failed to move session section:', err);
    }
  };

  const handleDeleteSession = async (id) => {
    if (noBackendHere() || String(id).startsWith('local-')) {
      const remaining = (localChat.loadSessions() || []).filter((s) => s && s.id !== id);
      localChat.saveSessions(remaining);
      setSessions(remaining);
      if (activeSessionId === id) {
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSessions((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const remaining = list.filter((s) => s && s.id !== id);
          if (activeSessionId === id) {
            setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
          }
          return remaining;
        });
      }
    } catch (err) {
      console.error(err);
      setSessions((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const remaining = list.filter((s) => s && s.id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
        }
        return remaining;
      });
    }
  };

  const handleClearHistory = async () => {
    if (noBackendHere()) {
      localChat.saveSessions([]);
      setSessions([]);
      setActiveSessionId(null);
      await handleCreateSession();
      return true;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/privacy/clear-all`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSessions([]);
        setActiveSessionId(null);
        await handleCreateSession();
        return true;
      } else {
        alert('Failed to clear history. Please try again.');
        return false;
      }
    } catch (err) {
      console.error(err);
      localChat.saveSessions([]);
      setSessions([]);
      setActiveSessionId(null);
      await handleCreateSession();
      return true;
    }
  };

  const handleRenameSession = async (id, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    const cleanTitle = newTitle.trim();
    try {
      const all = (localChat.loadSessions() || []).map((s) => (s && s.id === id ? { ...s, title: cleanTitle } : s));
      localChat.saveSessions(all);
    } catch {}
    setSessions((prev) => (Array.isArray(prev) ? prev : []).map((s) => (s && s.id === id ? { ...s, title: cleanTitle } : s)));
    if (noBackendHere() || String(id).startsWith('local-')) {
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: cleanTitle })
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) => (Array.isArray(prev) ? prev : []).map((s) => (s && s.id === id ? { ...s, title: data.title || cleanTitle } : s)));
      }
    } catch (err) {
      console.error('Failed to sync rename with server, kept local title:', err);
    }
  };

  // Tracked live rather than read once, so rotating the phone or resizing a
  // window mounts and unmounts the desktop-only panels correctly.
  const [isWideScreen, setIsWideScreen] = useState(
    () => typeof window === 'undefined' || (!isPhone() && window.matchMedia('(min-width: 768px)').matches),
  );
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const update = (event) => setIsWideScreen(!isPhone() && event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // The full-screen sections - Plugins, Sites - are rendered embedded, with no
  // close prop, and on a phone the sidebar that would take you back is hidden
  // behind the menu. There was no way out of them at all. They ask to go home
  // through this.
  useEffect(() => {
    const goHome = (event) => {
      if (event.detail?.view === 'terminal') { setIsTerminalOpen(true); return; }
      setActiveView(event.detail?.view || 'chat');
    };
    window.addEventListener('smaran:navigate', goHome);
    return () => window.removeEventListener('smaran:navigate', goHome);
  }, []);

  /* Back closes what is on top, and only leaves the app when nothing is open.
     Order does not matter here - each overlay owns its own history entry, so
     they nest by themselves. */
  /* Topmost first: the pairing screen opens over Settings, so Back must
     close it and leave Settings where it was. The views come last - they are
     the thing underneath everything else. */
  useBackClose([
    { open: isPairingOpen, close: () => setIsPairingOpen(false) },
    { open: isDeveloperOpen, close: () => setIsDeveloperOpen(false) },
    { open: isAnalyticsOpen, close: () => setIsAnalyticsOpen(false) },
    { open: isModelHubOpen, close: () => setIsModelHubOpen(false) },
    { open: isWorkspaceOpen, close: () => setIsWorkspaceOpen(false) },
    { open: isDirectorOpen, close: () => setIsDirectorOpen(false) },
    { open: isTerminalOpen, close: () => setIsTerminalOpen(false) },
    { open: isSettingsOpen, close: () => setIsSettingsOpen(false) },
    { open: activeView !== 'chat', close: () => setActiveView('chat') },
  ]);

  const [settingsTab, setSettingsTab] = useState('general');

  const handleSignOut = () => {
    // Fire and forget: the gate is reset by the event signOutEverywhere
    // dispatches, so the screen does not wait on the network to respond.
    signOutEverywhere();
    setCurrentUser(null);
    setIsSettingsOpen(false);
  };

  // The views that actually have a branch in the render below. Kept next to
  // handleNavigate so the two cannot drift apart again.
  // 'scheduled' is absent on a phone or tablet: cron belongs to the machine
  // hosting SMARAN, and the sidebar no longer offers it there. Listed here too
  // so a saved view, or a link, cannot land on a screen with nothing in it.
  const RENDERABLE_VIEWS = new Set(['chat', 'collections', 'plugins', 'design', 'dispatch',
    // Images and video are offered on a phone too: one paired to a computer
    // reaches that computer's engine perfectly well, and a standalone one
    // says so on the screen rather than being refused the destination.
    'images', 'videos', 'browser',
    ...(isHandheld() ? [] : ['scheduled'])]);

  const handleNavigate = (view) => {
    if (view === 'settings') {
      setSettingsTab('general');
      setIsSettingsOpen(true);
    } else if (view === 'updates') {
      setSettingsTab('updates');
      setIsSettingsOpen(true);
    } else if (view === 'models') {
      setIsModelHubOpen(true);
    } else if (view === 'terminal') {
      // Not a view - a panel over whatever you were doing. Without this the
      // guard below would have swallowed it silently, which is exactly the
      // failure that guard exists to prevent.
      setIsTerminalOpen(true);
    } else if (view === 'account') {
      // The PRO badge sends 'account', which used to fall through to
      // setActiveView('account') - and nothing below renders that view, so
      // the whole workspace went blank. The settings modal has had an
      // "Account & Profile" tab all along; this opens it.
      setSettingsTab('account');
      setIsSettingsOpen(true);
    } else if (RENDERABLE_VIEWS.has(view)) {
      setActiveView(view);
    }
    // Anything else is ignored on purpose. 'login' is inert - this build has
    // no accounts - and setting activeView to a name nothing renders empties
    // the workspace, which is how the PRO badge came to show a blank screen.
    // Staying put is always better than going blank.
  };

  return (
    <GoogleAuthGate onUserChange={setCurrentUser}>
    {/* Nothing behind the lock is rendered until the PIN is accepted, so the
        workspace is never briefly visible on the way in. */}
    <PinLock>
    {/* The banner sits above the workspace rather than inside it: the frame
        below becomes a row on wide screens, and a notice dropped into that
        row would be laid out as a column beside the sidebar. */}
    <div className="sm-app-shell w-full flex flex-col overflow-hidden">
      {needsModel() && (
        <div className="shrink-0 z-30 px-4 py-2.5 flex items-center justify-between gap-3 bg-indigo-500/10 border-b border-indigo-500/30 text-[13px] text-indigo-700 dark:text-indigo-200">
          <span>Pick a model to start. Several are free.</span>
          <button
            type="button"
            onClick={() => { setSettingsTab('provider'); setIsSettingsOpen(true); }}
            className="shrink-0 rounded-lg border border-indigo-400/50 px-3 py-1 font-medium hover:bg-indigo-400/15"
          >
            Set up
          </button>
        </div>
      )}
    <div className="sm-app-frame flex-1 min-h-0 w-full flex flex-col md:flex-row bg-[#ffffff] dark:bg-[#0c0c0e] text-[#1f1f1f] dark:text-[#e3e3e3] overflow-hidden font-sans relative transition-colors duration-300">
      <StarfieldCanvas />

      {/* Sidebar Panel */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onClearHistory={handleClearHistory}
        activeCollections={activeCollections}
        setActiveCollections={setActiveCollections}
        onNavigate={handleNavigate}
        activeView={activeView}
        onExpandChange={setSidebarExpanded}
        isModelHubOpen={isModelHubOpen}
        onOpenWorkspace={() => setIsWorkspaceOpen(true)}
        onOpenDirector={() => setIsDirectorOpen(true)}
        setIsModelHubOpen={setIsModelHubOpen}
        onModelChange={setSelectedModel}
        position={sidebarPosition}
        onTogglePerformance={() => setShowRightPanel((v) => !v)}
        showPerformance={showRightPanel}
        onOpenAnalytics={() => setIsAnalyticsOpen(true)}
        onOpenDeveloper={() => setIsDeveloperOpen(true)}
        onOpenPairing={() => setIsPairingOpen(true)}
        token={currentUser?.session_token}
        user={currentUser}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onMoveSession={handleMoveSession}
      />

      {/* Main Workspace Frame */}
      <main className="order-2 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative z-10 glass-panel border-t md:border-t-0 border-zinc-200 dark:border-zinc-850/50">
        {/* A way out of the full-screen sections that does not rely on knowing
            the hardware Back button exists, or on finding the sidebar behind
            the menu. Phones only; on a wide screen the sidebar is right there. */}
        {activeView !== 'chat' && (
          <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur">
            <button
              type="button"
              onClick={() => setActiveView('chat')}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70"
              aria-label="Back to chat"
            >
              <span aria-hidden="true">←</span> Back
            </button>
            <span className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              {activeView === 'plugins' ? 'Plugins & Skills'
                : activeView === 'collections' ? 'Collections'
                : activeView === 'design' ? 'SMARAN Design'
                : activeView === 'scheduled' ? 'Scheduled Tasks'
                : activeView === 'images' ? 'Images'
                : activeView === 'videos' ? 'Video'
                : activeView === 'browser' ? 'Live Browser'
                : activeView === 'dispatch' ? 'Dispatch' : ''}
            </span>
          </div>
        )}

        {/* Views with work that runs for a while - a conversation, a design,
            an image or a video - stay mounted once opened and are only hidden
            when you move elsewhere. Unmounting them threw away whatever they
            were in the middle of: a Design Studio job was gone by the time you
            came back to it. */}
        <KeepAlive active={activeView === 'chat'} seen={visitedViews.has('chat')}>
          <ChatArea
            token={currentUser?.session_token}
            currentUser={currentUser}
            activeSessionId={activeSessionId}
            activeCollections={activeCollections}
            setActiveCollections={setActiveCollections}
            selectedModel={selectedModel}
            turboMode={turboMode}
            onTogglePanel={() => setShowRightPanel((v) => !v)}
            onOpenModelHub={() => setIsModelHubOpen(true)}
            onOpenAnalytics={() => setIsAnalyticsOpen(true)}
            onOpenWorkspace={() => setIsWorkspaceOpen(true)}
            onEnsureSession={handleCreateSession}
            performancePosition={performancePosition}
            activeSection={activeSection}
            onSectionChange={handleSectionChange}
          />
        </KeepAlive>

        <KeepAlive active={activeView === 'design'} seen={visitedViews.has('design')}>
          <SmaranDesignView
            onClose={() => setActiveView('chat')}
            onNavigate={handleNavigate}
            onEnsureSession={handleCreateSession}
            onOpenTerminal={() => setIsTerminalOpen(true)}
          />
        </KeepAlive>
        {activeView === 'collections' && (
          <CollectionManager />
        )}
        <KeepAlive active={activeView === 'images'} seen={visitedViews.has('images')}><ImageStudio /></KeepAlive>
        <KeepAlive active={activeView === 'videos'} seen={visitedViews.has('videos')}><VideoStudio /></KeepAlive>
        {activeView === 'browser' && <LiveBrowser />}
        {activeView === 'plugins' && <ExtensionsHub embedded />}
        {activeView === 'scheduled' && !isHandheld() && (
          <ScheduledTasksView
            onNavigate={handleNavigate}
            onEnsureSession={handleCreateSession}
          />
        )}
        {activeView === 'dispatch' && (
          <DispatchView
            onNavigate={handleNavigate}
            onOpenPairing={() => setIsPairingOpen(true)}
          />
        )}
      </main>

      {/* Right side Task Manager / Brand panel — desktop only */}
      {/* Gated on isWideScreen rather than only on a "hidden md:contents"
          wrapper. That wrapper hid the panel on a phone but still mounted it,
          so the telemetry WebSocket, its four-second reconnect and its polling
          all kept running for a panel nobody could see - constant radio and
          CPU work on the device least able to spare it. */}
      {activeView === 'chat' && showRightPanel && isWideScreen && <div className="hidden md:contents"><RightPanel selectedModel={selectedModel} showPanel={showRightPanel && performancePosition !== 'hidden'} position={performancePosition} onClose={() => setShowRightPanel(false)} /></div>}

      {/* Settings Dialog Overlay */}
      <ErrorBoundary>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          currentUser={currentUser}
          onSignOut={handleSignOut}
          initialTab={settingsTab}
          onModelChange={setSelectedModel}
          selectedModel={selectedModel}
          sidebarPosition={sidebarPosition}
          onSidebarPositionChange={setSidebarPosition}
          performancePosition={performancePosition}
          onPerformancePositionChange={(value) => { setPerformancePosition(value); if (value !== 'hidden') setShowRightPanel(true); }}
          onOpenConnections={() => { setIsSettingsOpen(false); setIsPairingOpen(true); }}
          onOpenModels={() => { setIsSettingsOpen(false); setIsModelHubOpen(true); }}
          onOpenAnalytics={() => { setIsSettingsOpen(false); setIsAnalyticsOpen(true); }}
          onOpenMemory={() => { setIsSettingsOpen(false); window.dispatchEvent(new CustomEvent('smaran:open-memory')); }}
          onOpenDeveloper={() => { setIsSettingsOpen(false); setIsDeveloperOpen(true); }}
        />
      </ErrorBoundary>

      {/* Analytics Dashboard Overlay */}
      <ErrorBoundary>
        <AnalyticsModal
          isOpen={isAnalyticsOpen}
          onClose={() => setIsAnalyticsOpen(false)}
          token={currentUser?.session_token}
          apiBase={API_BASE}
        />
      </ErrorBoundary>

      {/* Model Matrix & Catalog Overlay */}
      <ErrorBoundary>
        <ModelHubModal
          isOpen={isModelHubOpen}
          onClose={() => setIsModelHubOpen(false)}
          onSelectModel={(model) => setSelectedModel(model)}
          selectedModel={selectedModel}
        />
      </ErrorBoundary>

      {/* Says when a newer build exists. Installs nothing by itself. */}
      <ErrorBoundary>
        <UpdateNotice />
      </ErrorBoundary>

      {/* The second sign-in panel is gone. It was a full email and
          password screen - the thing being removed - and a duplicate of the
          gate that already stands in front of the whole app. The sidebar
          entry that opened it falls back to the account screen on its own. */}

      {/* Pairing a phone with this computer, and the devices already linked. */}
      <ErrorBoundary>
        <DevicePairing
          isOpen={isPairingOpen}
          onClose={() => setIsPairingOpen(false)}
        />
      </ErrorBoundary>

      {/* Developer Profile Overlay */}
      <ErrorBoundary>
        <DeveloperModal
          isOpen={isDeveloperOpen}
          onClose={() => setIsDeveloperOpen(false)}
        />
      </ErrorBoundary>

      <WorkspacePanel isOpen={isWorkspaceOpen} onClose={() => setIsWorkspaceOpen(false)} />
      <DirectorPanel isOpen={isDirectorOpen} onClose={() => setIsDirectorOpen(false)} />
      {/* The pet used to be wrapped in "hidden md:contents", which hid it on
          every phone. It was showing on mobile before that and sitting on top
          of the input bar; hiding it answered the nuisance by removing the
          feature. It is back, and now positions itself above the composer
          rather than over it. */}
      <DesktopPet />
      <PipCompanion />
      <NoticeToast />

      <TerminalPanel isOpen={isTerminalOpen} onClose={() => setIsTerminalOpen(false)} />
    </div>
    </div>
    </PinLock>
    </GoogleAuthGate>
  );
};

export default App;
