import React, { useState, useEffect } from 'react';
import { X, Search, Cpu, Download, Trash2, CheckCircle2, BarChart2, Sparkles, Filter, ShieldCheck, Check, Layers, AlertCircle, RefreshCw } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import ModelComparisonModal from './ModelComparisonModal';

const COMPANY_COLORS = {
  huggingface: 'from-yellow-500/20 to-amber-500/10 border-yellow-500/30 text-yellow-400',
  alibaba: 'from-orange-500/20 to-amber-500/10 border-orange-500/30 text-orange-400',
  deepseek: 'from-blue-500/20 to-cyan-500/10 border-blue-500/30 text-blue-400',
  meta: 'from-sky-500/20 to-indigo-500/10 border-sky-500/30 text-sky-400',
  google: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30 text-emerald-400',
  microsoft: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/30 text-cyan-400',
  mistral: 'from-amber-500/20 to-orange-500/10 border-amber-500/30 text-amber-400',
  nvidia: 'from-green-500/20 to-emerald-500/10 border-green-500/30 text-green-400',
  glm: 'from-purple-500/20 to-indigo-500/10 border-purple-500/30 text-purple-400',
  kimi: 'from-pink-500/20 to-rose-500/10 border-pink-500/30 text-pink-400',
};

const COMPANY_LABELS = {
  all: 'All Companies',
  huggingface: 'Hugging Face',
  alibaba: 'Alibaba',
  deepseek: 'DeepSeek',
  meta: 'Meta',
  google: 'Google',
  microsoft: 'Microsoft',
  mistral: 'Mistral AI',
  nvidia: 'NVIDIA',
  glm: 'Zhipu AI (GLM-4)',
  kimi: 'Moonshot AI (Kimi)',
};

const ModelHubModal = ({ isOpen, onClose, token }) => {
  const [catalog, setCatalog] = useState([]);
  const [userGpuVram, setUserGpuVram] = useState(6.0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [selectedCapability, setSelectedCapability] = useState('all');
  const [gpuTierFilter, setGpuTierFilter] = useState('all');
  const [downloadingMap, setDownloadingMap] = useState({});

  // Model comparison selection (up to 4 models)
  const [selectedForCompare, setSelectedForCompare] = useState([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const fetchCatalog = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/models/catalog`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.catalog || []);
        setUserGpuVram(data.user_gpu_vram_gb || 6.0);
      }
    } catch (e) {
      console.error('Failed to fetch catalog', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCatalog();
    }
  }, [isOpen]);

  const toggleCompareSelection = (modelId) => {
    if (selectedForCompare.includes(modelId)) {
      setSelectedForCompare(selectedForCompare.filter((id) => id !== modelId));
    } else {
      if (selectedForCompare.length >= 4) {
        alert('You can select up to 4 models for side-by-side comparison.');
        return;
      }
      setSelectedForCompare([...selectedForCompare, modelId]);
    }
  };

  const [progressMap, setProgressMap] = useState({});

  const handleDownload = async (modelId) => {
    setDownloadingMap((prev) => ({ ...prev, [modelId]: true }));
    setProgressMap((prev) => ({ ...prev, [modelId]: { percent: 0, speed_mbps: 0, downloaded_mb: 0, total_mb: 0, eta_secs: 0, status: 'starting' } }));
    try {
      const res = await fetch(`${API_BASE}/api/models/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (res.ok) {
        // Poll download progress every 2 seconds
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_BASE}/api/models/download-status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              const dlInfo = statusData.downloads?.[modelId];
              if (dlInfo) {
                setProgressMap((prev) => ({ ...prev, [modelId]: dlInfo }));

                if (dlInfo.status === 'completed' || dlInfo.status === 'error' || dlInfo.status === 'cancelled') {
                  setDownloadingMap((prev) => ({ ...prev, [modelId]: false }));
                  clearInterval(pollInterval);
                  // Refresh catalog to get updated is_downloaded
                  fetchCatalog();
                }
              }
            }
          } catch (pe) {
            console.error('Progress poll failed', pe);
          }
        }, 2000);
      } else {
        setDownloadingMap((prev) => ({ ...prev, [modelId]: false }));
      }
    } catch (e) {
      console.error('Download failed', e);
      setDownloadingMap((prev) => ({ ...prev, [modelId]: false }));
    }
  };

  const handleCancelDownload = async (modelId) => {
    try {
      const res = await fetch(`${API_BASE}/api/models/cancel-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (res.ok) {
        setDownloadingMap((prev) => ({ ...prev, [modelId]: false }));
        setProgressMap((prev) => ({ ...prev, [modelId]: null }));
        fetchCatalog();
      }
    } catch (e) {
      console.error('Cancel download failed', e);
    }
  };

  const handleDelete = async (modelId) => {
    if (!window.confirm(`Permanently delete cached model weights for ${modelId}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/models/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (res.ok) {
        setCatalog((prev) =>
          prev.map((item) => (item.id === modelId ? { ...item, is_downloaded: false } : item))
        );
        fetchCatalog();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.detail || 'Delete failed.');
      }
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  if (!isOpen) return null;

  const companies = ['all', 'huggingface', 'alibaba', 'deepseek', 'meta', 'google', 'microsoft', 'mistral', 'nvidia', 'glm', 'kimi'];
  const capabilitiesList = [
    { id: 'all', label: 'All Capabilities' },
    { id: 'Vision', label: '👁️ Vision' },
    { id: 'Video', label: '📹 Video' },
    { id: 'Audio', label: '🎙️ Audio' },
    { id: 'Files', label: '📄 Files' },
    { id: 'Code', label: '💻 Code' },
    { id: 'Reasoning', label: '🧠 Reasoning' },
  ];

  const filteredCatalog = catalog.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCompany = selectedCompany === 'all' || m.company_code === selectedCompany;
    const matchesCapability = selectedCapability === 'all' || (m.capabilities && m.capabilities.includes(selectedCapability));

    let matchesGpuTier = true;
    if (gpuTierFilter === 'cpu') {
      matchesGpuTier = m.recommended_gpu_vram_gb <= 2.0;
    } else if (gpuTierFilter === '2gb') {
      matchesGpuTier = m.recommended_gpu_vram_gb <= 2.0;
    } else if (gpuTierFilter === '4gb') {
      matchesGpuTier = m.recommended_gpu_vram_gb <= 4.0;
    } else if (gpuTierFilter === '6gb') {
      matchesGpuTier = m.recommended_gpu_vram_gb <= 6.0;
    } else if (gpuTierFilter === '8gb') {
      matchesGpuTier = m.recommended_gpu_vram_gb <= 8.0;
    } else if (gpuTierFilter === '12gb') {
      matchesGpuTier = m.recommended_gpu_vram_gb <= 12.0;
    } else if (gpuTierFilter === '24gb') {
      matchesGpuTier = m.recommended_gpu_vram_gb > 12.0;
    }

    return matchesSearch && matchesCompany && matchesGpuTier && matchesCapability;
  });

  const selectedModelsData = catalog.filter((m) => selectedForCompare.includes(m.id));

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
        <div className="w-full max-w-6xl max-h-[92vh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 text-left">
          
          {/* Header */}
          <div className="px-6 py-5 border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-wide">
                  SMARAN AI Model Catalog & Enterprise Hub
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Browse top open-source models with verified technical benchmarks, context specs, and hardware compatibility.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Filter & Search Bar */}
          <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/20 space-y-4 shrink-0">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
              {/* Search input */}
              <div className="relative w-full md:w-96">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search model name, company, or capability..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-xs font-semibold text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Hardware GPU Tier Select Dropdown */}
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Filter className="w-4 h-4 text-indigo-400 shrink-0" />
                <select
                  value={gpuTierFilter}
                  onChange={(e) => setGpuTierFilter(e.target.value)}
                  className="w-full md:w-auto bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-extrabold text-indigo-300 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-sm"
                >
                  <option value="all">🌐 All Hardware Tiers & GPU Generations</option>
                  <option value="cpu">💻 Integrated GPU / CPU-RAM Mode (Intel UHD / Iris Xe / AMD Vega / CPU-Only)</option>
                  <option value="2gb">⚡ 2GB GPU Tier (GTX 1050 / GTX 960 / MX450 / 2GB VRAM)</option>
                  <option value="4gb">🔥 4GB GPU Tier (GTX 1650 / GTX 1050 Ti / RX 570 / 4GB VRAM)</option>
                  <option value="6gb">🟢 6GB GPU Tier (RTX 2060 6GB / GTX 1660 / GTX 1060 / RTX 3050)</option>
                  <option value="8gb">🟡 8GB - 10GB GPU Tier (RTX 4060 8GB / RTX 3070 / RTX 3080 10GB / GTX 1080 Ti)</option>
                  <option value="12gb">🔵 12GB - 16GB GPU Tier (RTX 5070 12GB / RTX 5080 16GB / RTX 4070 / RTX 3060 12GB)</option>
                  <option value="24gb">🚀 24GB - 32GB+ Flagship GPU Tier (RTX 5090 32GB / RTX 4090 24GB / RTX 3090 / A100)</option>
                </select>
              </div>
            </div>

            {/* Company Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {companies.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCompany(c)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all whitespace-nowrap cursor-pointer ${
                    selectedCompany === c
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {COMPANY_LABELS[c] || c}
                </button>
              ))}
            </div>

            {/* Capability Filter Pills (Vision, Video, Audio, Files, Code, Reasoning) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-1.5 border-t border-zinc-800/40">
              <span className="text-[10px] font-extrabold uppercase text-zinc-500 mr-1 shrink-0">Capability Filter:</span>
              {capabilitiesList.map((cap) => (
                <button
                  key={cap.id}
                  onClick={() => setSelectedCapability(cap.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-all whitespace-nowrap cursor-pointer ${
                    selectedCapability === cap.id
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md border border-purple-400/30'
                      : 'bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {cap.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model Catalog Grid */}
          <div className="p-6 overflow-y-auto max-h-[60vh] space-y-4">
            {loading ? (
              <div className="py-20 text-center text-zinc-500 text-sm font-semibold flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" /> Loading Enterprise Model Catalog...
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="py-16 text-center text-zinc-500 text-sm font-semibold">
                No models matched your search or hardware filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCatalog.map((m) => {
                  const isCompareSelected = selectedForCompare.includes(m.id);
                  const isDownloading = downloadingMap[m.id];
                  const badgeColor = COMPANY_COLORS[m.company_code] || 'from-zinc-500/20 to-zinc-500/10 border-zinc-500/30 text-zinc-400';

                  return (
                    <div
                      key={m.id}
                      className={`relative bg-zinc-900/50 border rounded-2xl p-5 flex flex-col justify-between transition-all group hover:border-zinc-700 ${
                        isCompareSelected ? 'border-indigo-500/80 ring-2 ring-indigo-500/20 bg-indigo-950/10' : 'border-zinc-800/80'
                      }`}
                    >
                      <div>
                        {/* Top Card Row */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border bg-gradient-to-r ${badgeColor}`}>
                            {m.company}
                          </span>
                          
                          {/* Compare Checkbox */}
                          <button
                            onClick={() => toggleCompareSelection(m.id)}
                            className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                              isCompareSelected
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {isCompareSelected && <Check className="w-3.5 h-3.5" />}
                            {isCompareSelected ? 'Selected' : '+ Compare'}
                          </button>
                        </div>

                        {/* Model Name & Specs */}
                        <h3 className="text-base font-black text-white leading-snug tracking-tight flex items-center justify-between">
                          <span>{m.name}</span>
                          <span className="text-xs font-extrabold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
                            {m.parameters}
                          </span>
                        </h3>

                        <p className="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                          {m.description}
                        </p>

                        {/* Context & Quantization Info */}
                        <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-zinc-300">
                          <span className="bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-lg">
                            📜 {m.context_length}
                          </span>
                          <span className="bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-lg text-indigo-300">
                            ⚙️ {m.quantization}
                          </span>
                        </div>

                        {/* Capabilities Tags */}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {m.capabilities.map((cap) => (
                            <span key={cap} className="text-[10px] font-bold text-zinc-400 bg-zinc-950/80 border border-zinc-800/80 px-2 py-0.5 rounded-md">
                              {cap}
                            </span>
                          ))}
                        </div>

                        {/* Benchmark Highlights */}
                        <div className="mt-4 pt-3 border-t border-zinc-800/80 grid grid-cols-3 gap-2 text-[11px]">
                          <div className="bg-zinc-950 p-2 rounded-xl border border-zinc-800 text-center">
                            <div className="text-zinc-500 text-[10px] uppercase font-bold">MMLU</div>
                            <div className="font-black text-emerald-400 mt-0.5">{m.benchmarks.mmlu}%</div>
                          </div>
                          <div className="bg-zinc-950 p-2 rounded-xl border border-zinc-800 text-center">
                            <div className="text-zinc-500 text-[10px] uppercase font-bold">HumanEval</div>
                            <div className="font-black text-cyan-400 mt-0.5">{m.benchmarks.humaneval}%</div>
                          </div>
                          <div className="bg-zinc-950 p-2 rounded-xl border border-zinc-800 text-center">
                            <div className="text-zinc-500 text-[10px] uppercase font-bold">MATH</div>
                            <div className="font-black text-purple-400 mt-0.5">{m.benchmarks.math}%</div>
                          </div>
                        </div>

                        {/* Hardware Suitability & Recommended GPU Specs */}
                        <div className="mt-3.5 space-y-1.5">
                          {m.recommended_gpu_name && (
                            <div className="text-[11px] font-bold text-zinc-400 flex items-center justify-between bg-zinc-950/80 border border-zinc-800/80 px-2.5 py-1.5 rounded-xl">
                              <span className="text-zinc-500 font-extrabold uppercase text-[10px]">Req GPU:</span>
                              <span className="text-indigo-300 font-extrabold">{m.recommended_gpu_name}</span>
                            </div>
                          )}
                          <div className="text-[11px] font-bold text-zinc-300 leading-snug">
                            {m.hardware_fit?.label}
                          </div>
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="mt-5 pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                        {m.is_downloaded ? (
                          <div className="flex items-center justify-between w-full gap-2">
                            <span className="text-xs font-extrabold text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Ready & Downloaded
                            </span>

                            <button
                              onClick={() => handleDelete(m.id)}
                              className="px-3 py-1.5 text-xs font-bold text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-600 border border-rose-500/30 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                              title="Permanently delete cached model weights and reclaim disk space/VRAM"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete Weights
                            </button>
                          </div>
                        ) : (
                          isDownloading ? (
                            <div className="w-full space-y-2">
                              {/* Percentage + Cancel Row */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                                  <span className="text-lg font-black text-white">
                                    {(progressMap[m.id]?.total_mb > 0) ? `${progressMap[m.id]?.percent || 0}%` : 'Downloading...'}
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleCancelDownload(m.id)}
                                  className="px-3 py-1.5 text-xs font-black text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-600 border border-rose-500/30 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                                  title="Cancel download"
                                >
                                  <X className="w-3.5 h-3.5" /> Cancel
                                </button>
                              </div>
                              {/* Progress Bar */}
                              <div className="w-full bg-zinc-800 rounded-full h-4 overflow-hidden border border-zinc-700">
                                {progressMap[m.id]?.total_mb > 0 ? (
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-purple-500 to-cyan-400 transition-all duration-700 ease-out relative"
                                    style={{ width: `${Math.max(progressMap[m.id]?.percent || 0, 2)}%` }}
                                  >
                                    <div className="absolute inset-0 bg-white/10 animate-pulse" />
                                  </div>
                                ) : (
                                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-purple-500 to-cyan-400 animate-pulse" style={{ width: '100%' }} />
                                )}
                              </div>
                              {/* Stats Row */}
                              <div className="flex items-center justify-between text-xs font-bold text-zinc-400">
                                <span>
                                  📦 {(() => {
                                    const dl = progressMap[m.id]?.downloaded_mb || 0;
                                    const tot = progressMap[m.id]?.total_mb || 0;
                                    const fmt = (mb) => mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
                                    return tot > 0 ? `${fmt(dl)} / ${fmt(tot)}` : `${fmt(dl)} downloaded`;
                                  })()}
                                </span>
                                <div className="flex items-center gap-3">
                                  {progressMap[m.id]?.speed_mbps > 0 && (
                                    <span className="text-cyan-400">⚡ {progressMap[m.id].speed_mbps >= 1024 ? `${(progressMap[m.id].speed_mbps / 1024).toFixed(1)} GB/s` : `${progressMap[m.id].speed_mbps.toFixed(1)} MB/s`}</span>
                                  )}
                                  {progressMap[m.id]?.eta_secs > 0 && (
                                    <span className="text-amber-400">⏱ {progressMap[m.id].eta_secs > 60 ? `${Math.floor(progressMap[m.id].eta_secs / 60)}m ${progressMap[m.id].eta_secs % 60}s` : `${progressMap[m.id].eta_secs}s`}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDownload(m.id)}
                              className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Model Weights</span>
                            </button>
                          )
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Bar with Side-by-Side Comparison Launcher */}
          <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-zinc-300">
                Selected <strong className="text-indigo-400 font-black">{selectedForCompare.length}/4</strong> models for side-by-side comparison matrix.
              </span>
            </div>

            <button
              onClick={() => setIsCompareModalOpen(true)}
              disabled={selectedForCompare.length === 0}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-black tracking-wide transition-all shadow-lg flex items-center gap-2 cursor-pointer disabled:opacity-40"
            >
              <BarChart2 className="w-4 h-4" />
              Compare Selected ({selectedForCompare.length}/4)
            </button>
          </div>

        </div>
      </div>

      {/* Side-by-Side 4-Model Comparison Matrix Modal */}
      <ModelComparisonModal
        isOpen={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
        models={selectedModelsData}
        userGpuVram={userGpuVram}
      />
    </>
  );
};

export default ModelHubModal;
