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
import { API_BASE, fetchWithAuth, getCurrentUser } from './context/AuthContext';


// SMARAN.AI runs as a free, offline, single-user desktop app. There is no
// login, sign-up, Google auth, or legal gate — the local device is the user.
const LOCAL_USER = { id: 'local', username: 'You', email: 'local@smaran.ai', role: 'user' };

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

  // Fetch user chat sessions
  async function fetchSessions() {
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
        } else {
          await handleCreateSession();
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    fetchSessions();
  }, []);

  async function handleCreateSession() {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/chat/sessions`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) => [data, ...(Array.isArray(prev) ? prev : [])]);
        setActiveSessionId(data.id);
        setActiveView('chat');
      }
    } catch (err) {
      console.error(err);
    }
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

  const [settingsTab, setSettingsTab] = useState('general');

  const handleNavigate = (view) => {
    if (view === 'settings') {
      setSettingsTab('general');
      setIsSettingsOpen(true);
    } else if (view === 'updates') {
      setSettingsTab('updates');
      setIsSettingsOpen(true);
    } else if (view !== 'login') {
      // 'login' is intentionally inert: this build has no accounts.
      setActiveView(view);
    }
  };

  return (
    // Nothing behind the lock is rendered until the PIN is accepted, so the
    // workspace is never briefly visible on the way in.
    <PinLock>
    <div className="h-[100dvh] min-h-0 w-full flex flex-col md:flex-row bg-[#ffffff] dark:bg-[#0c0c0e] text-[#1f1f1f] dark:text-[#e3e3e3] overflow-hidden font-sans relative transition-colors duration-300">
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
          />
        )}
        
        {activeView === 'collections' && (
          <CollectionManager />
        )}
        {activeView === 'sites' && <SitesHub />}
        {activeView === 'plugins' && <ExtensionsHub embedded />}
      </main>

      {/* Right side Task Manager / Brand panel — desktop only */}
      {activeView === 'chat' && showRightPanel && <div className="hidden md:contents"><RightPanel selectedModel={selectedModel} showPanel={showRightPanel && performancePosition !== 'hidden'} position={performancePosition} onClose={() => setShowRightPanel(false)} /></div>}

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
      <div className="hidden md:contents"><DesktopPet /></div>
    </div>
    </PinLock>
  );
};

export default App;
