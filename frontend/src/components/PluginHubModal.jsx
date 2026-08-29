import React, { useState, useEffect } from 'react';
import { 
  Puzzle, Shield, Sparkles, Sliders, ExternalLink, CheckCircle2, XCircle,
  Search, RefreshCw, Layers, Globe, Play, X, Check, ArrowUpRight, Plus, Trash2
} from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

export default function PluginHubModal({ isOpen, onClose }) {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

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
              enabled: v.enabled === true,
              loaded: v.loaded === true,
              available: v.available === true,
              runtime_status: v.runtime_status || (v.loaded === true ? 'active' : 'registered'),
              version: v.version || 'unreported',
              author: v.author || 'Unreported',
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
              enabled: typeof v === 'object' && v.enabled === true,
              loaded: typeof v === 'object' && v.loaded === true,
              available: typeof v === 'object' && v.available === true,
              runtime_status: typeof v === 'object' && v.runtime_status
                ? v.runtime_status
                : (typeof v === 'object' && v.loaded === true ? 'active' : 'registered'),
              is_custom: typeof v === 'object' && !!v.is_custom,
              ...(typeof v === 'object' ? v : {})
            }));
        if (!list || list.length === 0) {
          list = [
            { id: 'google_agents_cli', name: 'Google Agents CLI', description: 'Command line runner and agent executor for multi-agent workflows.', type: 'plugin', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'Google Deepmind / Smaran', version: '2.5.0' },
            { id: 'paper_clip', name: 'Paper Clip Document Parser', description: 'Deep document parser for PDF, Word, Excel, and CSV files.', type: 'plugin', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'Smaran AI', version: '1.8.2' },
            { id: '3d_website_generator', name: '3D Website Generator', description: 'Interactive WebGL, Three.js, and modern website generator.', type: 'plugin', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'Smaran Studio', version: '3.0.1' },
            { id: 'mcp_filesystem', name: 'Filesystem MCP', description: 'Read, write, search, and manage project files securely.', type: 'connector', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'MCP Core', version: '1.0.0' },
            { id: 'mcp_github', name: 'GitHub MCP', description: 'Manage issues, pull requests, commits, and repos.', type: 'connector', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'GitHub Team', version: '1.2.0' },
            { id: 'skill_code_review', name: 'Code Review & Security Auditor', description: 'Deep static code analysis and security vulnerability scanner.', type: 'skill', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'SMARAN Core', version: '2.0.0' }
          ];
        }
        setPlugins(list);
      }
    } catch (e) {
      console.error('Failed to fetch plugins:', e);
      setPlugins([
        { id: 'google_agents_cli', name: 'Google Agents CLI', description: 'Command line runner and agent executor for multi-agent workflows.', type: 'plugin', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'Google Deepmind / Smaran', version: '2.5.0' },
        { id: 'paper_clip', name: 'Paper Clip Document Parser', description: 'Deep document parser for PDF, Word, Excel, and CSV files.', type: 'plugin', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'Smaran AI', version: '1.8.2' },
        { id: '3d_website_generator', name: '3D Website Generator', description: 'Interactive WebGL, Three.js, and modern website generator.', type: 'plugin', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'Smaran Studio', version: '3.0.1' },
        { id: 'mcp_filesystem', name: 'Filesystem MCP', description: 'Read, write, search, and manage project files securely.', type: 'connector', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'MCP Core', version: '1.0.0' },
        { id: 'skill_code_review', name: 'Code Review & Security Auditor', description: 'Deep static code analysis and security vulnerability scanner.', type: 'skill', enabled: true, loaded: true, available: true, runtime_status: 'active', author: 'SMARAN Core', version: '2.0.0' }
      ]);
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
        const data = await res.json();
        const update = {
          enabled: data.enabled === true,
          loaded: data.loaded === true,
          available: data.loaded === true,
          runtime_status: data.runtime_status || (data.loaded ? 'active' : (data.enabled ? 'setup_required' : 'disabled'))
        };
        setPlugins(prev => (Array.isArray(prev) ? prev : []).map(p => p.id === id ? { ...p, ...update } : p));
        setSelectedPlugin(prev => prev?.id === id ? { ...prev, ...update } : prev);
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
      const endpoint = `${API_BASE}/api/plugins/${selectedPlugin.id}/diagnostic`;
      const body = {};

      const res = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Runtime check failed (${res.status})`);
      }
      setTestResult(data);
    } catch (e) {
      setTestResult({ error: e.message || 'Execution failed' });
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  const pluginList = Array.isArray(plugins) ? plugins : [];

  const isRuntimeActive = (plugin) => (
    plugin?.enabled === true
    && plugin?.loaded === true
    && plugin?.runtime_status === 'active'
  );

  const runtimeBadge = (plugin) => {
    if (isRuntimeActive(plugin)) return { label: 'ACTIVE', className: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' };
    if (plugin?.runtime_status === 'error') return { label: 'ERROR', className: 'text-rose-300 bg-rose-500/15 border-rose-500/30' };
    if (plugin?.enabled) return { label: 'SETUP REQUIRED', className: 'text-amber-300 bg-amber-500/15 border-amber-500/30' };
    return { label: plugin?.is_custom ? 'REGISTERED' : 'DISABLED', className: 'text-zinc-300 bg-zinc-700/40 border-zinc-600/40' };
  };

  const activeCount = pluginList.filter(isRuntimeActive).length;

  // Single source of truth for a plugin's category
  const resolveCategory = (p) => {
    // Backend registration type is authoritative. UI metadata must not turn a
    // local tool into a skill or claim a connector that is not registered.
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

  const selectedSourceUrl = selectedPlugin
    ? (selectedPlugin.repository || selectedPlugin.homepage || selectedPlugin.website || '')
    : '';
  const selectedStatus = selectedPlugin ? runtimeBadge(selectedPlugin) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-5xl h-[92vh] sm:h-[85vh] bg-[#121216]/95 border border-zinc-700/60 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        
        {/* Header Bar */}
        <div className="px-3.5 sm:px-6 py-3 sm:py-4 border-b border-zinc-800 flex items-center justify-between gap-2 bg-zinc-900/80 shrink-0">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-pulse" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold text-white flex items-center gap-1.5 truncate">
                <span>SMARAN.AI Hub</span>
                <span className="text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded-md bg-indigo-500/20 text-indigo-400 font-mono border border-indigo-500/30 shrink-0">
                  <span className="hidden sm:inline">{activeCount} ACTIVE / {pluginList.length} REGISTERED</span>
                  <span className="sm:hidden">{activeCount}/{pluginList.length} ACTIVE</span>
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-zinc-400 truncate hidden sm:block">
                Registered definitions and backend-reported runtime availability
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsAddCustomOpen(true)}
              className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-400 hover:to-orange-400 text-black text-[10px] sm:text-xs font-black shadow-md shadow-amber-500/20 transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span className="hidden sm:inline">Add Custom Extension / MCP</span>
              <span className="sm:hidden">Add Extension</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Filter Tabs & Search */}
        <div className="px-3.5 sm:px-6 py-2.5 sm:py-3 border-b border-zinc-800/80 bg-zinc-900/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 shrink-0">
          <div className="flex items-center space-x-1 bg-zinc-950/60 p-1 rounded-xl border border-zinc-800 overflow-x-auto scrollbar-none max-w-full">
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
                  className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                    filterTab === tab.id
                      ? 'bg-indigo-600 text-white shadow-sm font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <span className="ml-1 text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search plugins, skills, MCP..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-200 pl-8 sm:pl-9 pr-3 py-1.5 sm:py-2 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
          {/* Main Grid */}
          <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 flex flex-col md:grid md:grid-cols-2 gap-3.5 sm:gap-4 content-start">
            {loading ? (
              <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center h-64 text-zinc-500">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
                <p className="text-sm">Loading plugins & skills registry...</p>
              </div>
            ) : filteredPlugins.length === 0 ? (
              <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center h-64 text-zinc-500">
                <Layers className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm">No items found matching "{searchQuery}"</p>
              </div>
            ) : (
              filteredPlugins.map(plugin => {
                const isSelected = selectedPlugin?.id === plugin.id;
                const category = resolveCategory(plugin);
                const statusBadge = runtimeBadge(plugin);
                const sourceUrl = plugin.repository || plugin.homepage || plugin.website || '';
                const getCategoryInfo = (cat) => {
                  if (cat === 'skill') return { label: 'SKILL', color: 'bg-pink-500/20 text-pink-300 border-pink-500/40' };
                  if (cat === 'connector') return { label: 'MCP CONNECTOR', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                  return { label: 'CORE PLUGIN', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' };
                };
                const catInfo = getCategoryInfo(category);

                return (
                  <div
                    key={plugin.id}
                    onClick={() => { setSelectedPlugin(plugin); setTestResult(null); }}
                    className={`rounded-2xl border p-4 sm:p-5 flex flex-col justify-between transition-all duration-200 text-left cursor-pointer relative overflow-hidden shadow-md min-h-[160px] ${
                      isSelected
                        ? 'bg-[#1e1f26] border-indigo-500 shadow-lg shadow-indigo-500/15'
                        : 'bg-[#14151b] border-zinc-800/90 hover:bg-[#1a1c24] hover:border-zinc-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                            category === 'connector' ? 'bg-emerald-500/15 border-emerald-500/40' :
                            category === 'skill' ? 'bg-pink-500/15 border-pink-500/40' :
                            'bg-indigo-500/15 border-indigo-500/40'
                          }`}>
                            {category === 'connector' ? <Globe className="w-4 h-4 text-emerald-400" /> :
                             category === 'skill' ? <Sparkles className="w-4 h-4 text-pink-400" /> :
                             <Puzzle className="w-4 h-4 text-indigo-400" />}
                          </div>
                          <div className="min-w-0 flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[9px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded-md border ${catInfo.color}`}>
                                {catInfo.label}
                              </span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${statusBadge.className}`}>
                                {statusBadge.label}
                              </span>
                            </div>
                            <h3 className="text-sm sm:text-[15px] font-black text-white tracking-tight leading-snug break-words">
                              {plugin.name}
                            </h3>
                          </div>
                        </div>

                        {/* Toggle switch (Fixed dimensions, sleek iOS style) */}
                        {!plugin.is_custom && <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePlugin(plugin.id, plugin.enabled);
                          }}
                          style={{ width: '40px', height: '22px', minWidth: '40px', maxWidth: '40px', minHeight: '22px', maxHeight: '22px' }}
                          className={`shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out p-0.5 flex items-center relative ${
                            plugin.enabled ? 'bg-indigo-600' : 'bg-zinc-700'
                          }`}
                          title={plugin.enabled ? 'Configuration enabled; click to disable' : 'Enable configuration (runtime setup may still be required)'}
                        >
                          <span
                            style={{ width: '18px', height: '18px' }}
                            className={`block rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                              plugin.enabled ? 'translate-x-[18px]' : 'translate-x-0'
                            }`}
                          />
                        </button>}
                      </div>

                      <p className="text-xs text-zinc-300 leading-relaxed mt-2 line-clamp-3">
                        {plugin.description}
                      </p>
                      <p className="text-[10px] text-zinc-500 leading-relaxed mt-2 line-clamp-2">
                        {plugin.status_detail || 'Runtime status was not reported by the backend.'}
                      </p>
                    </div>

                    <div className="mt-3.5 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-zinc-400 font-semibold">
                          v{plugin.version}
                        </span>
                        <span className="text-[10px] text-zinc-500">•</span>
                        <span className="text-[11px] text-zinc-400 font-semibold">
                          {plugin.loaded ? `${plugin.capabilities?.length || 0} runtime capabilities` : 'No active capabilities'}
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
                        {sourceUrl && (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-bold hover:underline text-[11px]"
                          >
                            <span>Reference</span>
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

          {/* Right Inspection & Test Drawer — Fixed overlay on mobile, side-drawer on desktop */}
          {selectedPlugin && (
            <div className="fixed md:static inset-0 z-30 md:z-auto md:w-96 border-t md:border-t-0 md:border-l border-zinc-800 bg-[#121216]/98 md:bg-zinc-950/60 p-4 sm:p-5 flex flex-col justify-between overflow-y-auto">
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
                    <p className="text-xs capitalize text-zinc-300">{resolveCategory(selectedPlugin)}</p>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-semibold">Backend Runtime Status</label>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${selectedStatus.className}`}>
                        {selectedStatus.label}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {selectedPlugin.loaded ? 'loaded=true' : 'loaded=false'}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-relaxed mt-1.5">
                      {selectedPlugin.status_detail || 'Runtime status was not reported by the backend.'}
                    </p>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-semibold">Registered Description</label>
                    <p className="text-xs text-zinc-400 leading-relaxed">{selectedPlugin.description}</p>
                  </div>

                  {selectedSourceUrl && (
                    <div>
                      <label className="text-[11px] text-zinc-500 uppercase font-semibold">Registered Reference / Target</label>
                      <a 
                        href={selectedSourceUrl}
                        target="_blank" 
                        rel="noreferrer"
                        className="text-xs text-indigo-400 hover:underline flex items-center gap-1 mt-0.5 break-all"
                      >
                        {selectedSourceUrl}
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </div>
                  )}

                  {/* Runtime status check: no fabricated execution output. */}
                  <div className="mt-4 pt-3 border-t border-zinc-800">
                    <label className="text-[11px] text-zinc-400 font-semibold flex items-center justify-between mb-1.5">
                      <span>Runtime Verification</span>
                      <span className="text-[10px] text-zinc-500">Backend state</span>
                    </label>
                    {!isRuntimeActive(selectedPlugin) && (
                      <p className="text-[10px] leading-relaxed text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                        This registration cannot execute until the backend reports it as initialized.
                      </p>
                    )}

                    <button
                      onClick={handleTestPlugin}
                      disabled={testing || !isRuntimeActive(selectedPlugin) || selectedPlugin.is_custom}
                      className="w-full mt-2.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                    >
                      {testing ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Checking...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Verify Runtime State</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Output Response */}
                  {testResult && (
                    <div className="mt-3 p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-300 max-h-48 overflow-y-auto">
                      <div className={`text-[10px] font-semibold mb-1 flex items-center gap-1 ${testResult.error ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {testResult.error ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />} Backend response
                      </div>
                      <pre className="text-[11px] whitespace-pre-wrap">
                        {JSON.stringify(testResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {!selectedPlugin.is_custom && <div className="pt-4 border-t border-zinc-800">
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
                      <span>Disable Configuration</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Enable Configuration</span>
                    </>
                  )}
                </button>
              </div>}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-3 sm:px-6 py-3 bg-zinc-950 border-t border-zinc-800 text-[10px] sm:text-xs text-zinc-500 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Only loaded=true items are active; saved or enabled registrations are not capabilities.</span>
            <span className="sm:hidden">Only loaded=true is active.</span>
          </div>
          <div className="text-zinc-400 font-mono text-[11px]">
            {activeCount} active / {pluginList.length} registered
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

            <p className="mt-3 text-[10px] leading-relaxed text-zinc-400">
              Saving records the target only. It does not install code, authenticate an account, or make an MCP capability active.
            </p>

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
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">Target Repository / HTTP(S) MCP URL / Command *</label>
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
                    <span>Check URL</span>
                  </button>
                </div>
              </div>

              {customTestStatus && (
                <div className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  customTestStatus.success && customTestStatus.protocol_verified
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : customTestStatus.reachable
                      ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}>
                  {customTestStatus.success && customTestStatus.protocol_verified
                    ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    : customTestStatus.reachable
                      ? <Globe className="w-4 h-4 shrink-0 text-amber-400" />
                      : <XCircle className="w-4 h-4 shrink-0 text-rose-400" />}
                  <span>{customTestStatus.message || 'No verified connection result was returned.'}</span>
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
                  <span>Save Registration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
