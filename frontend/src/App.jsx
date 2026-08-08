import React, { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import CollectionManager from './components/CollectionManager';
import AdminDashboard from './components/AdminDashboard';
import SettingsModal from './components/SettingsModal';
import RightPanel from './components/RightPanel';
import { Bot, User, Lock, ArrowRight, ShieldCheck, KeyRound, Orbit } from 'lucide-react';
import { API_BASE } from './context/AuthContext';
import { parseJsonResponse } from './utils/api';


const App = () => {
  const { user, token, loading, error, login, register, logout, networkError } = useAuth();

  if (networkError) {
    throw new Error('Network connection error: Server is unreachable.');
  }
  
  // Navigation & View state
  const [activeView, setActiveView] = useState('chat'); // 'chat', 'collections', 'admin'
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeCollections, setActiveCollections] = useState([]);
  // Auto is the default; the backend chooses an installed model per request.
  const [selectedModel, setSelectedModel] = useState('auto');
  const [turboMode, setTurboMode] = useState(false);
  // Sidebar expand state — used to shift main content area
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(() => {
    const saved = localStorage.getItem('showRightPanel');
    return saved !== 'false'; // defaults to true if not set
  });

  useEffect(() => {
    localStorage.setItem('showRightPanel', showRightPanel);
  }, [showRightPanel]);

  // Keyboard Shortcuts (Mousetrap-style pure JS offline implementation)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Alt+N: Create new chat session
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateSession();
      }
      // Ctrl+Alt+A: Toggle Admin Dashboard (if admin)
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') {
        if (user && user.role === 'admin') {
          e.preventDefault();
          setActiveView(prev => (prev === 'admin' ? 'chat' : 'admin'));
        }
      }
      // Ctrl+Alt+S: Toggle Settings Modal
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
      }
      // Ctrl+Alt+P: Toggle Right Telemetry Panel
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowRightPanel(prev => !prev);
      }
      // Ctrl+Alt+L: Safe Logout
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        logout();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [user, activeView, logout, showRightPanel]);

  // Login form state
  const [isRegistering, setIsRegistering] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authMessage, setAuthMessage] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetUsername, setResetUsername] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetStatus, setResetStatus] = useState({ loading: false, message: null, error: null });
  const [masterRecoveryMode, setMasterRecoveryMode] = useState(false);
  const [masterKeyInput, setMasterKeyInput] = useState('');
  const [discoveredAccounts, setDiscoveredAccounts] = useState([]);

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetUsername.trim() || !resetNewPassword) return;
    setResetStatus({ loading: true, message: null, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: resetUsername.trim(), new_password: resetNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Password reset failed');
      setResetStatus({ loading: false, message: data.message, error: null });
      setUsernameInput(resetUsername.trim());
      setPasswordInput(resetNewPassword);
      setTimeout(() => {
        setForgotOpen(false);
        setResetStatus({ loading: false, message: null, error: null });
      }, 1800);
    } catch (err) {
      setResetStatus({ loading: false, message: null, error: err.message });
    }
  };

  const handleMasterRecovery = async (e) => {
    e.preventDefault();
    if (!masterKeyInput.trim()) return;
    setResetStatus({ loading: true, message: null, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/auth/master-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_key: masterKeyInput.trim(),
          target_username: resetUsername.trim() || undefined,
          new_password: resetNewPassword || undefined
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Master Recovery failed');
      setDiscoveredAccounts(data.accounts || []);
      setResetStatus({ loading: false, message: data.message, error: null });
      if (resetUsername.trim() && resetNewPassword) {
        setUsernameInput(resetUsername.trim());
        setPasswordInput(resetNewPassword);
        setTimeout(() => {
          setForgotOpen(false);
          setResetStatus({ loading: false, message: null, error: null });
        }, 2200);
      }
    } catch (err) {
      setResetStatus({ loading: false, message: null, error: err.message });
    }
  };

  // Fetch user chat sessions
  async function fetchSessions() {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
        if (data.length > 0) {
          if (!activeSessionId) {
            setActiveSessionId(data[0].id);
          }
        } else {
          // Auto-create a session if none exist yet, so the input is active immediately
          await handleCreateSession();
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    if (token) {
      fetchSessions();
    }
  }, [token]);

  async function handleCreateSession() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) => [data, ...prev]);
        setActiveSessionId(data.id);
        setActiveView('chat');
      }
    } catch (err) {
      console.error(err);
    }
  }

  const handleDeleteSession = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          const remaining = sessions.filter((s) => s.id !== id);
          setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };
  const handleRenameSession = async (id, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: data.title } : s));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthMessage(null);
    if (!usernameInput.trim() || !passwordInput) return;

    setAuthLoading(true);
    try {
      if (isRegistering) {
        await register(usernameInput, passwordInput);
        setAuthMessage('Account registered successfully! Auto-signing you in...');
        await login(usernameInput, passwordInput);
      } else {
        await login(usernameInput, passwordInput);
      }
    } catch (err) {
      setAuthError(err.message || 'Authorization failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleNavigate = (view) => {
    if (view === 'settings') {
      setIsSettingsOpen(true);
    } else {
      setActiveView(view);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-600 dark:border-t-purple-500 rounded-full animate-spin" />
          <Bot className="w-6 h-6 text-indigo-605 dark:text-indigo-400 absolute animate-pulse" />
        </div>
        <p className="text-sm font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent mt-6 animate-pulse-subtle">
          Connecting to SMARAN Local Nodes...
        </p>
      </div>
    );
  }

  // Not Logged In - Authentication Gate (With Glowing Mesh Orbs)
  if (!token || !user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 font-sans relative overflow-hidden transition-colors duration-300">
        {/* Glowing Background Mesh Orbs */}
        <div className="absolute w-[450px] h-[450px] bg-indigo-600/5 dark:bg-indigo-600/15 rounded-full filter blur-[100px] -top-12 -left-12 animate-drift-1 pointer-events-none" />
        <div className="absolute w-[450px] h-[450px] bg-purple-600/5 dark:bg-purple-600/15 rounded-full filter blur-[100px] -bottom-12 -right-12 animate-drift-2 pointer-events-none" />
        
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808005_1px,transparent_1px),linear-gradient(to_bottom,#80808005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#80808007_1px,transparent_1px),linear-gradient(to_bottom,#80808007_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        <div className="w-full max-w-md glass-panel border border-zinc-200 dark:border-zinc-800/80 rounded-3xl shadow-2xl p-8 relative z-10 transition-all duration-300">
          {/* Logo Brand with Orbit effect */}
          <div className="flex flex-col items-center text-center mb-8 select-none">
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 dark:border-indigo-500/25 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-lg hover:scale-105 transition-transform duration-300">
              <Bot className="w-9 h-9" />
              <Orbit className="w-14 h-14 text-purple-600/20 dark:text-purple-500/30 absolute animate-spin" style={{ animationDuration: '8s' }} />
            </div>
            <h1 className="text-2xl font-black tracking-wider uppercase leading-none mt-2 select-none flex items-center justify-center">
              <span className="text-[#ea580c] dark:text-[#f97316]">SMARAN</span>
              <span className="text-zinc-950 dark:text-white ml-1.5">AI</span>
            </h1>
          </div>

          {/* Alert messages */}
          {authError && (
            <div className="mb-4 p-4 text-xs font-semibold bg-rose-500/10 border border-rose-500/20 dark:border-rose-500/25 text-rose-600 dark:text-rose-455 rounded-2xl text-left animate-in fade-in duration-200">
              {authError}
            </div>
          )}
          {authMessage && (
            <div className="mb-4 p-4 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-500/25 text-emerald-600 dark:text-emerald-400 rounded-2xl text-left animate-in fade-in duration-200">
              {authMessage}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider pl-1">
                Username
              </label>
              <div className="relative">
                <User className="w-4.5 h-4.5 text-zinc-400 dark:text-zinc-600 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="Enter corporate username"
                  required
                  disabled={authLoading}
                  autoComplete="username"
                  className="w-full glass-input rounded-2xl pl-10 pr-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 outline-hidden transition-all text-zinc-950 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5 text-left">
              <div className="flex justify-between items-center pr-1 select-none">
                <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider pl-1">
                  Password
                </label>
                {!isRegistering && (
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-[10px] text-zinc-550 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold hover:underline transition-colors cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4.5 h-4.5 text-zinc-400 dark:text-zinc-600 absolute left-3.5 top-3.5" />
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={authLoading}
                  autoComplete="current-password"
                  className="w-full glass-input rounded-2xl pl-10 pr-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 outline-hidden transition-all text-zinc-950 dark:text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:via-violet-700 hover:to-purple-700 dark:from-indigo-500 dark:via-violet-500 dark:to-purple-500 dark:hover:from-indigo-600 dark:hover:via-violet-600 dark:hover:to-purple-600 text-white font-black text-sm rounded-2xl py-3.75 shadow-[0_12px_35px_-12px_rgba(79,70,229,0.7)] border border-white/20 hover:shadow-[0_16px_40px_-12px_rgba(79,70,229,0.85)] active:scale-[0.99] hover:scale-[1.01] transition-all cursor-pointer mt-2 tracking-wide"
            >
              {authLoading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isRegistering ? (
                <>
                  <KeyRound className="w-4.5 h-4.5" />
                  <span>Request Account Verification</span>
                </>
              ) : (
                <>
                  <span>Sign In to Console</span>
                  <ArrowRight className="w-4.5 h-4.5" />
                </>
              )}
            </button>
          </form>

          {/* Form switcher link */}
          <div className="mt-6 text-center text-xs">
            <button
              onClick={() => {
                setIsRegistering(!isRegistering);
                setAuthError(null);
                setAuthMessage(null);
              }}
              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold hover:underline transition-colors cursor-pointer"
            >
              {isRegistering
                ? 'Already have an account? Log In'
                : 'Request access: Register a Corporate Account'}
            </button>
          </div>

          {/* Footer Offline Notice */}
          <div className="mt-8 pt-4 border-t border-zinc-200 dark:border-zinc-800/80 text-[10px] text-zinc-550 flex items-center justify-center gap-1.5 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>100% Offline Secured Local Area Network</span>
          </div>

          {/* Forgot Password Overlay Modal — Manual & Master Developer Reset */}
          {forgotOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
              <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 text-left relative animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-black text-zinc-950 dark:text-white flex items-center gap-2">
                    <KeyRound className="w-4.5 h-4.5 text-indigo-500" />
                    {masterRecoveryMode ? 'Master Developer Account Recovery' : 'Reset Account Password'}
                  </h3>
                  <button
                    onClick={() => {
                      setForgotOpen(false);
                      setMasterRecoveryMode(false);
                      setDiscoveredAccounts([]);
                    }}
                    className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* Mode Switcher */}
                <div className="flex bg-zinc-100 dark:bg-zinc-800/60 p-1 rounded-xl mb-4">
                  <button
                    type="button"
                    onClick={() => setMasterRecoveryMode(false)}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      !masterRecoveryMode ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    Know Username
                  </button>
                  <button
                    type="button"
                    onClick={() => setMasterRecoveryMode(true)}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      masterRecoveryMode ? 'bg-indigo-600 text-white shadow-xs' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    ⚡ Forgot Both (Master Key)
                  </button>
                </div>

                {resetStatus.error && (
                  <div className="mb-3 p-3 text-xs font-semibold bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl">
                    {resetStatus.error}
                  </div>
                )}
                {resetStatus.message && (
                  <div className="mb-3 p-3 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    {resetStatus.message}
                  </div>
                )}

                {!masterRecoveryMode ? (
                  <form onSubmit={handleResetPassword} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        Target Username
                      </label>
                      <input
                        type="text"
                        value={resetUsername}
                        onChange={(e) => setResetUsername(e.target.value)}
                        placeholder="Enter registered username"
                        required
                        className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-950 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        placeholder="Minimum 6 characters"
                        required
                        minLength={6}
                        className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-950 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setForgotOpen(false)}
                        className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={resetStatus.loading}
                        className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl cursor-pointer shadow-md transition-all flex items-center justify-center gap-1.5"
                      >
                        {resetStatus.loading ? (
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <span>Set New Password</span>
                        )}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleMasterRecovery} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        Master Security Key
                      </label>
                      <input
                        type="password"
                        value={masterKeyInput}
                        onChange={(e) => setMasterKeyInput(e.target.value)}
                        placeholder="Enter Developer Master Key (e.g. SMARAN-DEV-RECOVERY)"
                        required
                        className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-950 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>

                    {discoveredAccounts.length > 0 && (
                      <div className="space-y-1 bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl">
                        <label className="block text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">
                          Discovered Registered Accounts:
                        </label>
                        <div className="flex flex-wrap gap-1.5 max-h-[90px] overflow-y-auto">
                          {discoveredAccounts.map((acc) => (
                            <button
                              type="button"
                              key={acc.username}
                              onClick={() => setResetUsername(acc.username)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                                resetUsername === acc.username ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700'
                              }`}
                            >
                              👤 {acc.username} ({acc.role})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        Select / Target Username
                      </label>
                      <input
                        type="text"
                        value={resetUsername}
                        onChange={(e) => setResetUsername(e.target.value)}
                        placeholder="Select from above or type 'admin'"
                        className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-950 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        Set New Password
                      </label>
                      <input
                        type="password"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        placeholder="Enter new password to assign"
                        className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-950 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-hidden"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotOpen(false);
                          setMasterRecoveryMode(false);
                        }}
                        className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={resetStatus.loading}
                        className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl cursor-pointer shadow-md transition-all flex items-center justify-center gap-1.5"
                      >
                        {resetStatus.loading ? (
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <span>Restore Access</span>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Logged In Application Screen (Fully Adaptive background)
  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-[#ffffff] dark:bg-[#131314] text-[#1f1f1f] dark:text-[#e3e3e3] overflow-hidden font-sans relative transition-colors duration-300">

      {/* Sidebar Panel */}
      <Sidebar
        token={token}
        user={user}
        sessions={sessions}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        activeCollections={activeCollections}
        setActiveCollections={setActiveCollections}
        onNavigate={handleNavigate}
        activeView={activeView}
        logout={logout}
        onExpandChange={setSidebarExpanded}
      />

      {/* Main Workspace Frame */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10 glass-panel border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-850/50">
        {activeView === 'chat' && (
          <ChatArea
            token={token}
            activeSessionId={activeSessionId}
            activeCollections={activeCollections}
            setActiveCollections={setActiveCollections}
            selectedModel={selectedModel}
            turboMode={turboMode}
            onTogglePanel={() => setShowRightPanel((v) => !v)}
          />
        )}
        
        {/* Collections manager — accessible but not linked in sidebar for employees */}
        {activeView === 'collections' && (
          <CollectionManager token={token} />
        )}
        
        {/* Administrators may manage users from any trusted LAN device. */}
        {activeView === 'admin' && user?.role === 'admin' && (
          <AdminDashboard token={token} currentUserId={user.id} />
        )}
      </main>

      {/* Right side Task Manager / Brand panel — desktop only */}
      {token && <RightPanel token={token} showPanel={showRightPanel} onClose={() => setShowRightPanel(false)} />}

      {/* Settings Dialog Overlay */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        onModelChange={setSelectedModel}
        selectedModel={selectedModel}
        turboMode={turboMode}
        onTurboModeChange={setTurboMode}
      />
    </div>
  );
};

export default App;
