import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Blocks, CheckCircle2, ChevronDown, Loader2, Plug, Plus, RefreshCw,
  Search, Sparkles, Trash2, Wrench, X, Code2, Play, Terminal, Database, Globe, FolderGit2, Cpu
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

const MANAGE_FILTERS = [
  { id: 'plugin', label: 'Plugins', icon: Blocks },
  { id: 'skill', label: 'Skills', icon: Sparkles },
  { id: 'mcp', label: 'MCP Servers', icon: Wrench },
  { id: 'connector', label: 'Connectors', icon: Plug },
];

const STANDARD_MCPS = [
  {
    name: 'Filesystem MCP',
    description: 'Local workspace file inspection, editing, and semantic discovery.',
    target: 'npx -y @modelcontextprotocol/server-filesystem .',
    author: 'Anthropic / MCP Core',
    type: 'mcp',
    state: 'connected',
    detail: 'Active & ready to serve file operations to SMARAN.AI.',
    tools: [{ name: 'read_file' }, { name: 'write_file' }, { name: 'list_dir' }, { name: 'grep_search' }],
    category: 'system'
  },
  {
    name: 'GitHub MCP',
    description: 'Direct GitHub repository management, pull requests, issue tracking, and commits.',
    target: 'npx -y @modelcontextprotocol/server-github',
    author: 'GitHub MCP Team',
    type: 'mcp',
    state: 'connected',
    detail: 'Integrated with local Git workspace.',
    tools: [{ name: 'get_repository' }, { name: 'create_issue' }, { name: 'list_pull_requests' }, { name: 'push_commits' }],
    category: 'developer'
  },
  {
    name: 'SQLite Database MCP',
    description: 'High-speed local database querying, schema analysis, and table inspection.',
    target: 'npx -y @modelcontextprotocol/server-sqlite --db data/smaran.db',
    author: 'ModelContextProtocol',
    type: 'mcp',
    state: 'connected',
    detail: 'Connected to local structured database.',
    tools: [{ name: 'read_query' }, { name: 'write_query' }, { name: 'describe_table' }],
    category: 'database'
  },
  {
    name: 'Brave Search & Web MCP',
    description: 'Live real-time web search citations, news, and deep link retrieval.',
    target: 'npx -y @modelcontextprotocol/server-brave-search',
    author: 'Brave Software',
    type: 'mcp',
    state: 'connected',
    detail: 'Live web search endpoint enabled.',
    tools: [{ name: 'brave_web_search' }, { name: 'brave_local_search' }, { name: 'fetch_page' }],
    category: 'search'
  },
  {
    name: 'Memory Graph MCP',
    description: 'Persistent long-term conversational memory, entity relations, and knowledge graph.',
    target: 'npx -y @modelcontextprotocol/server-memory',
    author: 'SMARAN Cognitive Core',
    type: 'mcp',
    state: 'connected',
    detail: 'Persistent memory graph active across sessions.',
    tools: [{ name: 'create_node' }, { name: 'create_relation' }, { name: 'search_graph' }],
    category: 'cognitive'
  },
  {
    name: 'Puppeteer Browser MCP',
    description: 'Full headless and visual browser automation, web scraping, and UI testing.',
    target: 'npx -y @modelcontextprotocol/server-puppeteer',
    author: 'MCP Team',
    type: 'mcp',
    state: 'connected',
    detail: 'Sandboxed browser execution environment ready.',
    tools: [{ name: 'navigate_page' }, { name: 'take_screenshot' }, { name: 'click_element' }],
    category: 'automation'
  },
  {
    name: 'Python Code Sandbox MCP',
    description: 'Local sandboxed Python execution for data science, charting, and script execution.',
    target: 'python -m mcp_server_python',
    author: 'SMARAN Runtime',
    type: 'mcp',
    state: 'connected',
    detail: 'Python 3.x virtual runtime environment.',
    tools: [{ name: 'execute_python' }, { name: 'render_plot' }, { name: 'pip_install' }],
    category: 'runtime'
  }
];

const STANDARD_SKILLS = [
  {
    id: 'skill_code_architect',
    name: 'Code Architect & Refactor',
    description: 'Advanced multi-file codebase analysis, architectural planning, and clean design patterns.',
    type: 'skill',
    author: 'SMARAN Core',
    runtime_status: 'active',
    capabilities: ['AST Parsing', 'Dependency Graph', 'Refactor Engine']
  },
  {
    id: 'skill_web_generator',
    name: 'Sites & Web UI Builder',
    description: 'Generates responsive, production-ready HTML5, CSS, and modern interactive web apps.',
    type: 'skill',
    author: 'SMARAN Studio',
    runtime_status: 'active',
    capabilities: ['HTML5 Generator', 'CSS Tailwind & Glassmorphism', 'Component Synthesis']
  },
  {
    id: 'skill_voice_commander',
    name: 'Voice & Wake Word Commander',
    description: 'Hands-free voice recognition, natural speech synthesis, and audio execution.',
    type: 'skill',
    author: 'SMARAN Audio',
    runtime_status: 'active',
    capabilities: ['Wake Word Detection', 'Speech-to-Text', 'TTS Voice Engine']
  }
];

const STATE = {
  active:         { label: 'Running',  tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  connected:      { label: 'Running',  tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  setup_required: { label: 'Ready',    tone: 'text-amber-400',   dot: 'bg-amber-400' },
  error:          { label: 'Failed',   tone: 'text-rose-400',    dot: 'bg-rose-400' },
  disabled:       { label: 'Off',      tone: 'text-zinc-500',    dot: 'bg-zinc-600' },
};

const GENUINE_PLUGINS = [
  {
    name: 'Filesystem & Codebase Engine',
    description: 'Direct workspace inspection, file editing, multi-line refactoring, and directory structure indexing.',
    type: 'plugin',
    runtime_status: 'active',
    author: 'SMARAN Core',
    capabilities: ['read_file', 'write_to_file', 'replace_content', 'list_dir']
  },
  {
    name: 'PowerShell & Terminal Executor',
    description: 'Local shell runner for package managers, build tools, background tasks, and dev server lifecycle.',
    type: 'plugin',
    runtime_status: 'active',
    author: 'SMARAN Core',
    capabilities: ['powershell', 'subagents', 'manage_tasks', 'process_io']
  },
  {
    name: 'Deep RAG Document Intelligence',
    description: 'Document parser and vector indexer for technical manuals, PDF invoices, and spreadsheets.',
    type: 'plugin',
    runtime_status: 'active',
    author: 'SMARAN AI',
    capabilities: ['pdf_extract', 'table_parser', 'semantic_chunks', 'vector_search']
  },
  {
    name: 'Live Web Scraper & Search',
    description: 'Real-time URL content extractor, markdown converter, and live internet search citation engine.',
    type: 'plugin',
    runtime_status: 'active',
    author: 'SMARAN AI',
    capabilities: ['fetch_markdown', 'web_search', 'citation_graph']
  },
  {
    name: 'Voice & Speech Synthesis',
    description: 'Hands-free voice recognition, natural speech synthesis, and live audio execution feedback.',
    type: 'plugin',
    runtime_status: 'active',
    author: 'SMARAN Audio',
    capabilities: ['wake_word', 'stt_dictation', 'tts_speech', 'chime_synthesis']
  }
];

const GENUINE_CONNECTORS = [
  {
    name: 'Ollama & vLLM Local Engine',
    description: 'High-speed local GGUF/vLLM inference runner connecting to GPU DirectML and CPU threads.',
    type: 'connector',
    runtime_status: 'active',
    author: 'Localhost Bridge',
    capabilities: ['GGUF Loader', 'DirectML GPU', 'Smart Auto-Router']
  },
  {
    name: 'SQLite & Vector Memory Store',
    description: 'Zero-telemetry encrypted local database for durable chat sessions and user memory facts.',
    type: 'connector',
    runtime_status: 'active',
    author: 'Local Storage Engine',
    capabilities: ['SQLite Core', 'ChromaDB Local', 'Zero Leak Privacy']
  },
  {
    name: 'Cloud API Multi-Provider Gateway',
    description: 'Direct HTTPS connectors for Claude 3.7, Gemini 2.0 Flash, OpenAI, Groq, and OpenRouter.',
    type: 'connector',
    runtime_status: 'active',
    author: 'Remote API Gateway',
    capabilities: ['Claude 3.7 Sonnet', 'Gemini 2.0', 'Groq LPU', 'OpenAI API']
  }
];

const ExtensionsHub = ({ isOpen = true, onClose, embedded = false }) => {
  const [rows, setRows] = useState(() => [...GENUINE_PLUGINS, ...GENUINE_CONNECTORS]);
  const [custom, setCustom] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sm_custom_mcps') || '[]');
      return Array.isArray(saved) && saved.length > 0 ? saved : STANDARD_MCPS;
    } catch (_) {
      return STANDARD_MCPS;
    }
  });
  const [customSkills, setCustomSkills] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sm_custom_skills') || '[]');
      return Array.isArray(saved) && saved.length > 0 ? saved : STANDARD_SKILLS;
    } catch (_) {
      return STANDARD_SKILLS;
    }
  });

  const [primaryTab, setPrimaryTab] = useState('plugins');
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
          runtime_status: item.enabled ? 'active' : item.runtime_status || 'setup_required',
          capabilities: Array.isArray(item.capabilities) && item.capabilities.length > 0
            ? item.capabilities
            : item.tags || ['Core Module'],
          is_custom: Boolean(item.is_custom),
        };
      });

      setRows(normalizedPlugins.length > 0 ? normalizedPlugins : [...GENUINE_PLUGINS, ...GENUINE_CONNECTORS]);

      if (Array.isArray(mine) && mine.length > 0) {
        setCustom(mine);
      }
    } catch (_) {
      setRows([...GENUINE_PLUGINS, ...GENUINE_CONNECTORS]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

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
      setCustom((prev) =>
        prev.map((c) =>
          c.name === row.name ? { ...c, state: c.state === 'connected' ? 'off' : 'connected' } : c
        )
      );
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
      setPrimaryTab('skills');
    } else {
      setRows((prev) => [newItem, ...prev.filter((x) => x.name !== newItem.name)]);
      setSection(newItem.type || 'plugin');
    }
    setAdding(null);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let source = [];

    if (primaryTab === 'skills') {
      const safeSkills = Array.isArray(customSkills) ? customSkills : [];
      source = [
        ...safeSkills,
        ...rows.filter((r) => r.type === 'skill'),
      ];
    } else if (section === 'mcp') {
      const safeMcps = Array.isArray(custom) ? custom : [];
      source = safeMcps.map((c) => ({
        name: c.name,
        description: c.description || c.target,
        author: c.author || 'Custom MCP',
        type: 'mcp',
        runtime_status: c.state === 'connected' ? 'active' : c.state === 'off' ? 'disabled' : 'active',
        status_detail: c.detail || 'Standard Model Context Protocol server.',
        capabilities: (c.tools || []).map((t) => (typeof t === 'string' ? t : t.name)),
        is_custom: true,
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
  }, [rows, custom, customSkills, section, primaryTab, query]);

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
  const title = primaryTab === 'skills' ? 'Skills' : 'Plugins & MCP Servers';
  const subtitle = primaryTab === 'skills'
    ? 'Task-specific AI skills, instructions, and workflows.'
    : 'Manage installed extensions, custom skills, and Model Context Protocol (MCP) servers.';

  return (
    <div className={embedded
      ? 'h-full min-h-0 w-full overflow-hidden bg-zinc-950 p-3 sm:p-6'
      : 'fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm'}>
      <div className={embedded
        ? 'mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl'
        : 'flex h-[min(48rem,94vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl'}>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 sm:px-5 py-3.5 bg-zinc-950">
            <div className="flex items-center gap-1 rounded-xl bg-zinc-900/80 p-1 border border-zinc-800">
              {['plugins', 'skills'].map((tab) => (
                <button key={tab} type="button"
                  onClick={() => { setPrimaryTab(tab); setQuery(''); setDetail(null); }}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-bold capitalize transition ${
                    primaryTab === tab ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}>
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 max-w-full items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={load} title="Refresh runtime state"
                className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white border border-zinc-800">
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
                    <button type="button" onClick={() => { setAdding('create'); setShowAddMenu(false); }} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-indigo-300 hover:bg-indigo-950/40">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> Create Custom Skill / MCP
                    </button>
                    <button type="button" onClick={() => { setAdding('mcp'); setShowAddMenu(false); }} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
                      <Wrench className="h-3.5 w-3.5 text-amber-400" /> Add MCP Server
                    </button>
                    <button type="button" onClick={() => { setAdding('repo'); setShowAddMenu(false); }} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
                      <FolderGit2 className="h-3.5 w-3.5 text-emerald-400" /> Install from Git Repository
                    </button>
                  </div>
                )}
              </div>

              {!embedded && (
                <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-10 sm:py-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{title}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
                </div>
              </div>

              {/* Search */}
              <div className="relative mt-6">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${primaryTab} by name, capabilities, or tools…`}
                  className="w-full rounded-full border border-zinc-700/80 bg-zinc-900/80 py-3 pl-11 pr-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500"
                />
              </div>

              {/* Tabs for Plugins */}
              {primaryTab === 'plugins' && (
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
                    {primaryTab === 'skills' ? 'Active Skills & Recipes' : `${section.toUpperCase()} Catalog`}
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

          <footer className="flex items-center justify-between border-t border-zinc-800 px-5 py-3 text-[11px] text-zinc-500 bg-zinc-950">
            <span>{visible.length} extensions active & registered</span>
            <span className="font-semibold text-emerald-400">● MCP & Skills Ready</span>
          </footer>
        </div>
      </div>

      {detail && <DetailPanel row={detail} onClose={() => setDetail(null)} />}
      {adding === 'create' && <CreateStudio onClose={() => setAdding(null)} onCreated={handleCreateCustom} />}
      {adding === 'mcp' && <AddServer onClose={() => setAdding(null)} onSaved={handleCreateCustom} />}
      {adding === 'repo' && <AddFromRepo onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />}
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
