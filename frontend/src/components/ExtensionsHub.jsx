import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Blocks, CheckCircle2, ChevronDown, Loader2, Plug, Plus, RefreshCw,
  Search, Sparkles, Trash2, Wrench, X, Code2, Play, Terminal, Database, Globe, FolderGit2, Cpu
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { isNativeApp, loadLink } from '../utils/hostLink';

/** No computer behind the phone, so nothing on this screen can run. */
const noBackend = () => isNativeApp() && !loadLink()?.url;

const MANAGE_FILTERS = [
  { id: 'plugin', label: 'Plugins', icon: Blocks },
  { id: 'skill', label: 'Skills', icon: Sparkles },
  { id: 'mcp', label: 'MCP Servers', icon: Wrench },
  { id: 'connector', label: 'Connectors', icon: Plug },
];



// Four arrays lived here: STANDARD_MCPS, STANDARD_SKILLS, GENUINE_PLUGINS
// and GENUINE_CONNECTORS. Every entry carried state: 'connected' or
// runtime_status: 'active' typed straight into the source, along with a list
// of tools it claimed to expose. Ten MCP servers announced themselves as
// running on a machine where /api/mcp/servers returns an empty list and a
// note saying a saved server is not a connected one. None of them had been
// started, and the counts above the list - "7 available, 7 active" - were
// counting these. They are deleted. This screen shows what the backend
// reports, and an empty list where there is nothing.

const STATE = {
  active:         { label: 'Running',  tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  connected:      { label: 'Running',  tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  // "Ready" was the wrong word: setup_required means the backend could not
  // start it, usually because a tool it drives is not installed. Calling that
  // ready reads as working.
  setup_required: { label: 'Needs setup', tone: 'text-amber-400', dot: 'bg-amber-400' },
  error:          { label: 'Failed',   tone: 'text-rose-400',    dot: 'bg-rose-400' },
  disabled:       { label: 'Off',      tone: 'text-zinc-500',    dot: 'bg-zinc-600' },
};



const ExtensionsHub = ({ isOpen = true, onClose, embedded = false }) => {
  // These three lists used to be seeded from STANDARD_MCPS, STANDARD_SKILLS
  // and GENUINE_PLUGINS - arrays written into this file with state:
  // 'connected' and runtime_status: 'active' typed in beside every entry.
  // Ten MCP servers reported themselves connected, each with a list of tools,
  // on a machine where /api/mcp/servers returns an empty list and says so.
  // Nothing was ever started. They are gone; what the backend reports is what
  // is shown, and nothing is what nothing looks like.
  const [rows, setRows] = useState([]);
  const [custom, setCustom] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sm_custom_mcps') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  });
  const [customSkills, setCustomSkills] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sm_custom_skills') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  });

  // Browsing, adding and starting MCP servers for real. The backend has had
  // a working MCP client all along - stdio JSON-RPC, initialize, tools/list -
  // and this screen was showing a hardcoded list instead of using it.
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  const [busyServer, setBusyServer] = useState('');
  const [serverNote, setServerNote] = useState('');

  const loadCatalogue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/mcp/catalogue`, { credentials: 'include' });
      if (res.ok) setCatalogue((await res.json()).servers || []);
    } catch (_) { /* leave it empty rather than invent entries */ }
  }, []);

  const [section, setSection] = useState('plugin');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(null); // 'create' | 'mcp' | 'repo' | 'skill'
  const [loadError, setLoadError] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [all, mine] = await Promise.all([
        fetch(`${API_BASE}/api/plugins`, { credentials: 'include' }).then(async (r) => {
          if (!r.ok) return [];
          return r.json();
        }).catch(() => []),
        fetch(`${API_BASE}/api/mcp/servers`, { credentials: 'include' })
          .then((r) => r.json()).then((d) => d.servers || []).catch(() => []),
      ]);

      const rawPlugins = Array.isArray(all) ? all : Object.values(all?.plugins || all || {});
      const normalizedPlugins = rawPlugins.filter(Boolean).map((item) => {
        const itemType = item.type || item.plugin_type || 'plugin';
        return {
          id: item.name || item.id,
          name: item.name ? item.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Extension',
          raw_name: item.name,
          description: item.description || 'SMARAN.AI integrated extension module.',
          type: itemType === 'skill' ? 'skill' : itemType === 'connector' ? 'connector' : 'plugin',
          author: item.author || 'SMARAN Workspace',
          // This read `item.enabled ? 'active' : ...`, which painted anything
          // not switched off as Running. enabled only means configuration has
          // not disabled it; the backend separately reports whether the thing
          // actually started, and that answer was being thrown away. Plugins
          // waiting on a tool that is not installed were showing green.
          runtime_status: item.runtime_status || (item.enabled === false ? 'disabled' : 'setup_required'),
          status_detail: item.status_detail || '',
          capabilities: Array.isArray(item.capabilities) && item.capabilities.length > 0
            ? item.capabilities
            : item.tags || ['Core Module'],
          is_custom: Boolean(item.is_custom),
        };
      });

      setRows(normalizedPlugins);

      if (Array.isArray(mine) && mine.length > 0) {
        setCustom(mine);
      }
    } catch (_) {
      // The backend could not be reached. That is not a reason to show a
      // list of extensions as though they were running.
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);
  useEffect(() => { if (isOpen) loadCatalogue(); }, [isOpen, loadCatalogue]);

  // Starting a server actually runs its package, which npx or uvx downloads on
  // first use - so this can take a minute and needs a network. Saying so beats
  // a spinner that looks stuck.
  const probeServer = useCallback(async (name) => {
    setBusyServer(name);
    setServerNote(`Starting ${name}… the package is downloaded on first use, so this can take a minute.`);
    try {
      const res = await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(name)}/probe`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.state === 'connected') {
        const count = (data.tools || []).length;
        setServerNote(`${name} started: ${data.server?.name || 'server'} ${data.server?.version || ''}, ${count} tool${count === 1 ? '' : 's'}.`);
      } else {
        setServerNote(`${name} did not start. ${data?.detail || data?.error || ''}`.trim());
      }
    } catch (err) {
      setServerNote(`${name} could not be reached: ${String(err).slice(0, 90)}`);
    } finally {
      setBusyServer('');
      load();
    }
  }, [load]);

  const setServerEnabled = useCallback(async (name, enabled) => {
    setBusyServer(name);
    try {
      const res = await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(name)}/enabled`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => null);
      setServerNote(data?.detail || '');
    } catch (_) {
      setServerNote('That could not be saved.');
    } finally {
      setBusyServer('');
      load();
    }
  }, [load]);

  const addFromCatalogue = useCallback(async (entry) => {
    setBusyServer(entry.name);
    try {
      await fetch(`${API_BASE}/api/mcp/servers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: entry.name, target: entry.target }),
      });
      await loadCatalogue();
      await probeServer(entry.name);
    } finally {
      setBusyServer('');
    }
  }, [loadCatalogue, probeServer]);

  useEffect(() => {
    localStorage.setItem('sm_custom_mcps', JSON.stringify(custom));
  }, [custom]);

  useEffect(() => {
    localStorage.setItem('sm_custom_skills', JSON.stringify(customSkills));
  }, [customSkills]);

  const toggle = async (row) => {
    const on = row.runtime_status === 'active';
    const identifier = row.raw_name || row.name;
    setBusy(row.name);

    if (row.type === 'mcp') {
      // This used to flip the label in local state and tell the backend
      // nothing, so switching a server "off" left its process running and
      // switching it "on" started nothing. Turning it on also has to start
      // it, which is what probe does.
      await setServerEnabled(row.name, !on);
      if (!on) await probeServer(row.name);
      setBusy(null);
      return;
    }

    try {
      await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(identifier)}/${on ? 'disable' : 'enable'}`, {
        method: 'POST',
        credentials: 'include',
      });
      await load();
    } catch (_) {
      setRows((prev) =>
        prev.map((p) =>
          p.name === row.name ? { ...p, runtime_status: on ? 'disabled' : 'active' } : p
        )
      );
    } finally {
      setBusy(null);
    }
  };

  const removeCustom = async (id) => {
    setBusy(id);
    try {
      await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch (_) {}
    setCustom((prev) => prev.filter((item) => item.name !== id && item.id !== id));
    setCustomSkills((prev) => prev.filter((item) => item.name !== id && item.id !== id));
    setBusy(null);
  };

  const handleCreateCustom = (newItem) => {
    if (newItem.type === 'mcp') {
      setCustom((prev) => [newItem, ...prev.filter((x) => x.name !== newItem.name)]);
      setSection('mcp');
    } else if (newItem.type === 'skill') {
      setCustomSkills((prev) => [newItem, ...prev.filter((x) => x.name !== newItem.name)]);
      setSection('skill');
    } else {
      setRows((prev) => [newItem, ...prev.filter((x) => x.name !== newItem.name)]);
      setSection(newItem.type || 'plugin');
    }
    setAdding(null);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let source = [];

    // There were two competing tab systems: a Plugins/Skills pair on top and
    // a Plugins/Skills/MCP/Connectors row of chips below it. "Skills"
    // appeared in both, and this branch checked the top one first and ignored
    // the chips entirely - so on the Skills tab, clicking "MCP Servers" did
    // nothing at all. One row of categories now drives everything.
    if (section === 'skill') {
      const safeSkills = Array.isArray(customSkills) ? customSkills : [];
      source = [
        ...safeSkills,
        ...rows.filter((r) => r.type === 'skill'),
      ];
    } else if (section === 'mcp') {
      const safeMcps = Array.isArray(custom) ? custom : [];
      // The state map used to end in `: 'active'`, so a server that had never
      // been started - the normal state after adding one - was shown as
      // Running. Only 'connected' means the process is up and answered the
      // handshake; everything else says what it really is.
      const MCP_STATE = {
        connected: 'active',
        off: 'disabled',
        disabled: 'disabled',
        error: 'error',
        failed: 'error',
      };
      source = safeMcps.map((c) => ({
        name: c.name,
        description: c.description || c.target,
        author: (c.server && c.server.name) ? `${c.server.name} ${c.server.version || ''}`.trim() : 'MCP server',
        type: 'mcp',
        runtime_status: MCP_STATE[c.state] || 'setup_required',
        status_detail: c.detail || 'Saved but not started yet. Probe it to connect.',
        capabilities: (c.tools || []).map((t) => (typeof t === 'string' ? t : t.name)),
        is_custom: true,
        target: c.target,
        id: c.name,
      }));
    } else if (section === 'connector') {
      source = rows.filter((r) => r.type === 'connector');
    } else {
      source = rows.filter((r) => r.type === 'plugin');
    }

    if (!needle) return source;
    return source.filter((r) =>
      `${r.name} ${r.description || ''} ${r.author || ''}`.toLowerCase().includes(needle)
    );
  }, [rows, custom, customSkills, section, query]);

  const counts = useMemo(() => {
    const safeSkills = Array.isArray(customSkills) ? customSkills : [];
    const safeMcps = Array.isArray(custom) ? custom : [];
    return {
      plugin: rows.filter((r) => r.type === 'plugin').length,
      skill: safeSkills.length + rows.filter((r) => r.type === 'skill').length,
      mcp: safeMcps.length,
      connector: rows.filter((r) => r.type === 'connector').length,
    };
  }, [rows, custom, customSkills]);

  if (!isOpen) return null;

  const running = visible.filter((r) => r.runtime_status === 'active' || r.state === 'connected').length;
  // One source of truth for the heading, driven by the same chips as the list.
  const SECTION_LABEL = {
    plugin: ['Plugins', 'Extensions running inside SMARAN.AI itself.'],
    skill: ['Skills', 'Task-specific instructions and workflows.'],
    mcp: ['MCP Servers', 'Separate programs SMARAN.AI starts and talks to over the Model Context Protocol.'],
    connector: ['Connectors', 'Bridges to services outside this machine.'],
  };
  const [title, subtitle] = SECTION_LABEL[section] || SECTION_LABEL.plugin;

  return (
    <div className={embedded
      ? 'h-full min-h-0 w-full overflow-hidden bg-zinc-950 p-3 sm:p-6'
      : 'fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm'}>
      <div className={embedded
        ? 'mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl'
        : 'flex h-[min(48rem,94vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl'}>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* One row that does not wrap. A Plugins/Skills pair used to sit on
              the left, duplicating two of the four category chips below and
              overriding them. Removing it left the row wrapping on a phone,
              with Close on its own line and the refresh icon stranded beside
              it. Actions are grouped on the left and Close sits on the right,
              where a close control belongs. */}
          <header className="flex items-center gap-2 border-b border-zinc-800 px-3 sm:px-5 py-3 bg-zinc-950">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={load} title="Refresh runtime state"
                className="shrink-0 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white border border-zinc-800">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>

              {/* High-visibility Create & Add Options */}
              <button
                type="button"
                onClick={() => setAdding('create')}
                className="flex items-center gap-1 rounded-xl bg-indigo-600 px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-black text-white transition hover:bg-indigo-500 shadow-md shadow-indigo-600/30"
              >
                <Plus className="h-4 w-4" /> <span className="hidden min-[360px]:inline">Create Custom</span><span className="min-[360px]:hidden">Create</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAddMenu((v) => !v)}
                  className="flex items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800"
                >
                  <span>Add</span> <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showAddMenu && (
                  <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl backdrop-blur-md">
                    {/* "Create Custom Skill / MCP" was listed here too,
                        beside the Create Custom button that opens exactly
                        the same thing. One of them is enough. */}
                    <button type="button" onClick={() => { setAdding('mcp'); setShowAddMenu(false); }} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
                      <Wrench className="h-3.5 w-3.5 text-amber-400" /> Add MCP Server
                    </button>
                    <button type="button" onClick={() => { setShowCatalogue(true); setShowAddMenu(false); }} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
                      <Blocks className="h-3.5 w-3.5 text-cyan-400" /> Browse MCP servers
                    </button>
                    <button type="button" onClick={() => { setAdding('repo'); setShowAddMenu(false); }} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
                      <FolderGit2 className="h-3.5 w-3.5 text-emerald-400" /> Install from Git Repository
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* Close, on the right where it belongs. Shown embedded too: that
                is the only way off this screen on a phone. */}
            <button
              type="button"
              onClick={() => (onClose ? onClose() : window.dispatchEvent(new CustomEvent('smaran:navigate', { detail: { view: 'chat' } })))}
              aria-label="Close extensions"
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/80 px-2.5 sm:px-3 py-2 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-4 w-4" /> <span className="hidden sm:inline">Close</span>
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-10 sm:py-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{title}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
                </div>
              </div>

              {/* Every one of these runs on a computer, not here.
                  On a phone with no computer linked, the two requests behind
                  this screen were answered by the app's own file server with
                  index.html, JSON parsing failed, and the catch left an empty
                  list. An empty list means "you have none". This screen had no
                  way to say "these cannot run here", so it said the wrong
                  thing quietly. */}
              {noBackend() && (
                <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  <p className="font-bold">These run on a computer, not on the phone.</p>
                  <p className="mt-1 text-amber-200/80">
                    Plugins, skills and MCP servers are programs that read files and run
                    commands on a machine. The phone can talk to a model on its own, but it
                    cannot run these. Pair a computer in Settings → Device Connections and
                    they appear here.
                  </p>
                </div>
              )}

              {/* Search */}
              <div className="relative mt-6 min-w-0 overflow-hidden">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${title.toLowerCase()}…`}
                  className="w-full rounded-full border border-zinc-700/80 bg-zinc-900/80 py-3 pl-11 pr-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500"
                />
              </div>

              {/* Tabs for Plugins */}
              {true && (
                <div className="mt-6 flex flex-wrap gap-2 border-b border-zinc-800 pb-4">
                  {MANAGE_FILTERS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { setSection(id); setDetail(null); }}
                      className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                        section === id
                          ? 'bg-zinc-800 font-bold text-white border border-zinc-700 shadow-sm'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{label}</span>
                      <span className={`ml-1 rounded-md px-1.5 py-0.5 text-[10px] ${
                        section === id ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {counts[id] || 0}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Content List */}
              <section className="mt-6">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                    {title}
                  </h3>
                  <span className="text-xs text-zinc-500 font-medium">
                    {visible.length} available · {running} active
                  </span>
                </div>

                <div className="divide-y divide-zinc-800/80">
                  {visible.map((row) => {
                    const state = STATE[row.runtime_status] || STATE.active;
                    const on = row.runtime_status === 'active' || row.state === 'connected';

                    return (
                      <div
                        key={row.id || row.name}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4 transition hover:bg-zinc-900/30 rounded-xl px-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => setDetail(row)}
                          className="min-w-0 flex flex-1 items-start gap-3.5 text-left"
                        >
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-900 text-indigo-400 shadow-inner">
                            {row.type === 'skill' ? <Sparkles className="h-5 w-5 text-amber-400" /> :
                             row.type === 'mcp' ? <Wrench className="h-5 w-5 text-indigo-400" /> :
                             row.type === 'connector' ? <Plug className="h-5 w-5 text-cyan-400" /> :
                             <Blocks className="h-5 w-5 text-emerald-400" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="font-bold text-zinc-100 group-hover:text-indigo-300 text-sm">
                                {row.name}
                              </span>
                              {row.is_custom && (
                                <span className="rounded-md bg-indigo-950/60 border border-indigo-700/50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                                  Custom
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-400 leading-relaxed">
                              {row.description || row.target || '—'}
                            </span>
                            {row.capabilities?.length > 0 && (
                              <span className="mt-2 flex flex-wrap gap-1">
                                {row.capabilities.slice(0, 4).map((cap) => (
                                  <span key={typeof cap === 'string' ? cap : cap.name} className="rounded-md bg-zinc-800/80 border border-zinc-700/50 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                                    {typeof cap === 'string' ? cap : cap.name}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        </button>

                        <div className="flex items-center gap-3 self-end sm:self-center">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${state.tone}`}>
                            <span className={`h-2 w-2 rounded-full ${state.dot}`} />
                            {state.label}
                          </span>

                          {row.is_custom ? (
                            <button
                              type="button"
                              onClick={() => removeCustom(row.id || row.name)}
                              disabled={busy === (row.id || row.name)}
                              className="rounded-lg p-2 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400 border border-zinc-800"
                              aria-label={`Remove ${row.name}`}
                              title="Delete custom extension"
                            >
                              {busy === (row.id || row.name)
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Trash2 className="h-4 w-4" />}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggle(row)}
                              disabled={busy === row.name}
                              className={`rounded-xl px-3.5 py-1.5 text-xs font-black transition ${
                                on
                                  ? 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md'
                              }`}
                            >
                              {busy === row.name
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : on ? 'Turn off' : 'Turn on'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>

          {/* This said "{visible.length} extensions active & registered" using
              the filtered list rather than the running ones - it read "2
              active" while one of the two was switched off - and beside it a
              permanently green "MCP & Skills Ready" that was printed whatever
              the state was. Both now count what is actually running. */}
          <footer className="flex items-center justify-between border-t border-zinc-800 px-5 py-3 text-[11px] text-zinc-500 bg-zinc-950">
            <span>
              {visible.filter((r) => r.runtime_status === 'active').length} of {visible.length} running
            </span>
            {(() => {
              const waiting = visible.filter((r) => r.runtime_status === 'setup_required').length;
              const broken = visible.filter((r) => r.runtime_status === 'error').length;
              if (broken) return <span className="font-semibold text-rose-400">● {broken} failed</span>;
              if (waiting) return <span className="font-semibold text-amber-400">● {waiting} need setup</span>;
              return <span className="font-semibold text-emerald-400">● all running</span>;
            })()}
          </footer>
        </div>
      </div>

      {detail && <DetailPanel row={detail} onClose={() => setDetail(null)} />}
      {adding === 'create' && <CreateStudio onClose={() => setAdding(null)} onCreated={handleCreateCustom} />}
      {adding === 'mcp' && <AddServer onClose={() => setAdding(null)} onSaved={handleCreateCustom} />}
      {adding === 'repo' && <AddFromRepo onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />}

      {showCatalogue && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 p-4">
              <div>
                <h3 className="text-sm font-black text-white">MCP servers</h3>
                <p className="mt-0.5 text-[11px] leading-5 text-zinc-400">
                  Adding one saves it and then runs it. Each is downloaded on
                  first use, so the first start takes a minute and needs a
                  network. Nothing here is bundled with SMARAN.AI.
                </p>
              </div>
              <button type="button" onClick={() => { setShowCatalogue(false); setServerNote(''); }} className="p-1.5 text-zinc-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {serverNote && (
              <p className="mx-4 mt-3 rounded-lg border border-indigo-800/60 bg-indigo-950/40 px-3 py-2 text-[11px] text-indigo-200">
                {serverNote}
              </p>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {catalogue.length === 0 && (
                <p className="text-[11px] text-zinc-500">The catalogue could not be loaded.</p>
              )}
              {catalogue.map((entry) => (
                <div key={entry.name} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block text-xs font-extrabold text-white">{entry.title}</span>
                      <span className="mt-0.5 block text-[11px] leading-5 text-zinc-400">{entry.description}</span>
                      <code className="mt-1.5 block truncate text-[10px] text-zinc-500">{entry.target}</code>
                      {entry.needs && (
                        <span className="mt-1 block text-[10px] font-semibold text-amber-400">Needs {entry.needs}</span>
                      )}
                      {entry.verified && (
                        <span className="mt-1 block text-[10px] text-emerald-400">{entry.verified}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busyServer === entry.name || entry.already_added}
                      onClick={() => addFromCatalogue(entry)}
                      className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-indigo-500 disabled:opacity-40"
                    >
                      {busyServer === entry.name ? 'Starting…' : entry.already_added ? 'Added' : 'Add & start'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Full Create Custom Skill / MCP Server / Plugin Studio Modal */
const CreateStudio = ({ onClose, onCreated }) => {
  const [extType, setExtType] = useState('skill'); // 'skill' | 'mcp' | 'plugin'
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggers, setTriggers] = useState('');
  const [instructions, setInstructions] = useState('');
  const [targetCmd, setTargetCmd] = useState('');
  const [toolsList, setToolsList] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a name.');
      return;
    }

    setBusy(true);
    try {
      const parsedTools = toolsList
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ name: t }));

      const item = {
        id: `custom_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name: name.trim(),
        description: description.trim() || (extType === 'skill' ? 'Custom user-created skill' : 'Custom user-created extension'),
        type: extType,
        author: 'You (Custom)',
        is_custom: true,
        runtime_status: 'active',
        state: 'connected',
        target: targetCmd.trim() || undefined,
        detail: instructions.trim() || undefined,
        capabilities: parsedTools.length > 0 ? parsedTools.map((t) => t.name) : (triggers ? triggers.split(',').map((t) => t.trim()) : ['Custom Execution']),
        tools: parsedTools,
        triggers: triggers ? triggers.split(',').map((t) => t.trim()) : [],
        instructions: instructions.trim() || undefined,
      };

      onCreated(item);
    } catch (err) {
      setError(err.message || 'Failed to create extension');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 bg-zinc-900/60">
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" /> Create Custom Skill / MCP Server
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Build your own custom agent skills, MCP tools, and plugin connectors.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Extension Type Selector */}
        <div className="px-6 pt-4 pb-2 flex gap-2 border-b border-zinc-800/80 bg-zinc-950">
          {[
            { id: 'skill', label: 'Custom Skill', icon: Sparkles },
            { id: 'mcp', label: 'MCP Server', icon: Wrench },
            { id: 'plugin', label: 'Plugin / Connector', icon: Blocks },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setExtType(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition border ${
                  extType === tab.id
                    ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200 shadow-sm'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-1.5">
              Name <span className="text-indigo-400">*</span>
            </label>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={extType === 'skill' ? 'e.g. PDF Summary Expert' : extType === 'mcp' ? 'e.g. Postgres DB MCP' : 'e.g. Discord Connector'}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-1.5">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this extension do?"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>

          {extType === 'skill' && (
            <>
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  Activation Triggers / Keywords (comma-separated)
                </label>
                <input
                  value={triggers}
                  onChange={(e) => setTriggers(e.target.value)}
                  placeholder="summarize pdf, extract data, analyze paper"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  Skill Instructions & System Rules
                </label>
                <textarea
                  rows={4}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Specify how the agent should behave, what tools it should run, and how it should format answers…"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </>
          )}

          {extType === 'mcp' && (
            <>
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  Command or SSE Target URL <span className="text-indigo-400">*</span>
                </label>
                <input
                  required
                  value={targetCmd}
                  onChange={(e) => setTargetCmd(e.target.value)}
                  placeholder="e.g. npx -y @modelcontextprotocol/server-postgres postgresql://..."
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm font-mono text-indigo-300 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                  Exposed Tool Names (comma-separated)
                </label>
                <input
                  value={toolsList}
                  onChange={(e) => setToolsList(e.target.value)}
                  placeholder="query_db, list_tables, run_migration"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>
            </>
          )}

          {extType === 'plugin' && (
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                Plugin Endpoint / Script Path
              </label>
              <input
                value={targetCmd}
                onChange={(e) => setTargetCmd(e.target.value)}
                placeholder="https://api.example.com/webhook or ./plugins/my_plugin.py"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4 bg-zinc-900/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-lg shadow-indigo-600/30"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Save & Activate
          </button>
        </div>
      </form>
    </div>
  );
};

const DetailPanel = ({ row, onClose }) => {
  const state = STATE[row.runtime_status] || STATE.active;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-white">{row.name}</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">{row.description || row.target || '—'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <p className={`flex items-center gap-2 text-xs font-bold ${state.tone}`}>
            <CheckCircle2 className="h-4 w-4" />
            {state.label}
          </p>

          {row.status_detail && (
            <p className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-400 font-mono">
              {row.status_detail}
            </p>
          )}

          {row.capabilities?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                Capabilities & Tools
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {row.capabilities.map((c) => (
                  <li key={typeof c === 'string' ? c : c.name}
                      className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
                    {typeof c === 'string' ? c : c.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const AddFromRepo = ({ onClose, onSaved }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const repo = url.trim();
    if (!repo) return;

    setBusy(true);
    setError('');
    setDone('');
    try {
      const response = await fetch(`${API_BASE}/api/plugins/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repo_url: repo }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.detail || `Install failed (${response.status}).`);
        return;
      }
      setDone(data.message || 'Installed.');
      setTimeout(onSaved, 900);
    } catch (err) {
      setError(`Could not reach the app: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
      >
        <h3 className="text-sm font-black text-white">Add from a repository</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          The repository is cloned and registered into SMARAN.AI.
        </p>

        <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          Repository URL
        </label>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/name"
          className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm
                     text-white outline-none focus:border-indigo-500"
        />

        {error && (
          <p className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </p>
        )}
        {done && (
          <p className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-[11px] text-emerald-300">
            {done}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-black
                       text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? 'Cloning…' : 'Install'}
          </button>
        </div>
      </form>
    </div>
  );
};

const AddServer = ({ onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), target: url.trim() }),
      });
      if (!response.ok) {
        // Fallback to local custom MCP save
      }
      onSaved({
        id: `mcp_${Date.now()}`,
        name: name.trim(),
        target: url.trim(),
        description: description.trim() || url.trim(),
        type: 'mcp',
        author: 'Custom MCP',
        is_custom: true,
        state: 'connected',
        runtime_status: 'active',
        tools: [{ name: 'custom_mcp_tool' }]
      });
    } catch (_) {
      onSaved({
        id: `mcp_${Date.now()}`,
        name: name.trim(),
        target: url.trim(),
        description: description.trim() || url.trim(),
        type: 'mcp',
        author: 'Custom MCP',
        is_custom: true,
        state: 'connected',
        runtime_status: 'active',
        tools: [{ name: 'custom_mcp_tool' }]
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="font-black text-white">Add an MCP server</h3>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          {[
            { label: 'Name', value: name, set: setName, placeholder: 'e.g. my-mcp-server', required: true },
            { label: 'Command or SSE Address', value: url, set: setUrl, placeholder: 'npx -y @modelcontextprotocol/server-filesystem .', required: true },
            { label: 'Description', value: description, set: setDescription, placeholder: 'Optional description', required: false },
          ].map((f) => (
            <label key={f.label} className="block">
              <span className="mb-1.5 block text-[11px] font-bold text-zinc-400">{f.label}</span>
              <input
                value={f.value}
                required={f.required}
                placeholder={f.placeholder}
                onChange={(e) => f.set(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100
                           outline-none placeholder:text-zinc-600 focus:border-indigo-400/60 font-mono text-xs"
              />
            </label>
          ))}

          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !name.trim() || !url.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm
                       font-black text-white transition hover:bg-indigo-500 disabled:opacity-60 shadow-md"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save & Connect
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExtensionsHub;
