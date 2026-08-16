import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import CollectionManager from './components/CollectionManager';
import SettingsModal from './components/SettingsModal';
import RightPanel from './components/RightPanel';
import StarfieldCanvas from './components/StarfieldCanvas';
import ErrorBoundary from './components/ErrorBoundary';
import LoginModal from './components/LoginModal';
import AuthLandingPage from './components/AuthLandingPage';
import { API_BASE, fetchWithAuth, getCurrentUser, logoutUser } from './context/AuthContext';
import { Brain, RefreshCw } from 'lucide-react';


const App = () => {
  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Navigation & View state
  const [activeView, setActiveView] = useState('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModelHubOpen, setIsModelHubOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
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

  // Verify authentication on mount
  useEffect(() => {
    async function checkAuth() {
      const isLoggedOut = localStorage.getItem('sm_auth_logged_out') === 'true';
      if (isLoggedOut) {
        setCurrentUser(null);
        setIsAuthChecking(false);
        return;
      }
      try {
        const user = await getCurrentUser();
        if (user && (user.id || user.email || user.username)) {
          setCurrentUser(user);
        } else {
          setCurrentUser(null);
        }
      } catch (e) {
        setCurrentUser(null);
      } finally {
        setIsAuthChecking(false);
      }
    }
    checkAuth();
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
    const confirmed = window.confirm('Are you sure you want to delete ALL chat history? This action cannot be undone.');
    if (!confirmed) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/privacy/clear-all`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSessions([]);
        setActiveSessionId(null);
        await handleCreateSession();
      } else {
        alert('Failed to clear history. Please try again.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to clear history. Please try again.');
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

  const handleNavigate = (view) => {
    if (view === 'settings') {
      setIsSettingsOpen(true);
    } else if (view === 'login') {
      setIsLoginOpen(true);
    } else {
      setActiveView(view);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.warn('Logout error:', e);
    }
    setCurrentUser(null);
    setSessions([]);
    setActiveSessionId(null);
    setActiveView('chat');
  };

  // Loading splash screen while verifying device session
  if (isAuthChecking) {
    return (
      <div className="h-screen w-full bg-[#090a0f] flex flex-col items-center justify-center text-zinc-100 font-sans select-none">
        <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-indigo-600 p-0.5 shadow-[0_0_30px_rgba(249,115,22,0.5)] mb-4 animate-pulse">
          <div className="w-full h-full rounded-[14px] bg-[#0d0e14] flex items-center justify-center">
            <Brain className="w-8 h-8 text-amber-400 animate-pulse" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
          <span>Synchronizing SMARAN.AI local workspace...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated: render full-screen AuthLandingPage (no dashboard underneath)
  if (!currentUser) {
    return (
      <AuthLandingPage
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          localStorage.removeItem('sm_auth_logged_out');
          fetchSessions();
        }}
      />
    );
  }

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-[#ffffff] dark:bg-[#0c0c0e] text-[#1f1f1f] dark:text-[#e3e3e3] overflow-hidden font-sans relative transition-colors duration-300">
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
        setIsModelHubOpen={setIsModelHubOpen}
        onModelChange={setSelectedModel}
        position={sidebarPosition}
        onLogout={handleLogout}
        onTogglePerformance={() => setShowRightPanel((v) => !v)}
        showPerformance={showRightPanel}
      />

      {/* Main Workspace Frame */}
      <main className="order-2 flex-1 flex flex-col overflow-hidden relative z-10 glass-panel border-t md:border-t-0 border-zinc-200 dark:border-zinc-850/50">
        {activeView === 'chat' && (
          <ChatArea
            activeSessionId={activeSessionId}
            activeCollections={activeCollections}
            setActiveCollections={setActiveCollections}
            selectedModel={selectedModel}
            turboMode={turboMode}
            onTogglePanel={() => setShowRightPanel((v) => !v)}
            onOpenModelHub={() => setIsModelHubOpen(true)}
          />
        )}
        
        {activeView === 'collections' && (
          <CollectionManager />
        )}
      </main>

      {/* Right side Task Manager / Brand panel — desktop only */}
      {showRightPanel && <RightPanel selectedModel={selectedModel} showPanel={showRightPanel && performancePosition !== 'hidden'} position={performancePosition} onClose={() => setShowRightPanel(false)} />}

      {/* Settings Dialog Overlay */}
      <ErrorBoundary>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onModelChange={setSelectedModel}
          selectedModel={selectedModel}
          sidebarPosition={sidebarPosition}
          onSidebarPositionChange={setSidebarPosition}
          performancePosition={performancePosition}
          onPerformancePositionChange={(value) => { setPerformancePosition(value); if (value !== 'hidden') setShowRightPanel(true); }}
        />
      </ErrorBoundary>

      {/* Login Modal Overlay */}
      <ErrorBoundary>
        <LoginModal
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
        />
      </ErrorBoundary>
    </div>
  );
};

export default App;