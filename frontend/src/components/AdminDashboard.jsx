import React, { useEffect, useState } from 'react';
import { Shield, Users, Activity, Eye, Search, Check, Ban, Trash2, Cpu, HardDrive, Clock, UsersRound, X, KeyRound, Network } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

const AdminDashboard = ({ token, currentUserId }) => {
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeTab, setActiveTab] = useState('users'); // 'users', 'telemetry', 'audit', 'sessions', 'reports', 'analytics'
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showClearLogsConfirm, setShowClearLogsConfirm] = useState(false);
  const [resetModal, setResetModal] = useState(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');

  // Admin reports & intervention states
  const [reports, setReports] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [injectInput, setInjectInput] = useState('');
  const [showInjectModal, setShowInjectModal] = useState(false);
  const [injectSuccess, setInjectSuccess] = useState(null);
  const [developerAnalytics, setDeveloperAnalytics] = useState(null);

  useEffect(() => {
    fetchUsers();
    fetchStats();
    fetchAuditLogs(appliedSearch);
    fetchReports();
    fetchSessions();
    fetchAnalytics();
    
    const interval = setInterval(() => {
      fetchUsers();
      fetchStats();
      fetchAuditLogs(appliedSearch);
      fetchReports();
      fetchSessions();
      fetchAnalytics();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [appliedSearch]);

  const fetchAnalytics = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/visitor-analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDeveloperAnalytics(data);
      }
    } catch (err) {
      console.error(err);
    }
  };



  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/system-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchReports = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/reports/activity`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReports(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAdminInject = async (e) => {
    e.preventDefault();
    if (!injectInput.trim() || !selectedSessionId) return;
    try {
      const formData = new FormData();
      formData.append('session_id', selectedSessionId);
      formData.append('prompt', injectInput);
      
      const res = await fetch(`${API_BASE}/api/admin/chat/inject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        setInjectSuccess('Successfully injected intervention message into session!');
        setInjectInput('');
        setTimeout(() => {
          setShowInjectModal(false);
          setInjectSuccess(null);
        }, 1500);
      } else {
        const errData = await res.json();
        setInjectSuccess(`Error: ${errData.detail || 'Injection failed'}`);
      }
    } catch (err) {
      console.error(err);
      setInjectSuccess(`Error: ${err.message}`);
    }
  };

  const fetchAuditLogs = async (keyword = '') => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/audit-logs?search=${encodeURIComponent(keyword)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuditSearchSubmit = (e) => {
    e.preventDefault();
    setAppliedSearch(auditSearch);
  };

  const handleClearAllAuditLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/audit-logs`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setAuditSearch('');
        setAppliedSearch('');
        setShowClearLogsConfirm(false);
        fetchAuditLogs('');
        fetchStats();
      } else {
        const data = await res.json();
        setShowClearLogsConfirm(false);
        // silently log — inline UI will just close
        console.error(data.detail || 'Failed to clear audit logs');
      }
    } catch (err) {
      console.error(err);
      setShowClearLogsConfirm(false);
    }
  };

  const handleUserStatusUpdate = async (userId, newStatus) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newStatus),
      });
      if (res.ok) {
        fetchUsers();
        fetchStats();
      } else {
        const data = await res.json();
        alert(data.detail || 'Failed to update user status');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setConfirmDeleteId(null);
        fetchUsers();
      } else {
        setConfirmDeleteId(null);
        console.error('Failed to delete user');
      }
    } catch (err) {
      setConfirmDeleteId(null);
      console.error(err);
    }
  };

  const handleResetPassword = async () => {
    if (!resetModal) return;
    const { userId } = resetModal;
    if (!resetPasswordInput || resetPasswordInput.length < 6) {
      setResetPasswordError('Password must be at least 6 characters.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: resetPasswordInput }),
      });
      if (res.ok) {
        setResetModal(null);
        setResetPasswordInput('');
        setResetPasswordError('');
      } else {
        const data = await res.json();
        setResetPasswordError(data.detail || 'Failed to reset password');
      }
    } catch (err) {
      console.error(err);
      setResetPasswordError('Error updating password');
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-950/20 p-6 md:p-8 overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-300 transition-colors duration-300">
      {/* Title */}
      <div className="flex items-center gap-2.5 mb-8 select-none">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shadow-md">
          <Shield className="w-5.5 h-5.5" />
        </div>
        <div className="text-left">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-wide">Admin Control Panel</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-550 font-medium -mt-0.5">Approve user credentials, monitor device hardware, and audit AI traces</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-900 mb-8 select-none transition-colors duration-300">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeTab === 'users'
              ? 'border-indigo-650 text-indigo-650 dark:border-indigo-500 dark:text-indigo-400 font-black'
              : 'border-transparent text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
          }`}
        >
          <Users className="w-4 h-4" />
          Approval Queue
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeTab === 'telemetry'
              ? 'border-indigo-650 text-indigo-650 dark:border-indigo-500 dark:text-indigo-400 font-black'
              : 'border-transparent text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
          }`}
        >
          <Activity className="w-4 h-4" />
          System Diagnostics
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeTab === 'audit'
              ? 'border-indigo-650 text-indigo-650 dark:border-indigo-500 dark:text-indigo-400 font-black'
              : 'border-transparent text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
          }`}
        >
          <Search className="w-4 h-4" />
          Audit Logs
        </button>
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeTab === 'sessions'
              ? 'border-indigo-650 text-indigo-650 dark:border-indigo-500 dark:text-indigo-400 font-black'
              : 'border-transparent text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
          }`}
        >
          <Clock className="w-4 h-4" />
          Active Chats
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeTab === 'reports'
              ? 'border-indigo-650 text-indigo-650 dark:border-indigo-500 dark:text-indigo-400 font-black'
              : 'border-transparent text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
          }`}
        >
          <UsersRound className="w-4 h-4" />
          Usage Reports
        </button>
        <button
          onClick={() => { setActiveTab('analytics'); fetchDeveloperAnalytics(); }}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
            activeTab === 'analytics'
              ? 'border-indigo-650 text-indigo-650 dark:border-indigo-500 dark:text-indigo-400 font-black'
              : 'border-transparent text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
          }`}
        >
          <UsersRound className="w-4 h-4 text-emerald-500" />
          Developer Analytics
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1">
        {/* Tab 1: Users Approval Queue */}
        {activeTab === 'users' && (
          <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl overflow-hidden shadow-lg animate-in fade-in duration-200 transition-colors duration-300">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/20 text-left select-none">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-white">Account Approvals & RBAC Management</h3>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-550 font-medium mt-0.5">New registrations must be approved by an Admin before they can log in.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 text-[10px] font-black border-b border-zinc-200 dark:border-zinc-900 uppercase tracking-widest">
                    <th className="px-6 py-4">Username</th>
                    <th className="px-6 py-4">Role</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Joined Date</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900 bg-zinc-50/10 dark:bg-zinc-950/10">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-zinc-100/30 dark:hover:bg-zinc-900/20 transition-colors">
                      <td className="px-6 py-4 font-bold text-sm text-zinc-850 dark:text-zinc-200">{u.username}</td>
                      <td className="px-6 py-4">
                        <select
                          value={u.role}
                          onChange={(e) => handleUserStatusUpdate(u.id, { role: e.target.value })}
                          disabled={u.id === currentUserId || u.username === 'admin'}
                          className="bg-white dark:bg-zinc-950 text-xs font-bold text-zinc-700 dark:text-zinc-350 border border-zinc-200 dark:border-zinc-850 rounded-xl px-3 py-1.5 focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 outline-hidden cursor-pointer"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          u.is_approved
                            ? 'bg-emerald-500/10 text-emerald-650 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-650 dark:text-amber-400 border border-amber-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.is_approved ? 'bg-emerald-500 dark:bg-emerald-450 animate-pulse' : 'bg-amber-550 dark:bg-amber-450'}`} />
                          {u.is_approved ? 'Approved' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-zinc-500 dark:text-zinc-500 font-medium">
                        {new Date(u.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {u.username !== 'admin' && u.id !== currentUserId && (
                          <div className="flex items-center justify-end gap-2">
                            {/* Reset Password */}
                            <button
                              onClick={() => { setResetModal({ userId: u.id, username: u.username }); setResetPasswordInput(''); setResetPasswordError(''); }}
                              className="p-2 border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 text-zinc-655 dark:text-zinc-350 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-xl transition-all cursor-pointer"
                              title="Reset User Password"
                            >
                              <KeyRound className="w-4 h-4 text-amber-500" />
                            </button>

                            {/* Approve / Suspend */}
                            <button
                              onClick={() => handleUserStatusUpdate(u.id, { is_approved: !u.is_approved })}
                              className={`p-2 rounded-xl border transition-all cursor-pointer ${
                                u.is_approved
                                  ? 'border-amber-200 hover:bg-amber-50 dark:border-amber-900/30 dark:hover:bg-amber-500/10 text-amber-600 dark:text-amber-450 hover:border-amber-300 dark:hover:border-amber-550'
                                  : 'border-emerald-250 hover:bg-emerald-50 dark:border-emerald-900/30 dark:hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-405 hover:border-emerald-350 dark:hover:border-emerald-555'
                              }`}
                              title={u.is_approved ? 'Suspend User' : 'Approve User'}
                            >
                              {u.is_approved ? <Ban className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                            </button>

                            {/* Delete — inline double-confirm, no window.confirm() */}
                            {confirmDeleteId === u.id ? (
                              <span className="flex items-center gap-1.5 animate-in fade-in duration-150">
                                <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider">Delete?</span>
                                <button
                                  onClick={() => handleDeleteUser(u.id)}
                                  className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] uppercase rounded-xl transition-colors cursor-pointer"
                                >Yes</button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2.5 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-black text-[10px] uppercase rounded-xl transition-colors cursor-pointer"
                                >No</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(u.id)}
                                className="p-2 border border-rose-200 hover:bg-rose-50 dark:border-rose-900/30 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-455 hover:border-rose-300 dark:hover:border-rose-550 rounded-xl transition-all cursor-pointer"
                                title="Delete Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: System Telemetry */}
        {activeTab === 'telemetry' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Real-time stats card grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 select-none">
              <div className="p-5 border border-zinc-200 dark:border-zinc-900 rounded-3xl bg-white dark:bg-zinc-900/30 backdrop-blur-md shadow-lg flex items-center justify-between hover:scale-[1.01] transition-transform duration-300 text-left">
                <div>
                  <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">Active LAN Sessions</span>
                  <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">
                    {stats ? stats.active_sessions : '0'}
                  </div>
                  <span className="text-[9px] text-zinc-500 font-medium block mt-1">Simultaneous users (15m)</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400">
                  <UsersRound className="w-5.5 h-5.5" />
                </div>
              </div>
              
              <div className="p-5 border border-zinc-200 dark:border-zinc-900 rounded-3xl bg-white dark:bg-zinc-900/30 backdrop-blur-md shadow-lg flex items-center justify-between hover:scale-[1.01] transition-transform duration-300 text-left">
                <div>
                  <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">DB Storage Footprint</span>
                  <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">
                    {stats ? `${stats.database_size_mb.toFixed(2)} MB` : '0.00 MB'}
                  </div>
                  <span className="text-[9px] text-zinc-500 font-medium block mt-1">Total local SQLite & Chroma DB size</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400">
                  <HardDrive className="w-5.5 h-5.5" />
                </div>
              </div>
              
              <div className="p-5 border border-zinc-200 dark:border-zinc-900 rounded-3xl bg-white dark:bg-zinc-900/30 backdrop-blur-md shadow-lg flex items-center justify-between hover:scale-[1.01] transition-transform duration-300 text-left">
                <div>
                  <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">Generation Latency</span>
                  <div className="text-2xl font-black text-zinc-900 dark:text-white mt-1">
                    {stats ? `${stats.average_latency_ms.toFixed(0)} ms` : '0 ms'}
                  </div>
                  <span className="text-[9px] text-zinc-500 font-medium block mt-1">Inference execution average</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400">
                  <Clock className="w-5.5 h-5.5" />
                </div>
              </div>

              <div className="p-5 border border-zinc-200 dark:border-zinc-900 rounded-3xl bg-white dark:bg-zinc-900/30 backdrop-blur-md shadow-lg flex items-center justify-between hover:scale-[1.01] transition-transform duration-300 text-left">
                <div className="flex-1 min-w-0 pr-2">
                  <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-widest block">Hardware Accelerator</span>
                  <div className="text-xs font-black text-zinc-800 dark:text-zinc-200 mt-2 break-words" title={stats?.gpu_name}>
                    {stats ? stats.gpu_name : 'CPU Only'}
                  </div>
                  <span className="text-[9px] text-zinc-500 font-medium block mt-1">Active processor source</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shrink-0">
                  <Cpu className="w-5.5 h-5.5 animate-pulse-subtle" />
                </div>
              </div>
            </div>

            {/* Performance Usage charts */}
            <div className="border border-zinc-200 dark:border-zinc-900 rounded-3xl p-6 bg-white dark:bg-zinc-900/30 backdrop-blur-md shadow-lg text-left transition-colors duration-300">
              <h3 className="font-bold text-sm text-zinc-900 dark:text-white mb-6 select-none uppercase tracking-wider">Host Server Node Diagnostics</h3>
              <div className="space-y-6">
                {/* CPU bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-semibold text-zinc-550 dark:text-zinc-400">CPU Usage</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{stats ? stats.cpu_usage.toFixed(1) : 0}%</span>
                  </div>
                  <div className="w-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-purple-650 h-full rounded-full transition-all duration-500"
                      style={{ width: `${stats ? stats.cpu_usage : 0}%` }}
                    />
                  </div>
                </div>

                {/* RAM bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-semibold text-zinc-550 dark:text-zinc-400">RAM Capacity</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{stats ? stats.memory_usage.toFixed(1) : 0}%</span>
                  </div>
                  <div className="w-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-purple-650 h-full rounded-full transition-all duration-500"
                      style={{ width: `${stats ? stats.memory_usage : 0}%` }}
                    />
                  </div>
                </div>

                {/* GPU utilization bar */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-semibold text-zinc-550 dark:text-zinc-400">GPU Acceleration (NVIDIA CUDA)</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{stats ? stats.gpu_usage.toFixed(1) : 0}%</span>
                  </div>
                  <div className="w-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-purple-650 h-full rounded-full transition-all duration-500"
                      style={{ width: `${stats ? stats.gpu_usage : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Audit Log */}
        {activeTab === 'audit' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Search Bar */}
            <form onSubmit={handleAuditSearchSubmit} className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[280px]">
                <Search className="w-4.5 h-4.5 text-zinc-400 dark:text-zinc-500 absolute left-4 top-3.5" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAuditSearch(val);
                    if (val === '') {
                      setAppliedSearch('');
                    }
                  }}
                  placeholder="Filter audit logs by prompt keywords, generated responses, or client username..."
                  className="w-full glass-input rounded-2xl pl-11 pr-4 py-3 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 text-zinc-900 dark:text-white shadow-xs"
                />
              </div>
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl transition-colors cursor-pointer shadow-md shadow-indigo-500/10"
              >
                Filter
              </button>
              {appliedSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setAuditSearch('');
                    setAppliedSearch('');
                  }}
                  className="bg-zinc-200 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl transition-colors cursor-pointer"
                >
                  Reset
                </button>
              )}
              {showClearLogsConfirm ? (
                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-2xl text-[11px] font-bold md:ml-auto">
                  <span className="text-rose-600 dark:text-rose-450 uppercase tracking-wider">Clear all traces?</span>
                  <button
                    type="button"
                    onClick={handleClearAllAuditLogs}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] uppercase rounded-xl transition-colors cursor-pointer"
                  >Confirm</button>
                  <button
                    type="button"
                    onClick={() => setShowClearLogsConfirm(false)}
                    className="px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-black text-[10px] uppercase rounded-xl transition-colors cursor-pointer"
                  >Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowClearLogsConfirm(true)}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl transition-colors cursor-pointer shadow-md shadow-rose-500/10 flex items-center gap-1.5 md:ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Logs
                </button>
              )}
            </form>

            {/* Audit Logs Table */}
            <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl overflow-hidden shadow-lg transition-colors duration-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-550 dark:text-zinc-500 text-[10px] font-black border-b border-zinc-200 dark:border-zinc-900 uppercase tracking-widest">
                      <th className="px-6 py-4">Client User</th>
                      <th className="px-6 py-4">Dialogue Prompt</th>
                      <th className="px-6 py-4">Response Content</th>
                      <th className="px-6 py-4">Inference Node</th>
                      <th className="px-6 py-4">Timestamp</th>
                      <th className="px-6 py-4 text-right">Trace</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900 bg-zinc-50/10 dark:bg-zinc-950/10">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-10 text-zinc-450 dark:text-zinc-500 italic">
                          No audit traces found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-100/30 dark:hover:bg-zinc-900/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-sm text-zinc-800 dark:text-zinc-200">{log.username}</td>
                          <td className="px-6 py-4 truncate max-w-[180px] text-zinc-600 dark:text-zinc-400 font-medium">{log.prompt}</td>
                          <td className="px-6 py-4 truncate max-w-[220px] text-zinc-650 dark:text-zinc-400 font-medium">{log.response}</td>
                          <td className="px-6 py-4 text-[10px] font-mono text-zinc-500">{log.model_used}</td>
                          <td className="px-6 py-4 text-zinc-550 dark:text-zinc-500 font-medium">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => setSelectedAudit(log)}
                              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-750 dark:hover:text-indigo-300 hover:bg-indigo-500/5 p-2 rounded-xl border border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-800 transition-all cursor-pointer"
                            >
                              <Eye className="w-4.5 h-4.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Active Chats (Sessions) */}
        {activeTab === 'sessions' && (
          <div className="space-y-6 animate-in fade-in duration-200 text-left">
            <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl overflow-hidden shadow-lg transition-colors duration-300">
              <div className="p-5 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/20">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Active Chat Sessions</h3>
                <p className="text-[11px] text-zinc-550 mt-1">Intervene directly into active employee dialogues.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-550 dark:text-zinc-500 text-[10px] font-black border-b border-zinc-200 dark:border-zinc-900 uppercase tracking-widest">
                      <th className="px-6 py-4">Employee</th>
                      <th className="px-6 py-4">Session Title</th>
                      <th className="px-6 py-4">Created At</th>
                      <th className="px-6 py-4">Last Activity</th>
                      <th className="px-6 py-4 text-right">Intervention</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900 bg-zinc-50/10 dark:bg-zinc-950/10">
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="text-center py-10 text-zinc-450 dark:text-zinc-500 italic">
                          No active sessions found.
                        </td>
                      </tr>
                    ) : (
                      sessions.map((session) => (
                        <tr key={session.id} className="hover:bg-zinc-100/30 dark:hover:bg-zinc-900/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-sm text-zinc-800 dark:text-zinc-200">{session.username}</td>
                          <td className="px-6 py-4 font-semibold text-zinc-700 dark:text-zinc-350">{session.title}</td>
                          <td className="px-6 py-4 text-zinc-550 dark:text-zinc-500 font-medium">
                            {new Date(session.created_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-zinc-550 dark:text-zinc-500 font-medium">
                            {new Date(session.updated_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => {
                                setSelectedSessionId(session.id);
                                setShowInjectModal(true);
                              }}
                              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md shadow-indigo-500/10"
                            >
                              Intervene
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Usage Reports */}
        {activeTab === 'reports' && (
          <div className="space-y-6 animate-in fade-in duration-200 text-left">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Activity Stats List */}
              <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl p-6 shadow-lg">
                <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wider mb-4">Most Active Users</h3>
                <div className="space-y-4">
                  {reports?.most_active_users?.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">No activity logged yet.</p>
                  ) : (
                    reports?.most_active_users?.map((user, idx) => (
                      <div key={user.username} className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-indigo-500">#{idx + 1}</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{user.username}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-zinc-905 dark:text-white">{user.total_prompts} Prompts</div>
                          <div className="text-[10px] text-zinc-500">Avg Latency: {user.avg_latency}ms</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Model Distribution */}
              <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl p-6 shadow-lg">
                <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wider mb-4">Model Usage Distribution</h3>
                <div className="space-y-4">
                  {reports?.model_distribution?.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">No models registered in transaction logs.</p>
                  ) : (
                    reports?.model_distribution?.map((item) => (
                      <div key={item.model} className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-2">
                        <span className="text-xs font-mono font-bold text-indigo-400">{item.model}</span>
                        <span className="text-sm font-black text-zinc-850 dark:text-zinc-200">{item.count} hits</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Developer Visitor Analytics & Software Tracking */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
              <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl p-5 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 rounded-2xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Users</div>
                    <div className="text-2xl font-black text-zinc-900 dark:text-white mt-0.5">
                      {developerAnalytics?.total_registered_users || 0}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl p-5 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-2xl">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Visitors Today</div>
                    <div className="text-2xl font-black text-emerald-500 mt-0.5">
                      {developerAnalytics?.today_visitors_count || 0}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl p-5 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 text-purple-500 rounded-2xl">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Logins</div>
                    <div className="text-2xl font-black text-purple-500 mt-0.5">
                      {developerAnalytics?.total_logins_all_time || 0}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl p-5 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-2xl">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Prompts Served</div>
                    <div className="text-2xl font-black text-amber-500 mt-0.5">
                      {developerAnalytics?.total_chat_prompts_processed || 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Visitor Logs Table */}
            <div className="bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl overflow-hidden shadow-lg text-left">
              <div className="p-5 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/20 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-zinc-800 dark:text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-500" />
                    Developer Visitor Access Logs & Device Telemetry
                  </h3>
                  <p className="text-[10px] text-zinc-500 font-medium mt-0.5">Real-time visitor connections, device specs, and software activity (Restricted Developer View)</p>
                </div>
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-[10px] font-black uppercase">
                  ● Live Tracking Active
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 text-[10px] font-black border-b border-zinc-200 dark:border-zinc-900 uppercase tracking-widest">
                      <th className="px-6 py-4">Visitor User</th>
                      <th className="px-6 py-4">Role</th>
                      <th className="px-6 py-4">Event Type</th>
                      <th className="px-6 py-4">Browser / Device Specs</th>
                      <th className="px-6 py-4">Access Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900">
                    {developerAnalytics?.recent_visitors?.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 italic">No visitor connections logged yet.</td>
                      </tr>
                    ) : (
                      developerAnalytics?.recent_visitors?.map((v) => (
                        <tr key={v.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                          <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-[10px] uppercase font-black">
                              {v.username.charAt(0)}
                            </div>
                            {v.username}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                              v.role === 'admin' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                            }`}>
                              {v.role}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-extrabold uppercase">
                              {v.event_type}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-mono text-[10px] text-zinc-500 max-w-[280px] truncate" title={v.user_agent}>
                            {v.user_agent}
                          </td>
                          <td className="px-6 py-4 text-zinc-500 font-mono text-[11px]">
                            {new Date(v.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        

      </div>

      {/* Inspect Modal */}
      {selectedAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-55 dark:bg-zinc-900/30">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <Shield className="w-4.5 h-4.5 text-indigo-650 dark:text-indigo-400" />
                Audit Transaction Logs: ID #{selectedAudit.id}
              </h3>
              <button
                onClick={() => setSelectedAudit(null)}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs text-left">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl text-zinc-500 dark:text-zinc-400">
                <div>
                  <span className="text-zinc-500 dark:text-zinc-500 font-bold">Client:</span> <strong className="text-zinc-800 dark:text-zinc-200">{selectedAudit.username}</strong>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-zinc-500 font-bold">Inference Engine:</span> <span className="font-mono text-indigo-600 dark:text-indigo-405 bg-zinc-100 dark:bg-zinc-950 px-2 py-0.5 border border-zinc-200 dark:border-zinc-900 rounded">{selectedAudit.model_used}</span>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-zinc-500 font-bold">Logged:</span> <span>{new Date(selectedAudit.timestamp).toLocaleString()}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="block text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">Client Raw Query Prompt</span>
                <pre className="w-full p-4 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap select-text max-h-[150px] text-left">
                  {selectedAudit.prompt}
                </pre>
              </div>
              <div className="space-y-1.5">
                <span className="block text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">Host Model Response Content</span>
                <pre className="w-full p-4 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl overflow-x-auto font-mono text-[11px] leading-relaxed text-indigo-600 dark:text-indigo-300 whitespace-pre-wrap select-text max-h-[250px] text-left">
                  {selectedAudit.response}
                </pre>
              </div>
            </div>
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/30 border-t border-zinc-200 dark:border-zinc-900 flex justify-end">
              <button
                onClick={() => setSelectedAudit(null)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-500/10"
              >
                Close Audit logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal — replaces browser prompt */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col p-6 text-left">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
              <KeyRound className="w-4.5 h-4.5 text-amber-500" />
              Reset Password: {resetModal.username}
            </h3>
            
            {resetPasswordError && (
              <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold">
                {resetPasswordError}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1.5 pl-1">New User Password</label>
                <input
                  type="password"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  placeholder="Enter new password (min. 6 characters)..."
                  className="w-full glass-input rounded-2xl px-4 py-3 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 text-zinc-900 dark:text-white shadow-xs"
                  autoFocus
                />
              </div>
              
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModal(null)}
                  className="px-4 py-2.5 bg-zinc-200 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-500/10"
                >
                  Save Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Intervention Modal */}
      {showInjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col p-6 text-left">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
              <Shield className="w-4.5 h-4.5 text-indigo-500 animate-pulse" />
              Intervene in Chat: Session #{selectedSessionId.substring(0, 8)}
            </h3>
            
            {injectSuccess && (
              <div className={`p-3 mb-4 rounded-xl text-xs font-semibold ${
                injectSuccess.startsWith('Error') 
                  ? 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-455' 
                  : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-450'
              }`}>
                {injectSuccess}
              </div>
            )}
            
            <form onSubmit={handleAdminInject} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1.5 pl-1">Admin Message Override</label>
                <textarea
                  value={injectInput}
                  onChange={(e) => setInjectInput(e.target.value)}
                  placeholder="Type override message to display to the employee..."
                  rows={4}
                  required
                  className="w-full glass-input rounded-2xl px-4 py-3 text-xs outline-hidden focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 text-zinc-900 dark:text-white shadow-xs resize-none"
                  autoFocus
                />
              </div>
              
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInjectModal(false)}
                  className="px-4 py-2.5 bg-zinc-200 hover:bg-zinc-350 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-500/10"
                >
                  Send Intervention
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
