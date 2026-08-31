import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart2,
  Brain,
  Calendar,
  Clock,
  FileText,
  Filter,
  RefreshCw,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

const numberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const displayCount = (value) => numberOrZero(value).toLocaleString();

const displayLatency = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? `${parsed.toLocaleString()} ms` : 'Unavailable';
};

export default function AnalyticsModal({ isOpen, onClose, token, apiBase }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [filterType, setFilterType] = useState('all');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  );
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const refreshRef = useRef(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchAnalytics = async (background = false) => {
    if (!background) setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBase || ''}/api/analytics/dashboard`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `Analytics request failed (${response.status})`);
      }
      setData(await response.json());
    } catch (requestError) {
      setError(requestError.message || 'Analytics could not be loaded.');
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    fetchAnalytics(false);
    if (autoRefresh) refreshRef.current = window.setInterval(() => fetchAnalytics(true), 2000);
    return () => {
      if (refreshRef.current) window.clearInterval(refreshRef.current);
    };
  }, [isOpen, autoRefresh, token, apiBase]);

  const rawSummary = data?.summary || {
    total_requests: 0,
    total_messages: 0,
    total_words: 0,
    prompt_words: 0,
    response_words: 0,
    avg_latency_ms: null,
    latency_samples: 0,
    total_documents: 0,
    total_chunks: 0,
    total_memories: 0,
    total_sessions: 0,
    active_days: 0,
    active_hours: null,
  };
  const rawDailyHistory = data?.daily_history || [];
  const rawModelBreakdown = data?.model_breakdown || [];
  const rawMonthlyHistory = data?.monthly_history || [];
  const rawHourlyDistribution = data?.hourly_distribution || Array(24).fill(0);
  const rawRecentActivity = data?.recent_activity || [];
  const modeBreakdown = data?.mode_breakdown || {
    available: false,
    reason: 'Interaction mode was not stored in the audit schema.',
  };

  const availableYears = useMemo(() => {
    const years = new Set([new Date().getFullYear().toString()]);
    rawDailyHistory.forEach((row) => {
      if (String(row.date || '').includes('-')) years.add(String(row.date).split('-')[0]);
    });
    return Array.from(years).sort().reverse();
  }, [rawDailyHistory]);

  const availableMonths = useMemo(() => {
    const months = new Set([selectedMonth]);
    rawDailyHistory.forEach((row) => {
      if (String(row.date || '').length >= 7) months.add(String(row.date).slice(0, 7));
    });
    rawMonthlyHistory.forEach((row) => {
      if (row.month) months.add(String(row.month));
    });
    return Array.from(months).sort().reverse();
  }, [rawDailyHistory, rawMonthlyHistory, selectedMonth]);

  const rowMatchesFilter = (dateValue) => {
    const value = String(dateValue || '');
    if (filterType === 'year') return value.startsWith(selectedYear);
    if (filterType === 'month') return value.startsWith(selectedMonth);
    if (filterType === 'date') return value.startsWith(selectedDate);
    return true;
  };

  const filteredData = useMemo(() => {
    if (filterType === 'all') {
      return {
        summary: rawSummary,
        dailyHistory: rawDailyHistory,
        modelBreakdown: rawModelBreakdown,
        monthlyHistory: rawMonthlyHistory,
        hourlyDistribution: rawHourlyDistribution,
        recentActivity: rawRecentActivity,
      };
    }

    const dailyHistory = rawDailyHistory.filter((row) => rowMatchesFilter(row.date));
    const recentActivity = rawRecentActivity.filter((row) => rowMatchesFilter(row.timestamp));
    const monthlyHistory = rawMonthlyHistory.filter((row) => {
      if (filterType === 'year') return String(row.month || '').startsWith(selectedYear);
      if (filterType === 'month') return String(row.month || '') === selectedMonth;
      return String(row.month || '') === selectedDate.slice(0, 7);
    });
    const latencySamples = dailyHistory.reduce((sum, row) => sum + numberOrZero(row.latency_samples), 0);
    const latencyTotal = dailyHistory.reduce(
      (sum, row) => sum + numberOrZero(row.avg_latency_ms) * numberOrZero(row.latency_samples),
      0,
    );
    return {
      summary: {
        ...rawSummary,
        total_requests: dailyHistory.reduce((sum, row) => sum + numberOrZero(row.prompts), 0),
        total_words: dailyHistory.reduce((sum, row) => sum + numberOrZero(row.words), 0),
        prompt_words: null,
        response_words: null,
        avg_latency_ms: latencySamples ? Math.round((latencyTotal / latencySamples) * 10) / 10 : null,
        latency_samples: latencySamples,
        active_days: dailyHistory.length,
        active_hours: null,
      },
      dailyHistory,
      // The endpoint only provides all-time model/hour aggregates, so they are
      // intentionally hidden while a date filter is active.
      modelBreakdown: [],
      monthlyHistory,
      hourlyDistribution: [],
      recentActivity,
    };
  }, [
    filterType,
    selectedYear,
    selectedMonth,
    selectedDate,
    rawSummary,
    rawDailyHistory,
    rawModelBreakdown,
    rawMonthlyHistory,
    rawHourlyDistribution,
    rawRecentActivity,
  ]);

  if (!isOpen) return null;

  const { summary, dailyHistory, modelBreakdown, monthlyHistory, hourlyDistribution, recentActivity } = filteredData;
  const maxWords = Math.max(1, ...dailyHistory.map((row) => numberOrZero(row.words)));
  const maxRequests = Math.max(1, ...modelBreakdown.map((row) => numberOrZero(row.requests)));
  const maxHourly = Math.max(1, ...hourlyDistribution.map(numberOrZero));
  const formattedDate = currentTime.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
  });
  const formattedClock = currentTime.toLocaleTimeString();

  const tabClass = (tab, color) => `px-3.5 py-2 rounded-t-xl text-xs font-black transition-all border-t border-x cursor-pointer shrink-0 ${
    activeTab === tab
      ? `bg-zinc-950 border-zinc-800 ${color}`
      : 'bg-zinc-900/40 border-transparent text-zinc-400 hover:text-zinc-200'
  }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-zinc-950 border border-indigo-500/35 rounded-3xl w-full max-w-5xl max-h-[94vh] flex flex-col shadow-[0_0_90px_rgba(99,102,241,0.3)] overflow-hidden text-left">
        <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-white tracking-tight">Saved Usage & Latency Logs</h2>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black transition-all cursor-pointer ${
                autoRefresh ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              {autoRefresh ? 'AUTO REFRESH 2s' : 'PAUSED'}
            </button>
            <button type="button" onClick={() => fetchAnalytics(false)} disabled={loading} className="p-2 text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-xl disabled:opacity-40" aria-label="Refresh saved logs">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-xl" aria-label="Close analytics">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-2 bg-indigo-950/25 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 font-mono text-indigo-300">
            <Calendar className="w-3.5 h-3.5" />
            <span>{formattedDate}</span>
            <span className="text-zinc-600">-</span>
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-300">{formattedClock}</span>
          </div>
          <span className="text-zinc-500">Mode split: {modeBreakdown.available ? 'Recorded' : 'Unavailable in current schema'}</span>
        </div>

        <div className="px-4 sm:px-5 py-2.5 bg-zinc-900/60 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-400" /> Filter
            </span>
            <div className="flex items-center bg-zinc-950 p-0.5 rounded-xl border border-zinc-800 overflow-x-auto max-w-full">
              {[
                ['all', 'All time'], ['year', 'Year'], ['month', 'Month'], ['date', 'Date'],
              ].map(([value, label]) => (
                <button key={value} type="button" onClick={() => setFilterType(value)} className={`px-2.5 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${filterType === value ? 'bg-indigo-600 text-white' : 'text-zinc-400'}`}>
                  {label}
                </button>
              ))}
            </div>
            {filterType === 'year' && (
              <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="bg-zinc-950 border border-indigo-500/40 text-indigo-300 rounded-xl px-2.5 py-1 text-xs">
                {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            )}
            {filterType === 'month' && (
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="bg-zinc-950 border border-indigo-500/40 text-indigo-300 rounded-xl px-2.5 py-1 text-xs">
                {availableMonths.map((month) => <option key={month} value={month}>{month}</option>)}
              </select>
            )}
            {filterType === 'date' && (
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="bg-zinc-950 border border-indigo-500/40 text-indigo-300 rounded-xl px-2.5 py-1 text-xs" />
            )}
          </div>
          {filterType !== 'all' && <span className="text-[10px] text-amber-300">Model and hourly aggregates are hidden because the API stores them as all-time totals.</span>}
        </div>

        {/* The three tabs need 589px and a phone gives 357. They used to sit in
            a horizontally scrolling row, but a touch device draws no scrollbar,
            so the last tab simply looked cut off. Below sm they wrap instead. */}
        <div className="px-4 sm:px-5 pt-2.5 pb-0.5 sm:pb-0 bg-zinc-900/40 border-b border-zinc-800 flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 sm:overflow-x-auto">
          <button type="button" onClick={() => setActiveTab('overview')} className={tabClass('overview', 'text-indigo-400')}>Overview</button>
          <button type="button" onClick={() => setActiveTab('daily')} className={tabClass('daily', 'text-emerald-400')}>Daily & Hourly</button>
          <button type="button" onClick={() => setActiveTab('models')} className={tabClass('models', 'text-amber-400')}>Model Usage & Latency</button>
          <button type="button" onClick={() => setActiveTab('records')} className={tabClass('records', 'text-cyan-400')}>Recent Audit Records</button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {error && <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">{error}</div>}
          {loading && !data ? (
            <div className="py-20 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
              <p className="text-xs text-zinc-400 font-bold">Reading saved SQLite audit rows...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  ['Audit requests', displayCount(summary.total_requests), `${displayCount(summary.total_messages)} saved chat messages`, BarChart2, 'text-indigo-400'],
                  ['Recorded words', displayCount(summary.total_words), filterType === 'all' ? `${displayCount(summary.prompt_words)} prompt / ${displayCount(summary.response_words)} response` : 'Input/output split unavailable for filtered range', FileText, 'text-amber-400'],
                  ['Recorded avg latency', displayLatency(summary.avg_latency_ms), `${displayCount(summary.latency_samples)} latency samples`, Clock, 'text-cyan-400'],
                  ['Active days', displayCount(summary.active_days), 'Active hours were not recorded', Calendar, 'text-emerald-400'],
                ].map(([label, value, note, Icon, color]) => (
                  <div key={label} className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl space-y-1 min-w-0">
                    <div className="flex items-center justify-between text-zinc-400 text-xs font-bold"><span>{label}</span><Icon className={`w-4 h-4 ${color}`} /></div>
                    <div className="text-xl sm:text-2xl font-black text-white break-words">{value}</div>
                    <div className="text-[10px] text-zinc-500 break-words">{note}</div>
                  </div>
                ))}
              </div>

              {activeTab === 'overview' && (
                <div className="space-y-4">
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-2xl space-y-3">
                        <h3 className="flex items-center gap-2 text-xs font-black text-white uppercase"><FileText className="w-4 h-4 text-purple-400" />Saved document rows</h3>
                        <p className="text-xs text-zinc-400">Uploaded document records: <span className="text-white font-mono">{displayCount(summary.total_documents)}</span></p>
                        <p className="text-xs text-zinc-400">Indexed chunk records: <span className="text-white font-mono">{displayCount(summary.total_chunks)}</span></p>
                      </div>
                      <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-2xl space-y-3">
                        <h3 className="flex items-center gap-2 text-xs font-black text-white uppercase"><Brain className="w-4 h-4 text-pink-400" />Saved memory rows</h3>
                        <p className="text-xs text-zinc-400">User memory records: <span className="text-white font-mono">{displayCount(summary.total_memories)}</span></p>
                        <p className="text-xs text-zinc-400">Chat session records: <span className="text-white font-mono">{displayCount(summary.total_sessions)}</span></p>
                      </div>
                      <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-2xl space-y-3 hidden">
                        <h3 className="flex items-center gap-2 text-xs font-black text-white uppercase"><Zap className="w-4 h-4 text-indigo-400" />Measurement limits</h3>
                        <p className="text-xs text-zinc-400">Tokenizer counts: <span className="text-amber-300">Not stored</span></p>
                        <p className="text-xs text-zinc-400">Active hours: <span className="text-amber-300">Not stored</span></p>
                        <p className="text-xs text-zinc-400">Security certification: <span className="text-amber-300">Not asserted here</span></p>
                      </div>
                    </div>
                </div>
              )}

              {activeTab === 'daily' && (
                <div className="space-y-5">
                  <div className="bg-zinc-900/70 border border-zinc-800 p-4 sm:p-5 rounded-2xl space-y-4">
                    <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2"><Clock className="w-4 h-4 text-cyan-400" />Hourly saved request count</h3>
                    {hourlyDistribution.length === 0 ? (
                      <p className="py-8 text-center text-xs text-zinc-500">Unavailable for the selected date filter.</p>
                    ) : (
                      <div className="h-36 flex items-end gap-1 pt-6 pb-2 px-2 bg-zinc-950 rounded-xl border border-zinc-800">
                        {hourlyDistribution.map((count, hour) => {
                          const numericCount = numberOrZero(count);
                          const height = numericCount ? Math.max(4, (numericCount / maxHourly) * 100) : 0;
                          return (
                            <div key={hour} className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                              <div className="absolute -top-7 opacity-0 group-hover:opacity-100 bg-zinc-800 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap">{hour}:00 - {numericCount} records</div>
                              <div className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-cyan-400 transition-all" style={{ height: `${height}%` }} />
                              <span className="text-[8px] text-zinc-500">{hour % 6 === 0 ? `${hour}h` : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="bg-zinc-900/60 border border-zinc-800 p-4 sm:p-5 rounded-2xl space-y-4">
                    <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />Daily word and request volume</h3>
                    {dailyHistory.length === 0 ? <p className="py-8 text-center text-xs text-zinc-500">No saved audit rows for this period.</p> : (
                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {dailyHistory.map((row) => {
                          const width = numberOrZero(row.words) ? Math.max(4, (numberOrZero(row.words) / maxWords) * 100) : 0;
                          return (
                            <div key={row.date} className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                                <span className="text-zinc-200 font-black">{row.date}</span>
                                <div className="flex flex-wrap gap-3"><span className="text-indigo-400">{displayCount(row.prompts)} requests</span><span className="text-cyan-400">{displayLatency(row.avg_latency_ms)} avg</span><span className="text-emerald-400">{displayCount(row.words)} words</span></div>
                              </div>
                              <div className="h-2.5 bg-zinc-900 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-cyan-400" style={{ width: `${width}%` }} /></div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {monthlyHistory.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {monthlyHistory.map((row) => <div key={row.month} className="p-3.5 bg-zinc-900 rounded-xl border border-zinc-800"><span className="text-[10px] text-zinc-500 font-mono">{row.month}</span><div className="text-sm font-black text-indigo-300">{displayCount(row.words)} words</div><div className="text-[10px] text-zinc-400">{displayCount(row.prompts)} requests</div></div>)}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'models' && (
                <div className="bg-zinc-900/60 border border-zinc-800 p-4 sm:p-5 rounded-2xl space-y-4">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Recorded model field and latency</h3>
                  {modelBreakdown.length === 0 ? <p className="py-8 text-center text-xs text-zinc-500">{filterType === 'all' ? 'No saved model usage rows.' : 'Per-model date filtering is unavailable in the current endpoint.'}</p> : (
                    <div className="space-y-3">
                      {modelBreakdown.map((row, index) => {
                        const width = Math.max(4, (numberOrZero(row.requests) / maxRequests) * 100);
                        return (
                          <div key={`${row.model}-${index}`} className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-black text-white break-all">{row.model}</span><div className="flex flex-wrap gap-3 text-[11px] font-mono"><span className="text-zinc-400">{displayCount(row.requests)} requests</span><span className="text-cyan-400">{displayLatency(row.avg_latency_ms)} avg</span><span className="text-amber-400">{displayCount(row.total_words)} words</span></div></div>
                            <div className="h-2 bg-zinc-900 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-500 to-indigo-500" style={{ width: `${width}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'records' && (
                <div className="bg-zinc-900/60 border border-zinc-800 p-4 sm:p-5 rounded-2xl space-y-4">
                  <div><h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" />Latest saved audit records</h3><p className="text-[10px] text-zinc-500 mt-1">The endpoint returns at most the latest 12 records.</p></div>
                  {recentActivity.length === 0 ? <p className="py-8 text-center text-xs text-zinc-500">No returned records match this filter.</p> : (
                    <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 font-mono text-xs">
                      {recentActivity.map((row) => (
                        <div key={row.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0"><div className="flex flex-wrap gap-2 text-[10px]"><span className="text-emerald-400">{row.timestamp}</span><span className="text-indigo-300 break-all">{row.model}</span></div><div className="text-zinc-200 text-[11px] truncate">{row.prompt_snippet}</div></div>
                          <div className="flex gap-2 text-[10px] shrink-0"><span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400">{displayLatency(row.latency_ms)}</span><span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400">{displayCount(row.words)} words</span></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-zinc-800 bg-zinc-900/60 flex flex-wrap justify-end items-center text-[10px] text-zinc-400 font-mono gap-2 shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl">Close Dashboard</button>
        </div>
      </div>
    </div>
  );
}
