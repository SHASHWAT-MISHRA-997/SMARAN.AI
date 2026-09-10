import React, { useState, useEffect } from 'react';
import { Clock, Plus, Play, Pause, Trash2, Edit3, CheckCircle2, Calendar, RefreshCw, X, ArrowLeft } from 'lucide-react';

const DEFAULT_SCHEDULED_TASKS = [
  {
    id: 'task-1',
    name: 'Daily Repository Code Review',
    prompt: 'Analyze modified files from the past 24 hours, identify code smells, performance bottlenecks, and potential security vulnerabilities. Generate a clean markdown report.',
    schedule: 'Daily at 09:00 AM',
    cron: '0 9 * * *',
    model: 'SMARAN Core',
    active: true,
    lastRun: 'Today, 09:00 AM',
    nextRun: 'Tomorrow, 09:00 AM',
    status: 'success',
  },
  {
    id: 'task-2',
    name: 'Git Dependencies & Vulnerability Scan',
    prompt: 'Check package.json and requirements.txt for outdated packages or known security advisories. Summarize recommended upgrades.',
    schedule: 'Every 6 hours',
    cron: '0 */6 * * *',
    model: 'Claude 3.5 Sonnet',
    active: true,
    lastRun: '2 hours ago',
    nextRun: 'in 4 hours',
    status: 'success',
  },
  {
    id: 'task-3',
    name: 'Morning Architecture Digest',
    prompt: 'Summarize system architectural changes, outstanding PR notes, and roadmap priorities into actionable morning brief items.',
    schedule: 'Weekdays at 08:30 AM',
    cron: '30 8 * * 1-5',
    model: 'Auto',
    active: false,
    lastRun: 'Yesterday, 08:30 AM',
    nextRun: 'Paused',
    status: 'idle',
  },
  {
    id: 'task-4',
    name: 'Stale Artifacts & Temp Clean',
    prompt: 'Inspect temp test logs, expired cache objects, and build output directories. Recommend safe cleanups.',
    schedule: 'Weekly on Sundays',
    cron: '0 0 * * 0',
    model: 'Llama 3.1 8B',
    active: true,
    lastRun: '3 days ago',
    nextRun: 'Sunday at 12:00 AM',
    status: 'success',
  }
];

export default function ScheduledTasksView({ onNavigate, onEnsureSession }) {
  const [tasks, setTasks] = useState(() => {
    try {
      const saved = localStorage.getItem('sm_scheduled_tasks');
      return saved ? JSON.parse(saved) : DEFAULT_SCHEDULED_TASKS;
    } catch {
      return DEFAULT_SCHEDULED_TASKS;
    }
  });

  const [filter, setFilter] = useState('all'); // 'all' | 'active' | 'paused'
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [executingId, setExecutingId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Form states
  const [taskName, setTaskName] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskSchedule, setTaskSchedule] = useState('Daily at 09:00 AM');
  const [taskModel, setTaskModel] = useState('Auto');

  useEffect(() => {
    try {
      localStorage.setItem('sm_scheduled_tasks', JSON.stringify(tasks));
    } catch (e) {
      console.error(e);
    }
  }, [tasks]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleToggleActive = (id) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active: !t.active, nextRun: !t.active ? 'Scheduled' : 'Paused' } : t))
    );
    showToast('Task schedule status updated');
  };

  const handleDelete = (id) => {
    if (window.confirm('Delete this scheduled task?')) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      showToast('Task removed from schedule');
    }
  };

  const handleRunNow = async (task) => {
    setExecutingId(task.id);
    showToast(`Executing "${task.name}" now...`);
    try {
      const session = await onEnsureSession?.();
      const promptText = `[Scheduled Task Triggered: ${task.name}]\nModel: ${task.model}\n\n${task.prompt}`;
      localStorage.setItem('sm_pending_prompt', promptText);
      // Same reason as Design Studio: ChatArea is unmounted while this
      // view is open, so the event below has no listener. Running a task
      // should run it, not leave it typed out for you.
      localStorage.setItem('sm_pending_autosend', '1');
      window.dispatchEvent(new CustomEvent('smaran:send-prompt', { detail: { prompt: promptText, sessionId: session?.id } }));
      
      // Update last run time
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, lastRun: 'Just now', status: 'success' } : t))
      );

      if (onNavigate) {
        setTimeout(() => onNavigate('chat'), 400);
      }
    } catch (err) {
      console.error(err);
      showToast('Error triggering task');
    } finally {
      setExecutingId(null);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingTask(null);
    setTaskName('');
    setTaskPrompt('');
    setTaskSchedule('Daily at 09:00 AM');
    setTaskModel('Auto');
    setShowModal(true);
  };

  const handleOpenEditModal = (task) => {
    setEditingTask(task);
    setTaskName(task.name);
    setTaskPrompt(task.prompt);
    setTaskSchedule(task.schedule);
    setTaskModel(task.model);
    setShowModal(true);
  };

  const handleSaveTask = (e) => {
    e.preventDefault();
    if (!taskName.trim() || !taskPrompt.trim()) return;

    if (editingTask) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingTask.id
            ? {
                ...t,
                name: taskName.trim(),
                prompt: taskPrompt.trim(),
                schedule: taskSchedule,
                model: taskModel,
              }
            : t
        )
      );
      showToast('Scheduled task updated');
    } else {
      const newTask = {
        id: `task-${Date.now()}`,
        name: taskName.trim(),
        prompt: taskPrompt.trim(),
        schedule: taskSchedule,
        cron: '0 9 * * *',
        model: taskModel,
        active: true,
        lastRun: 'Never',
        nextRun: 'Upcoming',
        status: 'idle',
      };
      setTasks((prev) => [newTask, ...prev]);
      showToast('New scheduled task created');
    }

    setShowModal(false);
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'active' && !t.active) return false;
    if (filter === 'paused' && t.active) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      return t.name.toLowerCase().includes(s) || t.prompt.toLowerCase().includes(s);
    }
    return true;
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-zinc-50 dark:bg-[#0c0c0e] text-zinc-900 dark:text-zinc-100 overflow-y-auto transition-colors duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-900/60 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          {onNavigate && (
            <button
              onClick={() => onNavigate('chat')}
              className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition cursor-pointer md:hidden"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black tracking-tight">Scheduled Automations</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                Cron Engine
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Run automated AI coding jobs, reviews, and workflows on custom schedules.
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 transition cursor-pointer"
        >
          <Plus className="w-4 h-4" /> New Schedule
        </button>
      </header>

      {/* Main Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Controls: Search & Tabs */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-full sm:w-auto">
            {[
              { id: 'all', label: `All (${tasks.length})` },
              { id: 'active', label: `Active (${tasks.filter((t) => t.active).length})` },
              { id: 'paused', label: `Paused (${tasks.filter((t) => !t.active).length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex-1 sm:flex-initial cursor-pointer ${
                  filter === tab.id
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search scheduled tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64 px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:border-indigo-500 outline-none"
          />
        </div>

        {/* Tasks List */}
        <div className="space-y-3.5">
          {filteredTasks.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800">
              <Clock className="w-10 h-10 text-zinc-400 mx-auto mb-3 opacity-60" />
              <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200">No scheduled tasks match</h3>
              <p className="text-xs text-zinc-500 mt-1">Create a schedule or change your search filter.</p>
              <button
                onClick={handleOpenCreateModal}
                className="mt-4 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Create Task
              </button>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.id}
                className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                  task.active
                    ? 'bg-white dark:bg-zinc-900/90 border-zinc-200 dark:border-zinc-800 hover:border-indigo-500/50 shadow-xs'
                    : 'bg-zinc-100/70 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800/60 opacity-80'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-sm text-zinc-900 dark:text-white">
                        {task.name}
                      </span>
                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          task.active
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {task.active ? 'Active' : 'Paused'}
                      </span>
                      <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-md">
                        {task.model}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-3">
                      {task.prompt}
                    </p>

                    <div className="flex items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400 flex-wrap">
                      <span className="flex items-center gap-1 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                        {task.schedule}
                      </span>
                      <span>Last run: <strong className="text-zinc-700 dark:text-zinc-300">{task.lastRun}</strong></span>
                      <span>Next: <strong className="text-zinc-700 dark:text-zinc-300">{task.nextRun}</strong></span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => handleRunNow(task)}
                      disabled={executingId === task.id}
                      className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Run now immediately"
                    >
                      {executingId === task.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      Run Now
                    </button>

                    <button
                      onClick={() => handleToggleActive(task.id)}
                      className={`p-2 rounded-xl border text-xs transition cursor-pointer ${
                        task.active
                          ? 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                      }`}
                      title={task.active ? 'Pause schedule' : 'Resume schedule'}
                    >
                      {task.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={() => handleOpenEditModal(task)}
                      className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition cursor-pointer"
                      title="Edit task"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDelete(task.id)}
                      className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
                      title="Delete task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-500" />
                {editingTask ? 'Edit Scheduled Task' : 'New Scheduled Automation'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Task Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Daily Codebase Health Check"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Schedule Interval
                </label>
                <select
                  value={taskSchedule}
                  onChange={(e) => setTaskSchedule(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500"
                >
                  <option value="Hourly">Every Hour</option>
                  <option value="Every 3 hours">Every 3 Hours</option>
                  <option value="Every 6 hours">Every 6 Hours</option>
                  <option value="Daily at 09:00 AM">Daily at 09:00 AM</option>
                  <option value="Daily at midnight">Daily at Midnight (00:00)</option>
                  <option value="Weekdays at 08:30 AM">Weekdays (Mon-Fri) at 08:30 AM</option>
                  <option value="Weekly on Sundays">Weekly on Sundays</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  AI Model
                </label>
                <select
                  value={taskModel}
                  onChange={(e) => setTaskModel(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500"
                >
                  <option value="Auto">Auto (Smart Routing)</option>
                  <option value="SMARAN Core">SMARAN Core (Llama 3.1 8B)</option>
                  <option value="Claude 3.5 Sonnet">Claude 3.5 Sonnet</option>
                  <option value="GPT-4o">GPT-4o</option>
                  <option value="Gemini 1.5 Pro">Gemini 1.5 Pro</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  Prompt & Execution Instructions
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe what SMARAN should do when this task triggers..."
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 resize-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-md shadow-indigo-600/25"
                >
                  {editingTask ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
