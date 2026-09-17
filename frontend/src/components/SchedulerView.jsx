import React, { useState, useEffect, useRef } from 'react';
import { Clock, Play, Trash2, Plus, RefreshCw, Activity, Calendar } from 'lucide-react';
import { agentSettingsRequest } from '../utils/agentSettingsRequest';

export default function SchedulerView() {
  const fetching = useRef(false);
  const historyRequest = useRef(0);
  const [error, setError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningJobId, setRunningJobId] = useState(null);
  const [selectedJobHistory, setSelectedJobHistory] = useState(null);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Job Form State
  const [name, setName] = useState('');
  const [scheduleExpr, setScheduleExpr] = useState('every 1 hour');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [targetChannel, setTargetChannel] = useState('ui');
  const [targetRecipient, setTargetRecipient] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const fetchJobs = async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const data = await agentSettingsRequest('/scheduler/jobs');
      setJobs(data.jobs || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateJob = async (e) => {
    e.preventDefault();
    if (!name.trim() || !taskPrompt.trim() || !scheduleExpr.trim()) return;
    setCreateLoading(true);
    setStatusMsg('');
    try {
      await agentSettingsRequest('/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          schedule_expr: scheduleExpr.trim(),
          task_prompt: taskPrompt.trim(),
          target_channel: targetChannel,
          target_recipient: targetRecipient.trim(),
        }),
      });
      setShowCreateModal(false);
      setName('');
      setTaskPrompt('');
      setScheduleExpr('every 1 hour');
      setTargetRecipient('');
      setTargetChannel('ui');
      await fetchJobs();
    } catch (err) {
      setStatusMsg(err.message || String(err));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRunNow = async (jobId) => {
    setRunningJobId(jobId);
    try {
      await agentSettingsRequest(`/scheduler/jobs/${jobId}/run`, { method: 'POST' });
      await fetchJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunningJobId(null);
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!confirm('Are you sure you want to delete this scheduled automation?')) return;
    try {
      await agentSettingsRequest(`/scheduler/jobs/${jobId}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleViewHistory = async (job) => {
    const requestId = ++historyRequest.current;
    setSelectedJobHistory(job);
    setHistoryLogs([]);
    setHistoryLoading(true);
    try {
      const data = await agentSettingsRequest(`/scheduler/jobs/${job.id}/history`);
      if (requestId === historyRequest.current) setHistoryLogs(data.history || []);
    } catch (err) {
      setError(err.message);
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false);
    }
  };

  const formatTimestamp = (ts) => {
    if (!ts || ts <= 0) return 'Never';
    return new Date(ts * 1000).toLocaleString();
  };

  return (
    <div className="flex flex-col h-full w-full space-y-4">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-500" />
            Scheduled Automations
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Autonomous cron jobs & tasks running in the background with multi-channel delivery
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            New Automation
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {/* Jobs List */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {jobs.length === 0 && !loading && !error ? (
          <div className="text-center py-12 px-4 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
            <Clock className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">No scheduled automations</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Create recurring background tasks that query APIs, monitor workspaces, or send digests.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-3 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
            >
              Add First Automation
            </button>
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 hover:border-indigo-500/40 transition shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{job.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900">
                      {job.schedule_expr}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      job.last_status === 'success' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' :
                      job.last_status === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' :
                      'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {job.last_status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 font-mono bg-zinc-50 dark:bg-zinc-950 p-2 rounded-lg border border-zinc-100 dark:border-zinc-800/80 line-clamp-2">
                    {job.task_prompt}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    disabled={runningJobId === job.id || job.last_status === 'running'}
                    onClick={() => handleRunNow(job.id)}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-50"
                    title="Run Now"
                  >
                    <Play className={`w-3.5 h-3.5 ${runningJobId === job.id ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleViewHistory(job)}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                    title="History"
                  >
                    <Activity className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteJob(job.id)}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800/50">
                <span>Next run: {formatTimestamp(job.next_run_ts)}</span>
                <span>Last run: {formatTimestamp(job.last_run_ts)}</span>
                <span>Target: {job.target_channel}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg max-h-[85dvh] overflow-y-auto p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Create Scheduled Automation</h3>
            <form onSubmit={handleCreateJob} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Job Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Daily Workspace Review, Health Check"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Schedule (Natural Language or Cron)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. every 30 minutes, daily at 09:00, or */15 * * * *"
                  value={scheduleExpr}
                  onChange={(e) => setScheduleExpr(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Task Instruction</label>
                <textarea
                  required
                  rows={3}
                  placeholder="What should SMARAN agent do when this triggers?"
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Deliver To</label>
                  <select
                    value={targetChannel}
                    onChange={(e) => setTargetChannel(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none"
                  >
                    <option value="ui">UI Only</option>
                    <option value="telegram">Telegram Bot</option>
                    <option value="discord">Discord Bot</option>
                    <option value="webhook">Webhook URL</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Recipient ID / URL</label>
                  <input
                    type="text"
                    placeholder="Chat ID or Webhook URL"
                    value={targetRecipient}
                    onChange={(e) => setTargetRecipient(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                </div>
              </div>

              {statusMsg && <p className="text-xs text-red-500">{statusMsg}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition"
                >
                  {createLoading ? 'Creating...' : 'Save Automation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Drawer */}
      {selectedJobHistory && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-xl p-6 space-y-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Execution History</h3>
                <p className="text-xs text-zinc-500">{selectedJobHistory.name}</p>
              </div>
              <button
                onClick={() => setSelectedJobHistory(null)}
                className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
              {historyLogs.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-6">{historyLoading ? 'Loading history…' : 'No execution runs yet.'}</p>
              ) : (
                historyLogs.map((log) => (
                  <div key={log.id} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs space-y-1 font-mono">
                    <div className="flex justify-between text-zinc-500 text-[10px]">
                      <span>{new Date(log.run_ts * 1000).toLocaleString()}</span>
                      <span className={log.status === 'success' ? 'text-emerald-500' : 'text-red-500'}>{log.status} ({log.duration_sec?.toFixed(1)}s)</span>
                    </div>
                    <pre className="text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap text-[11px] max-h-32 overflow-y-auto">
                      {log.result || '(No output)'}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
