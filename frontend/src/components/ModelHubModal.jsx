import React, { useState, useEffect } from 'react';
import { X, Search, Cpu, Download, Trash2, CheckCircle2, BarChart2, Sparkles, Filter, ShieldCheck, Check, Layers, AlertCircle, RefreshCw, Key, ExternalLink, Zap, Cloud, Globe } from 'lucide-react';
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
  ibm: 'IBM',
  glm: 'Zhipu AI (GLM-4)',
  kimi: 'Moonshot AI (Kimi)',
};

const FREE_CLOUD_PROVIDERS = [
  {
    id: 'groq',
    chatCompatible: true,
    defaultChatModel: 'llama-3.3-70b-versatile',
    category: 'recurring-free',
    name: 'Groq',
    badge: 'Ultra-Fast LPU',
    tag: '⚡ 800 tok/s Free',
    color: 'from-orange-500/20 via-amber-500/10 to-orange-950/40 border-orange-500/40 text-orange-400',
    models: ['Llama 3.3 70B Versatile', 'DeepSeek R1 Distill 70B', 'Mixtral 8x7B', 'Gemma 2 9B'],
    specs: 'Generous recurring free daily quota (14,400 requests/day). World-record inference speeds.',
    description: 'Instant LPU acceleration powered by Groq chipsets. Perfect for real-time chat, coding, and heavy 70B models on low-spec hardware.',
    getKeyUrl: 'https://console.groq.com/keys',
    envKey: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
  },
  {
    id: 'openrouter',
    chatCompatible: true,
    defaultChatModel: 'deepseek/deepseek-r1:free',
    category: 'recurring-free',
    name: 'OpenRouter',
    badge: 'Universal Gateway',
    tag: '🌐 100+ Free Models',
    color: 'from-purple-500/20 via-indigo-500/10 to-purple-950/40 border-purple-500/40 text-purple-400',
    models: ['DeepSeek R1 (Free)', 'Llama 3.3 70B (Free)', 'Qwen 2.5 72B (Free)', 'Mistral Small (Free)'],
    specs: 'Single unified API key accessing 100+ AI models with dedicated zero-cost free-tier routes.',
    description: 'The ultimate fallback gateway. Connect to top proprietary and open models with zero upfront setup.',
    getKeyUrl: 'https://openrouter.ai/keys',
    envKey: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-v1-...',
  },
  {
    id: 'gemini',
    chatCompatible: true,
    defaultChatModel: 'gemini-2.5-flash',
    category: 'recurring-free',
    name: 'Google AI Studio (Gemini)',
    badge: '1.5M Context & Vision',
    tag: '📜 1.5M Window Free',
    color: 'from-blue-500/20 via-cyan-500/10 to-blue-950/40 border-cyan-500/40 text-cyan-400',
    models: ['Gemini 2.0 Flash', 'Gemini 1.5 Pro', 'Gemini 1.5 Flash'],
    specs: 'Free developer tier (15 requests/min, 1500 req/day). Industry-leading document context window.',
    description: 'Google AI Studio provides powerful multimodal models for long PDF analysis, code parsing, and web search grounding.',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    envKey: 'GEMINI_API_KEY',
    placeholder: 'AIzaSy...',
  },
  {
    id: 'openai',
    chatCompatible: true,
    defaultChatModel: 'gpt-4.1-mini',
    category: 'direct-byok',
    name: 'OpenAI API',
    badge: 'Direct Official API',
    tag: 'BYOK - Usage billed by OpenAI',
    color: 'from-emerald-500/20 via-teal-500/10 to-zinc-950/40 border-emerald-500/40 text-emerald-400',
    models: ['Models available to your OpenAI project'],
    specs: 'Loads the real model list authorized for the supplied OpenAI project key.',
    description: 'Connect directly to OpenAI. Availability, limits, and charges follow the user account and project.',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    envKey: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
  },
  {
    id: 'anthropic',
    chatCompatible: true,
    defaultChatModel: 'claude-sonnet-4-20250514',
    category: 'direct-byok',
    name: 'Anthropic Claude API',
    badge: 'Direct Official API',
    tag: 'BYOK - Usage billed by Anthropic',
    color: 'from-orange-500/20 via-amber-500/10 to-zinc-950/40 border-orange-500/40 text-orange-300',
    models: ['Claude models available to your Anthropic account'],
    specs: 'Loads the real Claude model list authorized for the supplied Anthropic key.',
    description: 'Connect directly to Anthropic Claude using the native Messages API.',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    envKey: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
  },
  {
    id: 'cerebras',
    chatCompatible: true,
    defaultChatModel: 'llama-3.3-70b',
    category: 'recurring-free',
    name: 'Cerebras Cloud',
    badge: 'Wafer-Scale Chips',
    tag: '🚀 1,800 tok/s Free',
    color: 'from-emerald-500/20 via-teal-500/10 to-emerald-950/40 border-emerald-500/40 text-emerald-400',
    models: ['Llama 3.3 70B', 'Llama 3.1 8B'],
    specs: 'High-speed wafer-scale engine inference. Extremely fast responses for long documents.',
    description: 'Blazing fast Llama models running on dedicated CS-3 wafer processors for instant response generation.',
    getKeyUrl: 'https://cloud.cerebras.ai/',
    envKey: 'CEREBRAS_API_KEY',
    placeholder: 'csk-...',
  },
  {
    id: 'sambanova',
    chatCompatible: true,
    defaultChatModel: 'Meta-Llama-3.3-70B-Instruct',
    category: 'free-trial',
    name: 'SambaNova Cloud',
    badge: '405B Frontier AI',
    tag: '🔥 Full 405B Free',
    color: 'from-pink-500/20 via-rose-500/10 to-pink-950/40 border-pink-500/40 text-pink-400',
    models: ['Llama 3.1 405B', 'Llama 3.3 70B', 'DeepSeek R1'],
    specs: 'Run massive 405 billion parameter models for free on enterprise SN40-L chip clusters.',
    description: 'Unlocks massive 405B model intelligence that normally requires multi-GPU server rigs.',
    getKeyUrl: 'https://cloud.sambanova.ai/',
    envKey: 'SAMBANOVA_API_KEY',
    placeholder: 'sn_...',
  },
  {
    id: 'together',
    chatCompatible: true,
    defaultChatModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    category: 'free-trial',
    name: 'Together AI',
    badge: 'Open Source Cloud',
    tag: '🎁 $25 Free Credits',
    color: 'from-blue-600/20 via-indigo-600/10 to-blue-950/40 border-blue-500/40 text-blue-400',
    models: ['Llama 3.3 70B Turbo', 'Qwen 2.5 Coder 32B', 'DeepSeek V3'],
    specs: 'Fast inference API supporting fine-tuned weights and open source models.',
    description: 'High-performance cloud endpoints hosting popular open-weight foundation models.',
    getKeyUrl: 'https://console.together.ai/settings/api-keys',
    envKey: 'TOGETHER_API_KEY',
    placeholder: 'tg_...',
  },
  {
    id: 'deepseek',
    chatCompatible: true,
    defaultChatModel: 'deepseek-chat',
    category: 'free-trial',
    name: 'DeepSeek Official',
    badge: 'Reasoning Leader',
    tag: '🧠 Free Trial Tokens',
    color: 'from-sky-500/20 via-blue-500/10 to-sky-950/40 border-sky-500/40 text-sky-400',
    models: ['DeepSeek V3', 'DeepSeek R1 Reasoning'],
    specs: 'Advanced chain-of-thought math, coding, and logical reasoning benchmarks.',
    description: 'Direct official API endpoints for DeepSeek-R1 reasoning & V3 architecture.',
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
    envKey: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
  },
  {
    id: 'cloudflare',
    category: 'recurring-free',
    name: 'Cloudflare Workers AI',
    badge: 'Serverless Edge',
    tag: '⚡ 10k Neurons/Day',
    color: 'from-amber-500/20 via-yellow-500/10 to-amber-950/40 border-amber-500/40 text-amber-400',
    models: ['Llama 3.1 8B', 'Mistral 7B Instruct', 'Whisper Speech-to-Text'],
    specs: '10,000 free daily neuron executions across 300+ global edge datacenters.',
    description: 'Ultra-low latency serverless model execution distributed worldwide.',
    getKeyUrl: 'https://dash.cloudflare.com/',
    envKey: 'CLOUDFLARE_API_KEY',
    placeholder: 'cf_...',
  },
  {
    id: 'huggingface',
    category: 'open-source',
    name: 'Hugging Face Hub',
    badge: '100k+ Open Models',
    tag: '🤗 Serverless API',
    color: 'from-yellow-500/20 via-amber-500/10 to-yellow-950/40 border-yellow-500/40 text-yellow-400',
    models: ['DeepSeek R1', 'Qwen 2.5', 'Phi-3.5', 'Gemma 2'],
    specs: 'Free Serverless Inference API tokens for community open source models.',
    description: 'Access the world’s largest open-source AI model hub directly via User Access Tokens.',
    getKeyUrl: 'https://huggingface.co/settings/tokens',
    envKey: 'HF_TOKEN',
    placeholder: 'hf_...',
  },
  {
    id: 'nvidia',
    chatCompatible: true,
    defaultChatModel: 'meta/llama-3.3-70b-instruct',
    category: 'free-trial',
    name: 'NVIDIA Build (NIM)',
    badge: 'Enterprise Acceleration',
    tag: '💚 1,000 Free Credits',
    color: 'from-green-500/20 via-emerald-500/10 to-green-950/40 border-green-500/40 text-green-400',
    models: ['Nemotron-4 340B', 'Llama 3.1 405B', 'Phi-3 Vision'],
    specs: 'Accelerated NVIDIA TensorRT-LLM cloud microservices with 1000 free trial credits.',
    description: 'Experience enterprise-grade NVIDIA NIM microservices hosted on high-end H100 clusters.',
    getKeyUrl: 'https://build.nvidia.com/',
    envKey: 'NVIDIA_API_KEY',
    placeholder: 'nvapi-...',
  },
  {
    id: 'mistral',
    chatCompatible: true,
    defaultChatModel: 'mistral-small-latest',
    category: 'free-trial',
    name: 'Mistral AI (La Plateforme)',
    badge: 'European Frontier',
    tag: '💻 Free Codestral Tier',
    color: 'from-orange-600/20 via-amber-600/10 to-orange-950/40 border-orange-500/40 text-orange-400',
    models: ['Mistral Small', 'Codestral 22B', 'Mistral NeMo'],
    specs: 'Free access to Codestral for developers & competitive pricing on Mistral models.',
    description: 'State-of-the-art European AI models engineered for efficiency, coding, and multilingual tasks.',
    getKeyUrl: 'https://console.mistral.ai/api-keys/',
    envKey: 'MISTRAL_API_KEY',
    placeholder: 'mistral_...',
  },
  {
    id: 'cohere',
    category: 'free-trial',
    name: 'Cohere',
    badge: 'Enterprise Search & RAG',
    tag: '📚 Free Trial Keys',
    color: 'from-teal-500/20 via-emerald-500/10 to-teal-950/40 border-teal-500/40 text-teal-400',
    models: ['Command R+', 'Command R', 'Embed English v3'],
    specs: 'Free trial API key for non-commercial RAG, web search grounding & citation tasks.',
    description: 'Industry standard for enterprise document retrieval, search embeddings, and grounded generation.',
    getKeyUrl: 'https://dashboard.cohere.com/api-keys',
    envKey: 'COHERE_API_KEY',
    placeholder: 'coh_...',
  }
];

const ModelHubModal = ({ isOpen, onClose, token, onModelChange }) => {
  const [activeTab, setActiveTab] = useState('local'); // 'local' | 'cloud'
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

  // Cloud API Keys state (persisted in localStorage)
  const [apiKeys, setApiKeys] = useState(() => {
    try {
      const saved = localStorage.getItem('sm_cloud_api_keys');
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

  const [keySaveNotice, setKeySaveNotice] = useState(null);
  const [cloudCategory, setCloudCategory] = useState('all');
  const [cloudModels, setCloudModels] = useState({});
  const [providerModels, setProviderModels] = useState({});
  const [providerLoading, setProviderLoading] = useState({});
  const [providerErrors, setProviderErrors] = useState({});
  const [providerNotices, setProviderNotices] = useState({});

  const loadProviderModels = async (providerId, apiKey) => {
    const key = String(apiKey || '').trim();
    if (!key) return;
    setProviderLoading((prev) => ({ ...prev, [providerId]: true }));
    setProviderErrors((prev) => ({ ...prev, [providerId]: null }));
    try {
      const res = await fetch(`${API_BASE}/api/cloud/models`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider: providerId, api_key: key }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not load provider models.');
      const models = [...new Set((data.models || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      setProviderModels((prev) => ({ ...prev, [providerId]: models }));
      setProviderNotices((prev) => ({ ...prev, [providerId]: data.notice || '' }));
      try { const cached = JSON.parse(localStorage.getItem('sm_cloud_provider_models') || '{}'); localStorage.setItem('sm_cloud_provider_models', JSON.stringify({ ...cached, [providerId]: models })); } catch (_) {}
      if (models.length) setCloudModels((prev) => ({ ...prev, [providerId]: prev[providerId] || models[0] }));
      else setProviderErrors((prev) => ({ ...prev, [providerId]: 'This key returned no selectable chat models.' }));
    } catch (e) { setProviderErrors((prev) => ({ ...prev, [providerId]: e.message || 'Could not load provider models.' })); }
    finally { setProviderLoading((prev) => ({ ...prev, [providerId]: false })); }
  };

  const handleSaveApiKey = async (providerId, keyVal) => {
    const cleanKey = keyVal.trim();
    const updated = { ...apiKeys, [providerId]: cleanKey };
    setApiKeys(updated);
    try {
      localStorage.setItem('sm_cloud_api_keys', JSON.stringify(updated));
      setKeySaveNotice(`API Key for ${providerId.toUpperCase()} saved in this browser.`);
      setTimeout(() => setKeySaveNotice(null), 3000);
      await loadProviderModels(providerId, cleanKey);
    } catch (e) { console.error('Failed to save API key', e); }
  };

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
    if (!isOpen) return;
    fetchCatalog();
    Object.entries(apiKeys).forEach(([providerId, apiKey]) => {
      const provider = FREE_CLOUD_PROVIDERS.find((item) => item.id === providerId);
      if (provider?.chatCompatible && apiKey) loadProviderModels(providerId, apiKey);
    });
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
        body: JSON.stringify({ model_id: modelId, hf_token: apiKeys.huggingface || '' }),
      });
      if (res.ok) {
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
                  if (dlInfo.status === 'error') alert(dlInfo.error || 'Model download failed.');
                  setDownloadingMap((prev) => ({ ...prev, [modelId]: false }));
                  clearInterval(pollInterval);
                  fetchCatalog();
                }
              }
            }
          } catch (pe) {
            console.error('Progress poll failed', pe);
          }
        }, 2000);
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.detail || 'Model download could not be started.');
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

  const companies = ['all', 'huggingface', 'alibaba', 'deepseek', 'meta', 'google', 'microsoft', 'mistral', 'nvidia', 'ibm', 'glm', 'kimi'];
  const capabilitiesList = [
    { id: 'all', label: 'All Capabilities' },
    { id: 'Vision', label: '👁️ Vision' },
    { id: 'Video', label: '📹 Video' },
    { id: 'Audio', label: '🎙️ Audio' },
    { id: 'Files', label: '📄 Files' },
    { id: 'Code', label: '💻 Code' },
    { id: 'Reasoning', label: '🧠 Reasoning' },
  ];

  const normalizedCompanyCode = (model) => {
    const raw = String(model.company_code || model.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const aliases = { hf: 'huggingface', huggingface: 'huggingface', qwen: 'alibaba', alibaba: 'alibaba', deepseek: 'deepseek', meta: 'meta', llama: 'meta', google: 'google', gemma: 'google', microsoft: 'microsoft', phi: 'microsoft', mistral: 'mistral', nvidia: 'nvidia', nemotron: 'nvidia', ibm: 'ibm', granite: 'ibm', zhipu: 'glm', glm: 'glm', moonshot: 'kimi', kimi: 'kimi' };
    return aliases[raw] || raw;
  };
  const filteredCatalog = catalog.filter((m) => {
    const matchesSearch =
      (m.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.company || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.parameters || '').toLowerCase().includes(searchQuery.toLowerCase());

    const companyCode = normalizedCompanyCode(m);

    const matchesCompany = selectedCompany === 'all' || companyCode === selectedCompany;
    const matchesCapability = selectedCapability === 'all' || (m.capabilities && m.capabilities.some((c) => c.toLowerCase() === selectedCapability.toLowerCase()));

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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-150">
        <div className="w-full max-w-6xl max-h-[94vh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 text-left">
          
          {/* Main Modal Header */}
          <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-wide flex items-center gap-1.5">
                  <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-400 bg-clip-text text-transparent font-extrabold">SMARAN</span>
                  <span className="text-white font-extrabold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 text-xs shadow-[0_0_10px_rgba(99,102,241,0.5)]">.AI</span>
                  <span className="text-zinc-200 ml-1 font-bold">Model Hub & Cloud APIs</span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Local offline models or free zero-cost cloud APIs for low VRAM systems.
                </p>
              </div>
            </div>

            {/* Modal Action buttons */}
            <div className="flex items-center gap-2">
              {keySaveNotice && (
                <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl animate-bounce">
                  {keySaveNotice}
                </span>
              )}
              <button
                onClick={onClose}
                className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Primary View Navigation Tabs */}
          <div className="px-6 pt-3 pb-0 bg-zinc-900/30 border-b border-zinc-800/80 flex items-center gap-2 shrink-0 overflow-x-auto">
            <button
              onClick={() => setActiveTab('local')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl text-xs font-black transition-all border-t border-x cursor-pointer ${
                activeTab === 'local'
                  ? 'bg-zinc-950 border-zinc-800 text-indigo-400 shadow-md'
                  : 'bg-zinc-900/40 border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>Local Hardware Models (VRAM / RAM)</span>
            </button>

            <button
              onClick={() => setActiveTab('cloud')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl text-xs font-black transition-all border-t border-x cursor-pointer ${
                activeTab === 'cloud'
                  ? 'bg-zinc-950 border-zinc-800 text-amber-400 shadow-md'
                  : 'bg-zinc-900/40 border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
              <span className="flex items-center gap-1.5">
                <span>Free Cloud API Keys & Providers</span>
                <span className="px-2 py-0.5 text-[9px] font-black rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-black uppercase tracking-wider shadow-sm">
                  Low Spec Friendly
                </span>
              </span>
            </button>
          </div>

          {/* TAB 1: LOCAL HARDWARE MODELS */}
          {activeTab === 'local' && (
            <>
              {/* Filter & Search Bar */}
              <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/20 space-y-4 shrink-0">
                <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
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
              <div className="p-6 overflow-y-auto max-h-[58vh] space-y-4">
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
                      const badgeColor = COMPANY_COLORS[normalizedCompanyCode(m)] || 'from-zinc-500/20 to-zinc-500/10 border-zinc-500/30 text-zinc-400';

                      return (
                        <div
                          key={m.id}
                          className={`relative bg-zinc-900/50 border rounded-2xl p-5 flex flex-col justify-between transition-all group hover:border-zinc-700 ${
                            isCompareSelected ? 'border-indigo-500/80 ring-2 ring-indigo-500/20 bg-indigo-950/10' : 'border-zinc-800/80'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border bg-gradient-to-r ${badgeColor}`}>
                                {m.company}
                              </span>
                              
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

                            <h3 className="text-base font-black text-white leading-snug tracking-tight flex items-center justify-between">
                              <span>{m.name}</span>
                              <span className="text-xs font-extrabold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
                                {m.parameters}
                              </span>
                            </h3>

                            <p className="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                              {m.description}
                            </p>

                            <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-zinc-300">
                              <span className="bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-lg">
                                📜 {m.context_length}
                              </span>
                              <span className="bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-lg text-indigo-300">
                                ⚙️ {m.quantization}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {m.capabilities.map((cap) => (
                                <span key={cap} className="text-[10px] font-bold text-zinc-400 bg-zinc-950/80 border border-zinc-800/80 px-2 py-0.5 rounded-md">
                                  {cap}
                                </span>
                              ))}
                            </div>

                            <div className="mt-4 pt-3 border-t border-zinc-800/80 grid grid-cols-3 gap-2 text-[11px]">
                              <div className="bg-zinc-950 p-2 rounded-xl border border-zinc-800 text-center">
                                <div className="text-zinc-500 text-[10px] uppercase font-bold">MMLU</div>
                                <div className="font-black text-emerald-400 mt-0.5">{m.benchmarks?.mmlu != null ? `${m.benchmarks.mmlu}%` : `N/A`}</div>
                              </div>
                              <div className="bg-zinc-950 p-2 rounded-xl border border-zinc-800 text-center">
                                <div className="text-zinc-500 text-[10px] uppercase font-bold">HumanEval</div>
                                <div className="font-black text-cyan-400 mt-0.5">{m.benchmarks?.humaneval != null ? `${m.benchmarks.humaneval}%` : `N/A`}</div>
                              </div>
                              <div className="bg-zinc-950 p-2 rounded-xl border border-zinc-800 text-center">
                                <div className="text-zinc-500 text-[10px] uppercase font-bold">MATH</div>
                                <div className="font-black text-purple-400 mt-0.5">{m.benchmarks?.math != null ? `${m.benchmarks.math}%` : `N/A`}</div>
                              </div>
                            </div>

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

              {/* Footer Bar */}
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
            </>
          )}

          {/* TAB 2: FREE CLOUD API PROVIDERS (LOW VRAM / ZERO HARDWARE) */}
          {activeTab === 'cloud' && (
            <div className="p-6 overflow-y-auto max-h-[72vh] space-y-6">
              
              {/* Informational Guidance Card */}
              <div className="p-5 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/30 via-zinc-900/80 to-purple-950/30 shadow-xl flex items-start gap-4">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
                  <Zap className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1.5 text-xs">
                  <h3 className="text-sm font-black text-amber-300 flex items-center gap-2">
                    <span>Low GPU VRAM or Low Hardware Specs? Run Heavy 70B / 405B Models Free via Cloud APIs</span>
                  </h3>
                  <p className="text-zinc-300 leading-relaxed font-semibold">
                    If your laptop or PC cannot run heavy AI models locally, use the direct key link below. Providers set their own free-tier, trial, region, and rate-limit rules, so this screen clearly separates recurring-free access from trial-credit options.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-2.5" role="tablist" aria-label="Cloud provider categories">
                {[
                  ['all', 'All providers'],
                  ['recurring-free', 'Recurring free tier'],
                  ['free-trial', 'Free trial / credits'],
                  ['open-source', 'Open-source access'],
                  ['direct-byok', 'Direct BYOK APIs'],
                ].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={cloudCategory === id} onClick={() => setCloudCategory(id)}
                    className={`rounded-xl px-3 py-2 text-[11px] font-black transition-all cursor-pointer ${cloudCategory === id ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 shadow-lg' : 'border border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-amber-500/50 hover:text-zinc-200'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Grid of Free Cloud Providers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {FREE_CLOUD_PROVIDERS.filter((provider) => cloudCategory === 'all' || provider.category === cloudCategory).map((provider) => {
                  const savedKey = apiKeys[provider.id] || '';

                  return (
                    <div
                      key={provider.id}
                      className={`rounded-2xl border bg-gradient-to-br ${provider.color} p-5 flex flex-col justify-between space-y-4 shadow-lg transition-all hover:scale-[1.01] hover:shadow-2xl`}
                    >
                      <div className="space-y-3">
                        {/* Header Badge */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg bg-zinc-950/80 border border-zinc-800 text-zinc-300 flex items-center gap-1.5">
                            <Cloud className="w-3 h-3 text-indigo-400" />
                            {provider.badge}
                          </span>
                          <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
                            {provider.tag}
                          </span>
                        </div>

                        {/* Title & Description */}
                        <div>
                          <h4 className="text-base font-black text-white flex items-center justify-between">
                            <span>{provider.name}</span>
                          </h4>
                          <p className="text-xs text-zinc-300 mt-1 leading-relaxed font-semibold">
                            {provider.description}
                          </p>
                        </div>

                        {/* Specs */}
                        <div className="text-[11px] font-bold text-indigo-300 bg-zinc-950/80 border border-zinc-800/80 p-2.5 rounded-xl leading-snug">
                          {provider.specs}
                        </div>

                        {/* Available Models Chips */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-black uppercase text-zinc-400">Popular Free Models:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {provider.models.map((m) => (
                              <span key={m} className="text-[10px] font-bold text-zinc-200 bg-zinc-900/90 border border-zinc-700 px-2 py-0.5 rounded-md">
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Direct API Key Action Box */}
                      <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-extrabold text-zinc-300 flex items-center gap-1">
                            <Key className="w-3.5 h-3.5 text-amber-400" /> API Key Setup
                          </span>

                          {/* Direct Clickable 1-Click Link to Key Page */}
                          <a
                            href={provider.getKeyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black text-[11px] font-black flex items-center gap-1.5 shadow-md transition-all cursor-pointer hover:scale-105"
                            title={`Click to open ${provider.name} direct API key creation dashboard`}
                          >
                            <span>Get Free API Key</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        {/* Inline Key Entry Input */}
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            placeholder={provider.placeholder}
                            defaultValue={savedKey}
                            id={`key-input-${provider.id}`}
                            className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded-xl px-3 py-1.5 text-xs font-mono text-white placeholder-zinc-600 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const el = document.getElementById(`key-input-${provider.id}`);
                              if (el) handleSaveApiKey(provider.id, el.value);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs border border-zinc-700 transition-all cursor-pointer shrink-0"
                          >
                            Save
                          </button>
                        </div>
                        {savedKey && provider.chatCompatible && (
                          <div className="mt-2 space-y-2">
                            <div className="flex gap-2">
                              <select value={cloudModels[provider.id] || ''} onChange={(e) => setCloudModels((prev) => ({ ...prev, [provider.id]: e.target.value }))} disabled={providerLoading[provider.id] || !(providerModels[provider.id] || []).length} className="min-w-0 flex-1 bg-zinc-950 border border-emerald-500/30 rounded-xl px-3 py-2 text-[11px] font-mono text-white outline-none disabled:opacity-60">
                                <option value="">{providerLoading[provider.id] ? 'Loading models from provider…' : 'Save key to load real provider models'}</option>
                                {(providerModels[provider.id] || []).map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
                              </select>
                              <button type="button" onClick={() => loadProviderModels(provider.id, savedKey)} disabled={providerLoading[provider.id]} title="Refresh models from provider" className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-indigo-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${providerLoading[provider.id] ? 'animate-spin' : ''}`} /></button>
                            </div>
                            {providerErrors[provider.id] && <p className="text-[10px] font-bold text-amber-300">{providerErrors[provider.id]}</p>}
                            {providerNotices[provider.id] && <p className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[10px] font-bold leading-relaxed text-sky-200">{providerNotices[provider.id]}</p>}
                            <button type="button" disabled={!cloudModels[provider.id]} onClick={() => { const modelId = cloudModels[provider.id]; localStorage.setItem('sm_cloud_selected_models', JSON.stringify({ provider: provider.id, model: modelId })); onModelChange?.(`cloud:${provider.id}:${modelId}`); onClose?.(); }} className="w-full rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-[11px] font-black text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50">Use selected Cloud API model in Chat</button>
                          </div>
                        )}
                        {savedKey && !provider.chatCompatible && <p className="text-[10px] font-bold text-zinc-400">Key saved. This provider is listed for direct access, but it is not connected to the chat engine yet.</p>}
                        {savedKey && (
                          <div className="text-[10px] font-extrabold text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> API key saved in this browser for {provider.name}
                          </div>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>

            </div>
          )}

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
