import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import WorkspacePanel from './components/WorkspacePanel';
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
import AuthModal from './components/AuthModal';
import UpdateNotice from './components/UpdateNotice';
import ExtensionsHub from './components/ExtensionsHub';
import SitesHub from './components/SitesHub';
import DesktopPet from './components/DesktopPet';
import TerminalPanel from './components/TerminalPanel';
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


// SMARAN.AI runs as a free, offline, single-user desktop app. There is no
// login, sign-up, Google auth, or legal gate — the local device is the user.
const LOCAL_USER = { id: 'local', username: 'You', email: 'local@smaran.ai', role: 'user' };

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

const App = () => {
  // Auth state — always the local device user; never gated.
  const [currentUser, setCurrentUser] = useState(LOCAL_USER);

  // Navigation & View state
  const [activeView, setActiveView] = useState('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelHubOpen, setIsModelHubOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isDeveloperOpen, setIsDeveloperOpen] = useState(false);
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  // Opened from the sidebar, or by asking for it. There was no terminal
  // before this; what looked like one on the extensions screen was a name
  // in an array with nothing behind it.
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeCollections, setActiveCollections] = useState([]);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('sm_selected_model') || 'auto',
  );
  const [turboMode, setTurboMode] = useState(false);
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

    const PINNED_MAX_WIDTH = 460;
    const apply = () => {
      document.documentElement.classList.toggle(
        'sm-pip', window.innerWidth <= PINNED_MAX_WIDTH,
      );
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  // Refine the local user from the backend when reachable, but never gate or
  // log the user out — a backend hiccup must never show a login/legal screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!cancelled && user && (user.id || user.email || user.username)) {
          setCurrentUser({ ...LOCAL_USER, ...user });
        }
      } catch (e) {
        /* stay on the local user */
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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateSession();
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowRightPanel(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Every control in the composer - the text box, Speak, RAG, Web, attach
  // and send - is disabled while activeSessionId is null. So if this function
  // ends without a session, the app opens looking perfectly normal and
  // accepts nothing at all. That was the "Start a new conversation" box that
  // would not take typing: an empty session list was handled, but a request
  // that simply failed was not, and that left the id null. On a phone talking
  // to a paired computer, a failed request is the common case.
  async function fetchSessions() {
    /* No backend: the conversation list lives on the device.
       Without this a fresh session id was invented on every launch, so the
       previous conversation was still on disk and nothing ever went looking
       for it - the app opened empty every time. */
    if (noBackendHere()) {
      const stored = localChat.loadSessions();
      if (stored.length) {
        setSessions(stored);
        if (!activeSessionId) setActiveSessionId(stored[0].id);
        return;
      }
      const first = {
        id: `local-${Date.now()}`,
        title: 'New Conversation',
        created_at: new Date().toISOString(),
      };
      localChat.saveSessions([first]);
      setSessions([first]);
      setActiveSessionId(first.id);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions`);
      if (res.ok) {
        const data = await res.json();
        const sessionList = Array.isArray(data) ? data : [];
        setSessions(sessionList);
        if (sessionList.length > 0) {
          if (!activeSessionId) {
            setActiveSessionId(sessionList[0].id);
          }
          return;
        }
      }
    } catch (err) {
      console.error(err);
    }
    // Reached when the server said no, or could not be reached at all.
    // handleCreateSession keeps a local fallback of its own, so this always
    // leaves the user something they can actually type into.
    if (!activeSessionId) {
      await handleCreateSession();
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
    fetchSessions();
  }, []);

  /* Counted once per start, and only from the packaged phone app - the
     desktop build has the backend's own reporter and would otherwise be
     counted twice. */
  useEffect(() => {
    if (!isNativeApp()) return;
    usage.reportStartup({ platform: 'android', appVersion: APP_VERSION });
  }, []);

  async function handleCreateSession() {
    if (noBackendHere()) {
      const created = {
        id: `local-${Date.now()}`,
        title: 'New Conversation',
        created_at: new Date().toISOString(),
      };
      const all = [created, ...localChat.loadSessions()].slice(0, 60);
      localChat.saveSessions(all);
      setSessions(all);
      setActiveSessionId(created.id);
      setActiveView('chat');
      return created;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) => [data, ...(Array.isArray(prev) ? prev : [])]);
        setActiveSessionId(data.id);
        setActiveView('chat');
        return data;
      }
    } catch (err) {
      console.error(err);
    }
    const localSession = {
      id: `local-${Date.now()}`,
      title: 'New Conversation',
      created_at: new Date().toISOString(),
    };
    setSessions((prev) => [localSession, ...(Array.isArray(prev) ? prev : [])]);
    setActiveSessionId(localSession.id);
    setActiveView('chat');
    return localSession;
  }

  const handleDeleteSession = async (id) => {
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
    }
  };

  const handleClearHistory = async () => {
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
      alert('Failed to clear history. Please try again.');
      return false;
    }
  };
  const handleRenameSession = async (id, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) => (Array.isArray(prev) ? prev : []).map((s) => s.id === id ? { ...s, title: data.title } : s));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Tracked live rather than read once, so rotating the phone or resizing a
  // window mounts and unmounts the desktop-only panels correctly.
  const [isWideScreen, setIsWideScreen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const update = (event) => setIsWideScreen(event.matches);
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
  useBackClose(isSettingsOpen, () => setIsSettingsOpen(false));
  useBackClose(isModelHubOpen, () => setIsModelHubOpen(false));
  useBackClose(isWorkspaceOpen, () => setIsWorkspaceOpen(false));
  useBackClose(isAnalyticsOpen, () => setIsAnalyticsOpen(false));
  useBackClose(isDeveloperOpen, () => setIsDeveloperOpen(false));
  useBackClose(isPairingOpen, () => setIsPairingOpen(false));
  useBackClose(isTerminalOpen, () => setIsTerminalOpen(false));
  useBackClose(isAuthOpen, () => setIsAuthOpen(false));
  // The full-screen sections are views rather than overlays, and on a phone
  // the sidebar that would take you back is behind the menu.
  useBackClose(activeView !== 'chat', () => setActiveView('chat'));

  const [settingsTab, setSettingsTab] = useState('general');

  // The views that actually have a branch in the render below. Kept next to
  // handleNavigate so the two cannot drift apart again.
  const RENDERABLE_VIEWS = new Set(['chat', 'collections', 'sites', 'plugins']);

  const handleNavigate = (view) => {
    if (view === 'settings') {
      setSettingsTab('general');
      setIsSettingsOpen(true);
    } else if (view === 'updates') {
      setSettingsTab('updates');
      setIsSettingsOpen(true);
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
    // Nothing behind the lock is rendered until the PIN is accepted, so the
    // workspace is never briefly visible on the way in.
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
    <div className="flex-1 min-h-0 w-full flex flex-col md:flex-row bg-[#ffffff] dark:bg-[#0c0c0e] text-[#1f1f1f] dark:text-[#e3e3e3] overflow-hidden font-sans relative transition-colors duration-300">
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
        setIsModelHubOpen={setIsModelHubOpen}
        onModelChange={setSelectedModel}
        position={sidebarPosition}
        onTogglePerformance={() => setShowRightPanel((v) => !v)}
        showPerformance={showRightPanel}
        onOpenAnalytics={() => setIsAnalyticsOpen(true)}
        onOpenDeveloper={() => setIsDeveloperOpen(true)}
        onOpenPairing={() => setIsPairingOpen(true)}
        onOpenAuth={() => setIsAuthOpen(true)}
        token={currentUser?.session_token}
        user={currentUser}
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
              {activeView === 'sites' ? 'Sites'
                : activeView === 'plugins' ? 'Plugins & Skills'
                : activeView === 'collections' ? 'Collections' : ''}
            </span>
          </div>
        )}

        {activeView === 'chat' && (
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
          />
        )}
        
        {activeView === 'collections' && (
          <CollectionManager />
        )}
        {activeView === 'sites' && <SitesHub />}
        {activeView === 'plugins' && <ExtensionsHub embedded />}
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
          initialTab={settingsTab}
          onModelChange={setSelectedModel}
          selectedModel={selectedModel}
          sidebarPosition={sidebarPosition}
          onSidebarPositionChange={setSidebarPosition}
          performancePosition={performancePosition}
          onPerformancePositionChange={(value) => { setPerformancePosition(value); if (value !== 'hidden') setShowRightPanel(true); }}
          onOpenConnections={() => { setIsSettingsOpen(false); setIsPairingOpen(true); }}
          onOpenAccount={() => { setIsSettingsOpen(false); setIsAuthOpen(true); }}
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

      {/* Sign in or create an account, including the Google route. */}
      <ErrorBoundary>
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
        />
      </ErrorBoundary>

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
      {/* The pet used to be wrapped in "hidden md:contents", which hid it on
          every phone. It was showing on mobile before that and sitting on top
          of the input bar; hiding it answered the nuisance by removing the
          feature. It is back, and now positions itself above the composer
          rather than over it. */}
      <DesktopPet />

      <TerminalPanel isOpen={isTerminalOpen} onClose={() => setIsTerminalOpen(false)} />
    </div>
    </div>
    </PinLock>
  );
};

export default App;
