import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Cpu, Download, Trash2, CheckCircle2, BarChart2, Sparkles, Filter, ShieldCheck, Check, Layers, AlertCircle, RefreshCw, Key, ExternalLink, Zap, Cloud, Globe, Video } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import ModelComparisonModal from './ModelComparisonModal';

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const safeToFixed = (value, digits = 0) => {
  if (!finite(value)) return null;
  try { return value.toFixed(digits); } catch { return null; }
};

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
  glm: 'Zhipu AI',
  kimi: 'Moonshot AI',
};

const cloudProvider = ({ id, name, color, getKeyUrl, placeholder }) => ({
  id,
  name,
  color,
getKeyUrl,
  placeholder,
  chatCompatible: true,
  category: 'provider-api',
  badge: 'Provider API',
  tag: '',
  models: [],
  description: `Connect directly to ${name} with a user-supplied API key.`,
  specs: 'Models are listed only after this key passes a live provider model-list request. Pricing, quota, regions, and rate limits remain provider-controlled.',
});

const CLOUD_PROVIDERS = [
  cloudProvider({ id: 'groq', name: 'Groq', color: 'from-orange-500/20 via-amber-500/10 to-orange-950/40 border-orange-500/40 text-orange-400', getKeyUrl: 'https://console.groq.com/keys', placeholder: 'gsk_...' }),
  cloudProvider({ id: 'openrouter', name: 'OpenRouter', color: 'from-purple-500/20 via-indigo-500/10 to-purple-950/40 border-purple-500/40 text-purple-400', getKeyUrl: 'https://openrouter.ai/keys', placeholder: 'sk-or-v1-...' }),
  cloudProvider({ id: 'gemini', name: 'Google AI Studio (Gemini)', color: 'from-blue-500/20 via-cyan-500/10 to-blue-950/40 border-cyan-500/40 text-cyan-400', getKeyUrl: 'https://aistudio.google.com/app/apikey', placeholder: 'AIzaSy...' }),
  cloudProvider({ id: 'openai', name: 'OpenAI API', color: 'from-emerald-500/20 via-teal-500/10 to-zinc-950/40 border-emerald-500/40 text-emerald-400', getKeyUrl: 'https://platform.openai.com/api-keys', placeholder: 'sk-...' }),
  cloudProvider({ id: 'anthropic', name: 'Anthropic Claude API', color: 'from-orange-500/20 via-amber-500/10 to-zinc-950/40 border-orange-500/40 text-orange-300', getKeyUrl: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-...' }),
  cloudProvider({ id: 'cerebras', name: 'Cerebras Cloud', color: 'from-emerald-500/20 via-teal-500/10 to-emerald-950/40 border-emerald-500/40 text-emerald-400', getKeyUrl: 'https://cloud.cerebras.ai/', placeholder: 'csk-...' }),
  cloudProvider({ id: 'sambanova', name: 'SambaNova Cloud', color: 'from-pink-500/20 via-rose-500/10 to-pink-950/40 border-pink-500/40 text-pink-400', getKeyUrl: 'https://cloud.sambanova.ai/', placeholder: 'sn_...' }),
  cloudProvider({ id: 'together', name: 'Together AI', color: 'from-blue-600/20 via-indigo-600/10 to-blue-950/40 border-blue-500/40 text-blue-400', getKeyUrl: 'https://console.together.ai/settings/api-keys', placeholder: 'tg_...' }),
  cloudProvider({ id: 'deepseek', name: 'DeepSeek Official', color: 'from-sky-500/20 via-blue-500/10 to-sky-950/40 border-sky-500/40 text-sky-400', getKeyUrl: 'https://platform.deepseek.com/api_keys', placeholder: 'sk-...' }),
  cloudProvider({ id: 'huggingface', name: 'Hugging Face Inference', color: 'from-yellow-500/20 via-amber-500/10 to-yellow-950/40 border-yellow-500/40 text-yellow-400', getKeyUrl: 'https://huggingface.co/settings/tokens', placeholder: 'hf_...' }),
  cloudProvider({ id: 'nvidia', name: 'NVIDIA Build (NIM)', color: 'from-green-500/20 via-emerald-500/10 to-green-950/40 border-green-500/40 text-green-400', getKeyUrl: 'https://build.nvidia.com/', placeholder: 'nvapi-...' }),
  cloudProvider({ id: 'mistral', name: 'Mistral AI', color: 'from-orange-600/20 via-amber-600/10 to-orange-950/40 border-orange-500/40 text-orange-400', getKeyUrl: 'https://console.mistral.ai/api-keys/', placeholder: 'mistral_...' }),
  // Video, not chat. One key reaches many video models rather than one
  // company's own, which is why it is this one - and the generation is billed
  // to that account, so nothing uses it until the key is deliberately saved.
  cloudProvider({ id: 'replicate', name: 'Replicate — video generation', color: 'from-fuchsia-500/20 via-pink-500/10 to-fuchsia-950/40 border-fuchsia-500/40 text-fuchsia-400', getKeyUrl: 'https://replicate.com/account/api-tokens', placeholder: 'r8_...' }),
];


/**
 * Getting the packages that video generation needs.
 *
 * Separate from the model catalogue because it is not a model: it is PyTorch
 * and diffusers, about 3 GB, which the packaged app does not ship because
 * most installs never make a video. The backend has been able to fetch them
 * all along; nothing ever asked it to.
 *
 * The weights are a second, much larger download that happens on first use -
 * said here rather than discovered as a surprise after the 3 GB finishes.
 */
const VideoPackages = () => {
  const [state, setState] = useState(null);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/video/install`, { credentials: 'include' });
      if (res.ok) setState(await res.json());
    } catch (_) { /* backend not reachable; the panel stays quiet */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // While it runs, the backend collects progress lines; poll for them.
  useEffect(() => {
    if (state?.status !== 'running') return undefined;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [state?.status, refresh]);

  const start = async () => {
    setStarting(true);
    try {
      await fetch(`${API_BASE}/api/video/install`, { method: 'POST', credentials: 'include' });
      await refresh();
    } finally {
      setStarting(false);
    }
  };

  if (!state) return null;

  const running = state.status === 'running';
  const done = state.installed;

  return (
    <div className={`rounded-2xl border p-4 ${
      done ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Video className={`w-5 h-5 ${done ? 'text-emerald-400' : 'text-amber-400'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-white">Video generation packages</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {done
              ? 'Installed. Ask for a video in the chat and it runs on this machine.'
              : `PyTorch and diffusers, about ${state.approx_download_gb} GB. Not shipped with the app because most installs never generate a video.`}
          </p>
        </div>
        {!done && state.can_install && (
          <button
            type="button"
            onClick={start}
            disabled={running || starting}
            className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-xs font-black text-white cursor-pointer"
          >
            {running ? 'Installing…' : starting ? 'Starting…' : 'Install'}
          </button>
        )}
      </div>

      {/* Why it cannot be done from here, when that is the case. */}
      {!done && !state.can_install && state.blocker && (
        <p className="mt-3 text-xs leading-relaxed text-amber-300/90">{state.blocker}</p>
      )}

      {!done && state.can_install && (
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          The model weights are a separate download on first use and are far larger
          than this — LTX-Video is about 28 GB. Worth knowing before you start.
        </p>
      )}

      {state.error && (
        <p className="mt-3 text-xs text-rose-400 font-mono leading-relaxed">{state.error}</p>
      )}

      {running && (state.messages || []).length > 0 && (
        <pre className="mt-3 max-h-32 overflow-y-auto rounded-xl bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap">
          {(state.messages || []).slice(-8).join(String.fromCharCode(10))}
        </pre>
      )}
    </div>
  );
};

const ModelHubModal = ({ isOpen, onClose, token, onModelChange }) => {
  const mobileDevice = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const [activeTab, setActiveTab] = useState(() => mobileDevice ? 'cloud' : 'local'); // 'local' | 'cloud'

  useEffect(() => {
    if (isOpen && mobileDevice) setActiveTab('cloud');
  }, [isOpen, mobileDevice]);
  const [catalog, setCatalog] = useState([]);
  const [userGpuVram, setUserGpuVram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [selectedCapability, setSelectedCapability] = useState('all');
  const [gpuTierFilter, setGpuTierFilter] = useState('all');
  // Opening the hub on the installed-only view shows an empty screen until
  // something has been downloaded, which reads as though the catalog is
  // missing. Start on the catalog and switch to installed once there is
  // actually something installed to look at.
  const [showDiscoverModels, setShowDiscoverModels] = useState(true);

  // Installing a model Ollama has but this catalogue does not.
  const [pullName, setPullName] = useState('');
  const [pullNote, setPullNote] = useState('');
  const pullByName = async () => {
    const name = pullName.trim();
    if (!name) return;
    setPullNote(`Starting ${name}…`);
    try {
      const res = await fetch(`${API_BASE}/api/models/pull`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPullNote(`Could not start: ${data?.detail || `HTTP ${res.status}`}`);
        return;
      }
      // Poll the same progress the catalogue downloads report, and pass on
      // Ollama's own words when it refuses - an unknown tag and a full disk
      // read very differently.
      const poll = setInterval(async () => {
        try {
          const s = await fetch(`${API_BASE}/api/models/download-status`, { credentials: 'include' });
          const state = (await s.json())?.downloads?.[name];
          if (!state) return;
          if (state.status === 'error') {
            clearInterval(poll);
            setPullNote(`${name} failed: ${state.error}`);
          } else if (state.status === 'complete') {
            clearInterval(poll);
            setPullNote(`${name} is installed.`);
            setPullName('');
            fetchCatalog();
          } else {
            setPullNote(`${name}: ${state.percent || 0}%${state.total_gb ? ` of ${state.total_gb} GB` : ''}`);
          }
        } catch (_) { /* keep polling */ }
      }, 1500);
    } catch (err) {
      setPullNote(`Could not start: ${String(err).slice(0, 80)}`);
    }
  };
  const pickedInitialView = useRef(false);
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
  const [cloudModels, setCloudModels] = useState({});
  const [providerModels, setProviderModels] = useState({});
  const [providerLoading, setProviderLoading] = useState({});
  const [providerErrors, setProviderErrors] = useState({});
  const [providerNotices, setProviderNotices] = useState({});

  const loadProviderModels = async (providerId, apiKey) => {
    const key = String(apiKey || '').trim();
    if (!key) return false;
    setProviderLoading((prev) => ({ ...prev, [providerId]: true }));
    setProviderErrors((prev) => ({ ...prev, [providerId]: null }));
    try {
      const res = await fetch(`${API_BASE}/api/cloud/models`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ provider: providerId, api_key: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not load provider models.');
      const models = [...new Set((data.models || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      setProviderModels((prev) => ({ ...prev, [providerId]: models }));
      setProviderNotices((prev) => ({ ...prev, [providerId]: data.notice || '' }));
      try { const cached = JSON.parse(localStorage.getItem('sm_cloud_provider_models') || '{}'); localStorage.setItem('sm_cloud_provider_models', JSON.stringify({ ...cached, [providerId]: models })); } catch (_) {}
      if (models.length) setCloudModels((prev) => ({ ...prev, [providerId]: prev[providerId] || models[0] }));
      else setProviderErrors((prev) => ({ ...prev, [providerId]: 'This key returned no selectable chat models.' }));
      return models.length > 0;
    } catch (e) { setProviderErrors((prev) => ({ ...prev, [providerId]: e.message || 'Could not load provider models.' })); return false; }
    finally { setProviderLoading((prev) => ({ ...prev, [providerId]: false })); }
  };

  const handleSaveApiKey = async (providerId, keyVal) => {
    const cleanKey = keyVal.trim();
    try {
      if (!cleanKey) {
        const removeResponse = await fetch(`${API_BASE}/api/cloud/save-key`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ provider: providerId, api_key: '' }),
        });
        if (!removeResponse.ok) throw new Error('The backend did not confirm key removal.');
        const updated = { ...apiKeys };
        delete updated[providerId];
        setApiKeys(updated);
        localStorage.setItem('sm_cloud_api_keys', JSON.stringify(updated));
        setProviderModels((prev) => { const next = { ...prev }; delete next[providerId]; return next; });
        setKeySaveNotice(`${providerId.toUpperCase()} key removed.`);
        return;
      }
      const verified = await loadProviderModels(providerId, cleanKey);
      if (verified) {
        const saveResponse = await fetch(`${API_BASE}/api/cloud/save-key`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ provider: providerId, api_key: cleanKey }),
        });
        const saveBody = await saveResponse.json().catch(() => ({}));
        if (!saveResponse.ok || saveBody.verified !== true) throw new Error(saveBody.detail || 'The backend did not confirm this provider key.');
        const updated = { ...apiKeys, [providerId]: cleanKey };
        setApiKeys(updated);
        localStorage.setItem('sm_cloud_api_keys', JSON.stringify(updated));
        setKeySaveNotice(`${providerId.toUpperCase()} provider probe passed; the key is configured for this runtime.`);
      } else {
        setKeySaveNotice(`${providerId.toUpperCase()} key was not saved because verification failed.`);
      }
      setTimeout(() => setKeySaveNotice(null), 4000);
    } catch (e) {
      console.error('Failed to save API key', e);
      setKeySaveNotice(e.message || 'Provider key was not configured.');
      setTimeout(() => setKeySaveNotice(null), 4000);
    }
  };

  const fetchCatalog = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/models/catalog`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.catalog || []);
        setUserGpuVram(Number.isFinite(data.user_gpu_vram_gb) && data.user_gpu_vram_gb > 0 ? data.user_gpu_vram_gb : null);
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
      const provider = CLOUD_PROVIDERS.find((item) => item.id === providerId);
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

  const handleDownload = async (modelId, acceptHardwareLimits = false) => {
    setDownloadingMap((prev) => ({ ...prev, [modelId]: true }));
    setProgressMap((prev) => ({ ...prev, [modelId]: { percent: 0, speed_mbps: 0, downloaded_mb: 0, total_mb: 0, eta_secs: 0, status: 'starting' } }));
    try {
      const res = await fetch(`${API_BASE}/api/models/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: modelId,
          hf_token: apiKeys.huggingface || '',
          accept_hardware_limits: acceptHardwareLimits,
        }),
      });

      // 412: the model is larger than this machine can hold. The backend says
      // exactly what will happen - slower, or will not load at all - and this
      // asks rather than deciding. Several gigabytes are about to be fetched;
      // that is worth one question.
      if (res.status === 412) {
        const detail = (await res.json().catch(() => null))?.detail
          || 'This model is larger than this machine can hold.';
        setDownloadingMap((prev) => ({ ...prev, [modelId]: false }));
        setProgressMap((prev) => { const next = { ...prev }; delete next[modelId]; return next; });
        if (window.confirm(`${detail}

Download it anyway?`)) {
          handleDownload(modelId, true);
        }
        return;
      }

      if (res.ok) {
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_BASE}/api/models/download-status`, {
              headers: {  },
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

  // If this machine already has models on disk, open on those instead;
  // otherwise the catalog stays in front so the hub is never blank.
  useEffect(() => {
    if (pickedInitialView.current || !catalog.length) return;
    pickedInitialView.current = true;
    if (catalog.some((m) => m.is_downloaded)) setShowDiscoverModels(false);
  }, [catalog]);

  if (!isOpen) return null;

  // Every publisher present in the catalog gets a chip. The audio and video
  // models come from smaller labs, and without these they were reachable
  // only under 'All Companies'.
  const companies = ['all', 'huggingface', 'alibaba', 'deepseek', 'meta', 'google', 'microsoft',
    'mistral', 'nvidia', 'ibm', 'glm', 'kimi', 'minimax', 'openai', 'opengvlab',
    'lightricks', 'genmo', 'hexgrad'];
  const capabilitiesList = [
    { id: 'all', label: 'All Capabilities' },
    { id: 'Text', label: 'Text' },
    { id: 'Vision', label: '👁️ Vision' },
    { id: 'Video', label: '📹 Video' },
    { id: 'Audio', label: '🎙️ Audio' },
    { id: 'Files', label: '📄 Files' },
    { id: 'Code', label: '💻 Code' },
    { id: 'Reasoning', label: '🧠 Reasoning' },
  ];

  const normalizedCompanyCode = (model) => {
    const raw = String(model.company_code || model.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const aliases = { hf: 'huggingface', huggingface: 'huggingface', qwen: 'alibaba', alibaba: 'alibaba', deepseek: 'deepseek', meta: 'meta', llama: 'meta', google: 'google', gemma: 'google', microsoft: 'microsoft', phi: 'microsoft', mistral: 'mistral', nvidia: 'nvidia', nemotron: 'nvidia', ibm: 'ibm', granite: 'ibm', zhipu: 'glm', glm: 'glm', moonshot: 'kimi', kimi: 'kimi', minimax: 'minimax', openai: 'openai', opengvlab: 'opengvlab', lightricks: 'lightricks', genmo: 'genmo', hexgrad: 'hexgrad' };
    return aliases[raw] || raw;
  };
  const filteredCatalog = catalog.filter((m) => {
    if (!showDiscoverModels && !m.is_downloaded && !downloadingMap[m.id]) return false;
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
        {/* dvh tracks the visible viewport as mobile browser bars show/hide, so
            the modal never extends under them and strand its scrollable pane. */}
        <div className="w-full max-w-6xl h-[94dvh] sm:h-auto sm:max-h-[94dvh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 text-left">
          
          {/* Main Modal Header */}
          {/* Header stays a single row at every width: stacking it on mobile
              pushed the close button onto its own line and left dead space. */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm flex flex-row items-start justify-between gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <Cpu className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-lg font-black text-white tracking-wide flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-indigo-400 bg-clip-text text-transparent font-extrabold">SMARAN</span>
                  <span className="text-white font-extrabold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 text-[10px] sm:text-xs shadow-[0_0_10px_rgba(99,102,241,0.5)]">.AI</span>
                  <span className="text-zinc-200 sm:ml-1 font-bold">Model Hub & Cloud APIs</span>
                </h2>
                <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5">
                  Installed local models and provider-confirmed cloud model access.
                </p>
              </div>
            </div>

            {/* Modal Action buttons */}
            <div className="flex items-center gap-2 shrink-0">
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
          <div className="px-3 sm:px-6 pt-3 pb-0 bg-zinc-900/30 border-b border-zinc-800/80 flex items-center gap-2 shrink-0 overflow-x-auto">
            <button
              onClick={() => setActiveTab('local')}
              className={`hidden md:flex items-center gap-2 px-4 py-2.5 rounded-t-2xl text-xs font-black transition-all border-t border-x cursor-pointer ${
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
              className={`flex min-w-0 items-center gap-2 px-3 sm:px-4 py-2.5 rounded-t-2xl text-xs font-black transition-all border-t border-x cursor-pointer ${
                activeTab === 'cloud'
                  ? 'bg-zinc-950 border-zinc-800 text-amber-400 shadow-md'
                  : 'bg-zinc-900/40 border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
              <span className="flex min-w-0 items-center gap-1.5">
                <span>Cloud Provider Keys</span>
                <span className="hidden sm:inline px-2 py-0.5 text-[9px] font-black rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-black uppercase tracking-wider shadow-sm">
                  Live model probe
                </span>
              </span>
            </button>
          </div>

          {/* TAB 1: LOCAL HARDWARE MODELS */}
          {activeTab === 'local' && (
            /* On phones the filter block alone is taller than the viewport, so
               the whole tab scrolls as one. From `sm` up the filters stay put
               and only the model list scrolls. */
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain sm:overflow-hidden sm:flex sm:flex-col">
              {/* Downloading was limited to this app's catalogue, so anything
                  Ollama published that the catalogue did not list - glm4,
                  qwen3, deepseek-r1, and everything released after the
                  catalogue was written - could not be installed from here at
                  all. Ollama takes any name, so this passes one through. */}
              <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/20 shrink-0">
                <p className="text-xs font-black text-white">Install any Ollama model by name</p>
                <p className="mt-0.5 text-[10px] leading-4 text-zinc-500">
                  Anything at ollama.com/library, whether or not it is in the catalogue below.
                  Try <code className="text-zinc-400">glm4:9b</code>, <code className="text-zinc-400">qwen3:8b</code> or <code className="text-zinc-400">deepseek-r1:7b</code>.
                  Large models need memory you may not have - a 9B fits in about 6 GB once quantised, a 700B does not fit at all.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <input
                    value={pullName}
                    onChange={(e) => setPullName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') pullByName(); }}
                    placeholder="glm4:9b"
                    className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={pullByName}
                    disabled={!pullName.trim()}
                    className="shrink-0 rounded-xl bg-indigo-600 px-3.5 py-2 text-[11px] font-black text-white transition hover:bg-indigo-500 disabled:opacity-40"
                  >
                    Install
                  </button>
                </div>
                {pullNote && (
                  <p className={`mt-2 text-[11px] ${pullNote.startsWith('Could not') || pullNote.includes('failed') ? 'text-rose-400' : 'text-indigo-300'}`}>
                    {pullNote}
                  </p>
                )}
              </div>

              {/* Filter & Search Bar */}
              <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/20 space-y-4 shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black text-white">{showDiscoverModels ? 'Discover downloadable models' : 'Installed local models'}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Only completed local downloads reported by the backend appear in Installed view.</p>
                  </div>
                  <button type="button" onClick={() => setShowDiscoverModels((value) => !value)} className="px-3 py-2 rounded-xl border border-indigo-500/35 bg-indigo-500/10 text-indigo-300 text-[11px] font-black cursor-pointer">
                    {showDiscoverModels ? 'Show installed only' : 'Discover models'}
                  </button>
                </div>
                <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
                  <div className="relative w-full md:w-96">
                    <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder={typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
                        ? 'Search models…'
                        : 'Search model name, company, or capability...'}
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

                {/* Company filter — wraps onto multiple lines so every provider
                    stays visible on phones and tablets instead of hiding behind
                    a sideways scroll. */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pb-2">
                  {companies.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedCompany(c)}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-extrabold transition-all cursor-pointer ${
                        selectedCompany === c
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {COMPANY_LABELS[c] || c}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pb-2 pt-1.5 border-t border-zinc-800/40">
                  <span className="w-full sm:w-auto text-[10px] font-extrabold uppercase text-zinc-500 sm:mr-1">Capability Filter:</span>
                  {capabilitiesList.map((cap) => (
                    <button
                      key={cap.id}
                      onClick={() => setSelectedCapability(cap.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-all cursor-pointer ${
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

              {/* Model Catalog Grid — fills the space the header and filters
                  leave over. A fixed vh cap overflowed the clipped modal on
                  short screens, so the list could not be scrolled at all. */}
              <div className="p-4 sm:p-6 sm:overflow-y-auto sm:overscroll-contain sm:flex-1 sm:min-h-0 space-y-4">

                {/* Video packages.
                    The chat has been saying they are "fetched on request" for
                    a while, and POST /api/video/install has existed for just
                    as long with nothing in the interface calling it. This is
                    the request. */}
                <VideoPackages />

                {loading ? (
                  <div className="py-20 text-center text-zinc-500 text-sm font-semibold flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" /> Loading Enterprise Model Catalog...
                  </div>
                ) : filteredCatalog.length === 0 ? (
                  <div className="py-16 text-center text-zinc-500 text-sm font-semibold space-y-3">
                    <p>{showDiscoverModels ? 'No models matched your search or hardware filter.' : 'No completed local model download was detected.'}</p>
                    {!showDiscoverModels && <button type="button" onClick={() => setShowDiscoverModels(true)} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black cursor-pointer">Browse downloadable models</button>}
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
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border bg-gradient-to-r truncate whitespace-nowrap ${badgeColor}`}>
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

                            <h3 className="text-base font-black text-white leading-snug tracking-tight flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate">{m.name}</span>
                              <span className="text-xs font-extrabold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md shrink-0">
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
                                        const fmt = (mb) => mb >= 1024 ? `${safeToFixed(mb / 1024, 2) || "0"} GB` : `${Math.round(mb)} MB`;
                                        return tot > 0 ? `${fmt(dl)} / ${fmt(tot)}` : `${fmt(dl)} downloaded`;
                                      })()}
                                    </span>
                                    <div className="flex items-center gap-3">
                                      {progressMap[m.id]?.speed_mbps > 0 && (
                                        <span className="text-cyan-400">⚡ {progressMap[m.id].speed_mbps >= 1024 ? `${safeToFixed(progressMap[m.id].speed_mbps / 1024, 1) || "0"} GB/s` : `${safeToFixed(progressMap[m.id].speed_mbps, 1) || "0"} MB/s`}</span>
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
            </div>
          )}

          {/* TAB 2: CLOUD PROVIDER KEYS */}
          {activeTab === 'cloud' && (
            <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-6">
              
              {/* Informational Guidance Card */}
              <div className="p-5 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/30 via-zinc-900/80 to-purple-950/30 shadow-xl flex items-start gap-4">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
                  <Zap className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1.5 text-xs">
                  <h3 className="text-sm font-black text-amber-300 flex items-center gap-2">
                    <span>Provider-confirmed cloud models</span>
                  </h3>
                  <p className="text-zinc-300 leading-relaxed font-semibold">
                    Add a provider key to query its live model-list endpoint. A model is shown only when that provider returns it for the key. Pricing, quota, regions, and rate limits are controlled by the provider account.
                  </p>
                </div>
              </div>

{/* Provider cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CLOUD_PROVIDERS.map((provider) => {
                  const savedKey = apiKeys[provider.id] || '';
                  const providerConfirmed = (providerModels[provider.id] || []).length > 0;

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
                          <span className="text-[10px] font-black uppercase text-zinc-400">Models returned for this key:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {(providerModels[provider.id] || []).slice(0, 12).map((m) => (
                              <span key={m} className="text-[10px] font-bold text-zinc-200 bg-zinc-900/90 border border-zinc-700 px-2 py-0.5 rounded-md">
                                {m}
                              </span>
                            ))}
                            {!savedKey && <span className="text-[10px] text-zinc-500">No API key saved; no models are claimed as available.</span>}
                            {savedKey && !providerLoading[provider.id] && !(providerModels[provider.id] || []).length && <span className="text-[10px] text-amber-300">No provider-confirmed models yet. Refresh or check the key.</span>}
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
                            <span>Open provider console</span>
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
                          <div className={`text-[10px] font-extrabold flex items-center gap-1 ${providerConfirmed ? 'text-emerald-400' : 'text-zinc-400'}`}>
                            <CheckCircle2 className="w-3 h-3" /> {providerConfirmed ? `Provider probe passed for ${provider.name}` : `Key stored in this browser; ${provider.name} access is not confirmed`}
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
