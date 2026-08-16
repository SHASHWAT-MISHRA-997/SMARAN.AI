import React, { useState, useEffect } from 'react';
import { 
  Puzzle, Zap, Cpu, Shield, Database, Sparkles, Sliders, ExternalLink, 
  CheckCircle2, XCircle, Search, RefreshCw, Layers, Terminal, Globe, 
  Flame, Key, Play, Eye, Settings, X, Check, ArrowUpRight, Plus, Trash2, Link
} from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

const PLUGIN_DETAILS = {
  'omni-route': {
    repoUrl: 'https://github.com/diegosouzapw/OmniRoute.git',
    badge: '19 Routing Strategies',
    category: 'plugin',
    docs: 'https://github.com/diegosouzapw/OmniRoute',
    color: 'from-amber-500/20 to-orange-500/10 border-amber-500/30 text-amber-400'
  },
  'headroom': {
    repoUrl: 'https://github.com/headroomlabs-ai/headroom.git',
    badge: '60-90% Compression',
    category: 'plugin',
    docs: 'https://github.com/headroomlabs-ai/headroom',
    color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30 text-emerald-400'
  },
  'claude-mem': {
    repoUrl: 'https://github.com/thedotmack/claude-mem.git',
    badge: 'Infinite Memory',
    category: 'plugin',
    docs: 'https://github.com/thedotmack/claude-mem',
    color: 'from-purple-500/20 to-indigo-500/10 border-purple-500/30 text-purple-400'
  },
  'task-observer': {
    repoUrl: 'https://github.com/rebelytics/one-skill-to-rule-them-all.git',
    badge: 'Skill Synthesizer',
    category: 'skill',
    docs: 'https://github.com/rebelytics/one-skill-to-rule-them-all',
    color: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/30 text-cyan-400'
  },
  'ui-ux-pro-max': {
    repoUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git',
    badge: 'Design System Intelligence',
    category: 'skill',
    docs: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    color: 'from-pink-500/20 to-rose-500/10 border-pink-500/30 text-pink-400'
  },
  'strix-security': {
    repoUrl: 'https://github.com/usestrix/strix.git',
    badge: 'Autonomous Pentest',
    category: 'connector',
    docs: 'https://github.com/usestrix/strix',
    color: 'from-red-500/20 to-orange-500/10 border-red-500/30 text-red-400'
  },
  'google-agents-cli': {
    repoUrl: 'https://github.com/google/agents-cli.git',
    badge: 'Google ADK Engine',
    category: 'connector',
    docs: 'https://github.com/google/agents-cli',
    color: 'from-blue-500/20 to-indigo-500/10 border-blue-500/30 text-blue-400'
  },
  'mcp-21st-dev': {
    repoUrl: 'https://21st.dev/',
    badge: 'MCP Protocol Server',
    category: 'connector',
    docs: 'https://21st.dev/',
    color: 'from-violet-500/20 to-purple-500/10 border-violet-500/30 text-violet-400'
  },
  'paperclip': {
    repoUrl: 'https://github.com/shashwatmishra997/SMARAN.AI',
    badge: 'Built-in Tool',
    category: 'plugin',
    docs: '#',
    color: 'from-zinc-500/20 to-slate-500/10 border-zinc-500/30 text-zinc-400'
  },
  'three-d-website': {
    repoUrl: 'https://github.com/shashwatmishra997/SMARAN.AI',
    badge: 'WebGL Visualizer',
    category: 'skill',
    docs: '#',
    color: 'from-yellow-500/20 to-amber-500/10 border-yellow-500/30 text-yellow-400'
  },
  'reverse-skill': {
    repoUrl: 'https://github.com/shashwatmishra997/SMARAN.AI',
    badge: 'Text Utility',
    category: 'skill',
    docs: '#',
    color: 'from-slate-500/20 to-zinc-500/10 border-slate-500/30 text-slate-400'
  },
  // Aliases for backend-registered names
  'ui-ux-pro-max-skill': {
    repoUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git',
    badge: 'Design System Intelligence',
    category: 'skill',
    docs: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    color: 'from-pink-500/20 to-rose-500/10 border-pink-500/30 text-pink-400'
  },
  '3d-website': {
    repoUrl: 'https://github.com/shashwatmishra997/SMARAN.AI',
    badge: 'WebGL Visualizer',
    category: 'skill',
    docs: '#',
    color: 'from-yellow-500/20 to-amber-500/10 border-yellow-500/30 text-yellow-400'
  }
};

export default function PluginHubModal({ isOpen, onClose }) {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testInput, setTestInput] = useState('');

  // Custom Extension State
  const [isAddCustomOpen, setIsAddCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customType, setCustomType] = useState('connector'); // 'plugin' | 'skill' | 'connector' | 'mcp'
  const [customUrl, setCustomUrl] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customTestStatus, setCustomTestStatus] = useState(null);
  const [customTesting, setCustomTesting] = useState(false);
  const [customSaving, setCustomSaving] = useState(false);

  const fetchPlugins = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/plugins`);
      if (res.ok) {
        const data = await res.json();
        let list = [];
        if (Array.isArray(data)) {
          list = data;
        } else if (data && typeof data === 'object') {
          if (Array.isArray(data.plugins)) {
            list = data.plugins;
          } else if (data.plugins && typeof data.plugins === 'object') {
            list = Object.entries(data.plugins).map(([k, v]) => ({
              id: k,
              name: v.name || k,
              description: v.description || '',
              type: v.type || 'plugin',
              enabled: v.enabled !== false,
              version: v.version || '1.0.0',
              author: v.author || 'SMARAN.AI Team',
              website: v.website || '',
              is_custom: !!v.is_custom,
              ...v
            }));
          } else {
            list = Object.entries(data).map(([k, v]) => ({
              id: k,
              name: typeof v === 'object' && v.name ? v.name : k,
              description: typeof v === 'object' && v.description ? v.description : '',
              type: typeof v === 'object' && v.type ? v.type : 'plugin',
              enabled: typeof v === 'object' && v.enabled !== false,
              is_custom: typeof v === 'object' && !!v.is_custom,
              ...(typeof v === 'object' ? v : {})
            }));
          }
        }
        setPlugins(list);
      }
    } catch (e) {
      console.error('Failed to fetch plugins:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPlugins();
    }
  }, [isOpen]);

  const togglePlugin = async (id, currentEnabled) => {
    try {
      const endpoint = currentEnabled ? 'disable' : 'enable';
      const res = await fetchWithAuth(`${API_BASE}/api/plugins/${id}/${endpoint}`, {
        method: 'POST'
      });
      if (res.ok) {
        setPlugins(prev => (Array.isArray(prev) ? prev : []).map(p => p.id === id ? { ...p, enabled: !currentEnabled } : p));
      }
    } catch (e) {
      console.error('Failed to toggle plugin:', e);
    }
  };

  const handleTestCustom = async () => {
    if (!customUrl.trim()) return;
    setCustomTesting(true);
    setCustomTestStatus(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/plugins/custom/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: customType, url: customUrl.trim() })
      });
      const data = await res.json();
      setCustomTestStatus(data);
    } catch (e) {
      setCustomTestStatus({ success: false, error: e.message });
    } finally {
      setCustomTesting(false);
    }
  };

  const handleSaveCustom = async (e) => {
    e.preventDefault();
    if (!customName.trim() || !customUrl.trim()) return;
    setCustomSaving(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/plugins/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customName.trim(),
          type: customType,
          url: customUrl.trim(),
          description: customDesc.trim()
        })
      });
      if (res.ok) {
        const newItem = await res.json();
        setPlugins(prev => [newItem, ...(Array.isArray(prev) ? prev : [])]);
        setIsAddCustomOpen(false);
        setCustomName('');
        setCustomUrl('');
        setCustomDesc('');
        setCustomTestStatus(null);
      }
    } catch (e) {
      console.error('Failed to save custom extension:', e);
    } finally {
      setCustomSaving(false);
    }
  };

  const handleDeleteCustom = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Are you sure you want to remove this custom extension?')) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/plugins/custom/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setPlugins(prev => (Array.isArray(prev) ? prev : []).filter(p => p.id !== id));
        if (selectedPlugin?.id === id) setSelectedPlugin(null);
      }
    } catch (e) {
      console.error('Failed to delete custom extension:', e);
    }
  };

  const handleTestPlugin = async () => {
    if (!selectedPlugin) return;
    setTesting(true);
    setTestResult(null);
    try {
      let endpoint = `${API_BASE}/api/plugins/${selectedPlugin.id}/test`;
      let body = {};
      
      if (selectedPlugin.type === 'skill') {
        endpoint = `${API_BASE}/api/plugins/${selectedPlugin.id}/transform`;
        body = { text: testInput || 'Optimize UI architecture and generate clean, accessible dashboard.' };
      } else if (selectedPlugin.type === 'connector' || selectedPlugin.type === 'mcp') {
        endpoint = `${API_BASE}/api/plugins/${selectedPlugin.id}/execute`;
        body = { operation: 'status', query: testInput || 'test component' };
      } else {
        body = { text: testInput || 'Test query for compression and intelligent routing' };
      }

      const res = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ error: e.message || 'Execution failed' });
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  const pluginList = Array.isArray(plugins) ? plugins : [];

  // Single source of truth for a plugin's category
  const resolveCategory = (p) => {
    const pId = p.id || p.name || '';
    const detail = PLUGIN_DETAILS[pId] || {};
    // PLUGIN_DETAILS category is authoritative for built-in plugins
    if (detail.category) return detail.category;
    // For custom plugins or unknowns, use p.type directly; map "tool" → "plugin"
    const raw = (p.type || 'plugin').toLowerCase();
    if (raw === 'tool') return 'plugin';
    if (raw === 'mcp') return 'connector';
    return raw;
  };

  const countByCategory = (cat) => pluginList.filter(p => resolveCategory(p) === cat).length;

  const filteredPlugins = pluginList.filter(p => {
    if (!p) return false;
    const pId = p.id || p.name || '';
    const pName = p.name || p.id || '';
    const pDesc = p.description || '';

    const category = resolveCategory(p);
    const matchesTab =
      filterTab === 'all' ? true :
      filterTab === 'plugins' ? category === 'plugin' :
      filterTab === 'skills' ? category === 'skill' :
      filterTab === 'connectors' ? (category === 'connector' || category === 'mcp') : true;

    const matchesSearch =
      pName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pDesc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pId.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesTab && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-5xl h-[85vh] bg-[#121216]/95 border border-zinc-700/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                SMARAN.AI Hub
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Skills, Plugins, Connectors & Model Context Protocol (MCP) integrations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsAddCustomOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-black text-xs font-black shadow-md shadow-amber-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Custom Extension / MCP</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Tabs & Search */}
        <div className="px-6 py-3 border-b border-zinc-800/80 bg-zinc-900/30 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-1 bg-zinc-950/60 p-1 rounded-xl border border-zinc-800">
            {[
              { id: 'all', label: 'All Items', icon: Layers, count: pluginList.length },
              { id: 'plugins', label: 'Plugins', icon: Puzzle, count: countByCategory('plugin') },
              { id: 'skills', label: 'Skills', icon: Sparkles, count: countByCategory('skill') },
              { id: 'connectors', label: 'Connectors & MCP', icon: Globe, count: countByCategory('connector') }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterTab(tab.id)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filterTab === tab.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search plugins, skills, MCP..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 pl-9 pr-3 py-2 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Grid */}
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
            {loading ? (
              <div className="col-span-2 flex flex-col items-center justify-center h-64 text-zinc-500">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
                <p className="text-sm">Loading plugins & skills registry...</p>
              </div>
            ) : filteredPlugins.length === 0 ? (
              <div className="col-span-2 flex flex-col items-center justify-center h-64 text-zinc-500">
                <Layers className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">No items found matching "{searchQuery}"</p>
              </div>
            ) : (
              filteredPlugins.map(plugin => {
                const detail = PLUGIN_DETAILS[plugin.id] || {};
                const isSelected = selectedPlugin?.id === plugin.id;
                const category = resolveCategory(plugin);
                return (
                  <div
                    key={plugin.id}
                    onClick={() => { setSelectedPlugin(plugin); setTestResult(null); }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected 
                        ? 'bg-zinc-850/80 border-indigo-500/80 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50' 
                        : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900/70 hover:border-zinc-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2.5">
                          <div className={`p-2 rounded-lg border bg-gradient-to-br ${detail.color || 'from-zinc-500/20 to-zinc-700/10 border-zinc-700 text-zinc-300'}`}>
                            {category === 'connector' ? <Globe className="w-4 h-4" /> :
                             category === 'skill' ? <Sparkles className="w-4 h-4" /> :
                             <Puzzle className="w-4 h-4" />}
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                              {plugin.name}
                              {plugin.enabled && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              )}
                            </h3>
                            <span className="text-[10px] text-zinc-400 capitalize">
                              v{plugin.version} • {category}
                            </span>
                          </div>
                        </div>

                        {/* Toggle switch */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePlugin(plugin.id, plugin.enabled);
                          }}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            plugin.enabled ? 'bg-indigo-600' : 'bg-zinc-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              plugin.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <p className="text-xs text-zinc-400 mt-2.5 line-clamp-2 leading-relaxed">
                        {plugin.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-md font-medium ${
                          plugin.is_custom 
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                            : 'bg-zinc-800 text-zinc-300'
                        }`}>
                          {plugin.is_custom ? 'Custom Extension' : (detail.badge || 'Ready')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {plugin.is_custom && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteCustom(plugin.id, e)}
                            title="Delete custom extension"
                            className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(detail.repoUrl || plugin.website) && (
                          <a
                            href={detail.repoUrl || plugin.website}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
                          >
                            <span>Source</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Inspection & Test Drawer */}
          {selectedPlugin && (
            <div className="w-96 border-l border-zinc-800 bg-zinc-950/60 p-5 flex flex-col justify-between overflow-y-auto">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    Plugin Inspector
                  </h4>
                  <button
                    onClick={() => setSelectedPlugin(null)}
                    className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-semibold">Plugin Name</label>
                    <p className="text-sm text-zinc-200 font-medium">{selectedPlugin.name}</p>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-semibold">Identifier</label>
                    <p className="text-xs font-mono text-zinc-400">{selectedPlugin.id}</p>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-semibold">Category</label>
                    <p className="text-xs capitalize text-zinc-300">{selectedPlugin.type}</p>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-semibold">Description</label>
                    <p className="text-xs text-zinc-400 leading-relaxed">{selectedPlugin.description}</p>
                  </div>

                  {(PLUGIN_DETAILS[selectedPlugin.id]?.repoUrl || selectedPlugin.website) && (
                    <div>
                      <label className="text-[11px] text-zinc-500 uppercase font-semibold">Repository / Target</label>
                      <a 
                        href={PLUGIN_DETAILS[selectedPlugin.id]?.repoUrl || selectedPlugin.website}
                        target="_blank" 
                        rel="noreferrer"
                        className="text-xs text-indigo-400 hover:underline flex items-center gap-1 mt-0.5 break-all"
                      >
                        {PLUGIN_DETAILS[selectedPlugin.id]?.repoUrl || selectedPlugin.website}
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </div>
                  )}

                  {/* Interactive Test Panel */}
                  <div className="mt-4 pt-3 border-t border-zinc-800">
                    <label className="text-[11px] text-zinc-400 font-semibold flex items-center justify-between mb-1.5">
                      <span>Test / Execute Plugin</span>
                      <span className="text-[10px] text-zinc-500">Live API</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Input query or operation parameter..."
                      value={testInput}
                      onChange={e => setTestInput(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />

                    <button
                      onClick={handleTestPlugin}
                      disabled={testing}
                      className="w-full mt-2.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                    >
                      {testing ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Executing...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Run Diagnostic Test</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Output Response */}
                  {testResult && (
                    <div className="mt-3 p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-300 max-h-48 overflow-y-auto">
                      <div className="text-[10px] text-emerald-400 font-semibold mb-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Live Output
                      </div>
                      <pre className="text-[11px] whitespace-pre-wrap">
                        {JSON.stringify(testResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800">
                <button
                  onClick={() => togglePlugin(selectedPlugin.id, selectedPlugin.enabled)}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    selectedPlugin.enabled 
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                  }`}
                >
                  {selectedPlugin.enabled ? (
                    <>
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Disable Plugin</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Enable Plugin</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 bg-zinc-950 border-t border-zinc-800 text-xs text-zinc-500 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span>All skills & plugins sandboxed with IDOR & Zero-Leakage protection</span>
          </div>
          <div className="text-zinc-400 font-mono text-[11px]">
            SMARAN.AI v2.4.0
          </div>
        </div>

      </div>

      {/* Custom Extension Creator Modal Overlay */}
      {isAddCustomOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-lg bg-[#14151e] border border-zinc-700/80 rounded-2xl p-6 shadow-2xl text-zinc-100 font-sans">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Add Custom Plugin, Skill, or MCP Server</h3>
              </div>
              <button
                onClick={() => { setIsAddCustomOpen(false); setCustomTestStatus(null); }}
                className="text-zinc-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustom} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">Extension Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Custom Financial Analyzer"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">Extension Category *</label>
                <select
                  value={customType}
                  onChange={e => setCustomType(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="connector">Connector / MCP Server (Model Context Protocol)</option>
                  <option value="plugin">Plugin (API Tool / Router / Optimizer)</option>
                  <option value="skill">Skill (Synthesizer / Prompt Engine)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">Target Repository / MCP URL / Command *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="https://github.com/... or http://localhost:8080/sse"
                    value={customUrl}
                    onChange={e => setCustomUrl(e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleTestCustom}
                    disabled={customTesting || !customUrl.trim()}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-indigo-400 text-xs font-bold rounded-xl border border-zinc-700 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    {customTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>Test Ping</span>
                  </button>
                </div>
              </div>

              {customTestStatus && (
                <div className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  customTestStatus.success 
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' 
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}>
                  {customTestStatus.success ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : <XCircle className="w-4 h-4 shrink-0 text-rose-400" />}
                  <span>{customTestStatus.message || (customTestStatus.success ? 'Connectivity confirmed' : 'Connection failed')}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">Description (Optional)</label>
                <textarea
                  rows="2"
                  placeholder="Short description of this extension's capabilities..."
                  value={customDesc}
                  onChange={e => setCustomDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => { setIsAddCustomOpen(false); setCustomTestStatus(null); }}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold hover:bg-zinc-700 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={customSaving}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {customSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Register & Connect</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
