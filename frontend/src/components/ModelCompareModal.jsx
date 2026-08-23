import React, { useEffect, useMemo, useState } from 'react';
import { BarChart2, Check, Copy, Key, RefreshCw, Sparkles, X, Zap } from 'lucide-react';

const PROVIDERS = [
  ['groq', 'Groq'],
  ['openrouter', 'OpenRouter'],
  ['huggingface', 'Hugging Face'],
  ['gemini', 'Google Gemini'],
  ['deepseek', 'DeepSeek'],
  ['together', 'Together AI'],
  ['cerebras', 'Cerebras'],
  ['sambanova', 'SambaNova'],
  ['mistral', 'Mistral AI'],
  ['nvidia', 'NVIDIA NIM'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
];

const providerLabel = (provider) => PROVIDERS.find(([id]) => id === provider)?.[1] || provider;

const authHeaders = (token, includeJson = false) => ({
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const readSavedKeys = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem('sm_cloud_api_keys') || '{}');
    return Object.fromEntries(
      Object.entries(parsed || {}).filter(([, value]) => String(value || '').trim()),
    );
  } catch {
    return {};
  }
};

const CompareContentRenderer = ({ content }) => {
  if (!content) return <p className="text-xs text-zinc-500">Provider returned an empty response.</p>;
  return (
    <div className="space-y-2">
      {String(content).split(/```/).map((part, index) => {
        if (index % 2 === 1) {
          const lines = part.trim().split('\n');
          const code = lines.slice(1).join('\n') || lines[0];
          return <pre key={index} className="p-2.5 bg-black/70 border border-zinc-800 rounded-xl font-mono text-[11px] text-indigo-300 overflow-x-auto"><code>{code}</code></pre>;
        }
        return <p key={index} className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">{part}</p>;
      })}
    </div>
  );
};

export default function ModelCompareModal({ isOpen, onClose, initialPrompt = '', token, apiBase }) {
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [comparing, setComparing] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [activeProviderTab, setActiveProviderTab] = useState('all');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [quickKeyProvider, setQuickKeyProvider] = useState('groq');
  const [quickKeyValue, setQuickKeyValue] = useState('');
  const [keyNotice, setKeyNotice] = useState('');
  const [keyNoticeType, setKeyNoticeType] = useState('info');
  const [apiKeys, setApiKeys] = useState(readSavedKeys);
  const [providerModels, setProviderModels] = useState({});
  const [providerErrors, setProviderErrors] = useState({});
  const [probingProviders, setProbingProviders] = useState({});

  const probeProvider = async (provider, apiKey) => {
    const response = await fetch(`${apiBase || ''}/api/cloud/models`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(token, true),
      body: JSON.stringify({ provider, api_key: String(apiKey || '').trim() }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `${providerLabel(provider)} probe failed (${response.status})`);
    const models = Array.from(new Set((body.models || []).map((model) => String(model).trim()).filter(Boolean)));
    if (!models.length) throw new Error(`${providerLabel(provider)} returned no selectable models for this key.`);
    return models;
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const savedKeys = readSavedKeys();
    setApiKeys(savedKeys);
    setProviderModels({});
    setProviderErrors({});
    const entries = Object.entries(savedKeys);
    if (!entries.length) {
      setShowKeyInput(true);
      return () => { cancelled = true; };
    }

    entries.forEach(async ([provider, apiKey]) => {
      setProbingProviders((previous) => ({ ...previous, [provider]: true }));
      try {
        const models = await probeProvider(provider, apiKey);
        if (!cancelled) setProviderModels((previous) => ({ ...previous, [provider]: models }));
      } catch (probeError) {
        if (!cancelled) {
          setProviderErrors((previous) => ({ ...previous, [provider]: probeError.message }));
          setProviderModels((previous) => {
            const next = { ...previous };
            delete next[provider];
            return next;
          });
        }
      } finally {
        if (!cancelled) setProbingProviders((previous) => ({ ...previous, [provider]: false }));
      }
    });
    return () => { cancelled = true; };
  }, [isOpen, token, apiBase]);

  const allModels = useMemo(() => Object.entries(providerModels).flatMap(([provider, models]) => (
    models.map((model) => ({
      provider,
      model,
      label: `${providerLabel(provider)} - ${model}`,
      api_key: apiKeys[provider] || '',
    }))
  )), [providerModels, apiKeys]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedModels((previous) => {
      const stillConfirmed = previous.filter((selected) => allModels.some(
        (model) => model.provider === selected.provider && model.model === selected.model,
      ));
      return stillConfirmed.length ? stillConfirmed.slice(0, 4) : allModels.slice(0, 3);
    });
    if (initialPrompt && !prompt) setPrompt(initialPrompt);
  }, [isOpen, initialPrompt, allModels]);

  if (!isOpen) return null;

  const filteredModels = activeProviderTab === 'all'
    ? allModels
    : allModels.filter((model) => model.provider === activeProviderTab);
  const confirmedProviders = Object.keys(providerModels).filter((provider) => providerModels[provider]?.length);
  const anyProbeRunning = Object.values(probingProviders).some(Boolean);

  const handleSaveQuickKey = async (event) => {
    event.preventDefault();
    const cleanKey = quickKeyValue.trim();
    if (!cleanKey) return;
    setKeyNoticeType('info');
    setKeyNotice(`Checking ${providerLabel(quickKeyProvider)} model access...`);
    setProbingProviders((previous) => ({ ...previous, [quickKeyProvider]: true }));
    try {
      const models = await probeProvider(quickKeyProvider, cleanKey);
      const saveResponse = await fetch(`${apiBase || ''}/api/cloud/save-key`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(token, true),
        body: JSON.stringify({ provider: quickKeyProvider, api_key: cleanKey }),
      });
      const saveBody = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || saveBody.verified !== true) {
        throw new Error(saveBody.detail || 'The backend did not confirm this provider key.');
      }

      const updatedKeys = { ...apiKeys, [quickKeyProvider]: cleanKey };
      setApiKeys(updatedKeys);
      localStorage.setItem('sm_cloud_api_keys', JSON.stringify(updatedKeys));
      setProviderModels((previous) => ({ ...previous, [quickKeyProvider]: models }));
      setProviderErrors((previous) => ({ ...previous, [quickKeyProvider]: '' }));
      setQuickKeyValue('');
      setKeyNoticeType('success');
      setKeyNotice(`${providerLabel(quickKeyProvider)} confirmed ${models.length} selectable model${models.length === 1 ? '' : 's'}.`);
    } catch (saveError) {
      setKeyNoticeType('error');
      setKeyNotice(saveError.message || 'Provider verification failed. The key was not saved.');
    } finally {
      setProbingProviders((previous) => ({ ...previous, [quickKeyProvider]: false }));
    }
  };

  const handleToggleModel = (model) => {
    const selected = selectedModels.some((item) => item.provider === model.provider && item.model === model.model);
    if (selected) {
      setSelectedModels((previous) => previous.filter((item) => !(item.provider === model.provider && item.model === model.model)));
      return;
    }
    if (selectedModels.length >= 4) {
      setKeyNoticeType('error');
      setKeyNotice('Select at most four models.');
      return;
    }
    setSelectedModels((previous) => [...previous, model]);
  };

  const handleRunComparison = async () => {
    if (!prompt.trim() || !selectedModels.length) return;
    const noLongerConfirmed = selectedModels.find((selected) => !providerModels[selected.provider]?.includes(selected.model));
    if (noLongerConfirmed) {
      setKeyNoticeType('error');
      setKeyNotice(`${noLongerConfirmed.model} is no longer in the provider-confirmed list.`);
      return;
    }
    setComparing(true);
    setResults([]);
    try {
      const response = await fetch(`${apiBase || ''}/api/models/compare`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(token, true),
        body: JSON.stringify({
          prompt: prompt.trim(),
          models: selectedModels.map((model) => ({
            provider: model.provider,
            model: model.model,
            api_key: apiKeys[model.provider] || '',
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Comparison failed (${response.status})`);
      setResults(body.results || []);
    } catch (comparisonError) {
      setKeyNoticeType('error');
      setKeyNotice(comparisonError.message || 'Comparison request failed.');
    } finally {
      setComparing(false);
    }
  };

  const handleCopy = async (text, index) => {
    await navigator.clipboard.writeText(String(text || ''));
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex(null), 2000);
  };

  const successfulResults = results.filter((result) => result.status === 'success');
  const measuredLatencies = successfulResults.map((result) => Number(result.latency_ms)).filter((value) => Number.isFinite(value) && value >= 0);
  const measuredThroughputs = successfulResults.map((result) => Number(result.tokens_per_sec)).filter((value) => Number.isFinite(value) && value > 0);
  const fastestLatency = measuredLatencies.length ? Math.min(...measuredLatencies) : null;
  const highestThroughput = measuredThroughputs.length ? Math.max(...measuredThroughputs) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-1.5 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-zinc-950 border border-indigo-500/30 rounded-2xl sm:rounded-3xl w-full max-w-[calc(100vw-12px)] sm:max-w-6xl max-h-[94vh] flex flex-col shadow-[0_0_80px_rgba(99,102,241,0.25)] overflow-hidden">
        <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-zinc-800 bg-zinc-900/60 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 shrink-0"><BarChart2 className="w-5 h-5" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-lg font-black text-white">Provider-Confirmed Model Compare</h2>
                <span className="px-2 py-0.5 text-[9px] font-extrabold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">{allModels.length} MODELS CONFIRMED</span>
                {confirmedProviders.length > 0 && <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full">{confirmedProviders.length} PROVIDER PROBE{confirmedProviders.length === 1 ? '' : 'S'} PASSED</span>}
              </div>
              <p className="text-[10px] sm:text-xs text-zinc-400 truncate">Models appear only after the provider returns them for the supplied key.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setShowKeyInput((value) => !value)} className="px-2.5 py-1.5 text-xs font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 rounded-xl flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /><span className="hidden sm:inline">Provider keys</span></button>
            <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-white rounded-xl" aria-label="Close compare"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {showKeyInput && (
          <div className="px-4 py-3 bg-zinc-900 border-b border-indigo-500/25 space-y-2">
            <form onSubmit={handleSaveQuickKey} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-indigo-300 font-bold shrink-0"><Key className="w-4 h-4" />Provider key</span>
              <select value={quickKeyProvider} onChange={(event) => setQuickKeyProvider(event.target.value)} className="bg-zinc-950 border border-zinc-700 text-zinc-100 font-bold px-2 py-2 rounded-lg text-xs">
                {PROVIDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <input type="password" autoComplete="off" value={quickKeyValue} onChange={(event) => setQuickKeyValue(event.target.value)} placeholder={`Paste ${providerLabel(quickKeyProvider)} API key`} className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 focus:border-indigo-500 text-zinc-100 px-3 py-2 rounded-lg text-xs font-mono" />
              <button type="submit" disabled={probingProviders[quickKeyProvider] || !quickKeyValue.trim()} className="px-3 py-2 bg-indigo-600 disabled:opacity-40 text-white font-black rounded-lg text-xs shrink-0">{probingProviders[quickKeyProvider] ? 'Checking...' : 'Verify & configure'}</button>
            </form>
            <p className="text-[10px] text-zinc-500">Pricing, quota, region, and rate limits are controlled by the provider account; this screen makes no free-access promise.</p>
          </div>
        )}

        {(keyNotice || Object.values(providerErrors).some(Boolean)) && (
          <div className={`px-4 py-2 border-b text-[11px] ${keyNoticeType === 'error' ? 'bg-rose-500/10 border-rose-500/25 text-rose-300' : keyNoticeType === 'success' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-indigo-500/10 border-indigo-500/25 text-indigo-300'}`}>
            {keyNotice || Object.values(providerErrors).filter(Boolean)[0]}
          </div>
        )}

        <div className="p-3 sm:p-5 border-b border-zinc-800 bg-zinc-900/30 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-zinc-400 uppercase">Provider</span>
              <button type="button" onClick={() => setActiveProviderTab('all')} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${activeProviderTab === 'all' ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'}`}>All ({allModels.length})</button>
              {confirmedProviders.map((provider) => (
                <button key={provider} type="button" onClick={() => setActiveProviderTab(provider)} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${activeProviderTab === provider ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'}`}>{providerLabel(provider)} ({providerModels[provider].length})</button>
              ))}
              {anyProbeRunning && <span className="text-[10px] text-indigo-300 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />Checking saved keys</span>}
            </div>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-lg">{selectedModels.length} / 4 selected</span>
          </div>

          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
            {filteredModels.map((model) => {
              const selected = selectedModels.some((item) => item.provider === model.provider && item.model === model.model);
              return (
                <button key={`${model.provider}-${model.model}`} type="button" onClick={() => handleToggleModel(model)} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border max-w-full ${selected ? 'bg-indigo-600/30 border-indigo-400 text-indigo-100' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${selected ? 'bg-indigo-400' : 'bg-emerald-500'}`} /><span className="truncate max-w-[260px]">{model.label}</span>{selected && <Check className="w-3.5 h-3.5" />}
                </button>
              );
            })}
            {!filteredModels.length && !anyProbeRunning && <div className="w-full py-5 text-center text-xs text-zinc-500">No provider-confirmed models. Add a key and pass the provider probe.</div>}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input type="text" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && !comparing && handleRunComparison()} placeholder="Question or coding task" className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm text-zinc-100 focus:border-indigo-500 outline-none" />
            <button type="button" disabled={comparing || !prompt.trim() || !selectedModels.length} onClick={handleRunComparison} className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-black rounded-xl disabled:opacity-40 flex items-center justify-center gap-2">{comparing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{comparing ? 'Running provider requests...' : 'Compare selected'}</button>
          </div>
        </div>

        <div className="flex-1 p-3 sm:p-6 overflow-y-auto">
          {comparing ? (
            <div className="py-20 flex flex-col items-center gap-3 text-center"><RefreshCw className="w-10 h-10 text-indigo-400 animate-spin" /><h3 className="text-sm font-black text-zinc-200">Running {selectedModels.length} selected provider request{selectedModels.length === 1 ? '' : 's'}</h3><p className="text-xs text-zinc-500">Elapsed time is measured locally. Token throughput appears only when the provider reports completion-token usage.</p></div>
          ) : results.length ? (
            <div className={`grid grid-cols-1 ${results.length === 2 ? 'md:grid-cols-2' : results.length === 3 ? 'md:grid-cols-3' : results.length >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' : ''} gap-3 sm:gap-4`}>
              {results.map((result, index) => {
                const latency = Number(result.latency_ms);
                const throughput = Number(result.tokens_per_sec);
                const isFastest = result.status === 'success' && fastestLatency !== null && Number.isFinite(latency) && latency === fastestLatency;
                const isHighestThroughput = result.status === 'success' && highestThroughput !== null && Number.isFinite(throughput) && throughput === highestThroughput;
                return (
                  <div key={`${result.provider}-${result.model}-${index}`} className="flex flex-col bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3.5 sm:p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 pb-3 border-b border-zinc-800">
                      <div className="min-w-0"><div className="flex items-center gap-1.5 flex-wrap"><span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">{result.provider}</span>{isFastest && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300"><Zap className="w-2.5 h-2.5 inline" /> Lowest elapsed time</span>}{isHighestThroughput && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Highest measured t/s</span>}</div><h4 className="text-xs font-black text-zinc-100 mt-1 break-all">{result.model}</h4></div>
                      <button type="button" onClick={() => handleCopy(result.content, index)} className="p-1.5 text-zinc-400 hover:text-white shrink-0" aria-label="Copy response">{copiedIndex === index ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}</button>
                    </div>
                    {result.status === 'success' && (
                      <div className="grid grid-cols-3 gap-1 py-2 my-2 bg-zinc-950/60 rounded-xl border border-zinc-800 text-center font-mono text-[10px]">
                        <div><span className="text-zinc-500 block text-[8px] uppercase">Elapsed</span><span className="font-bold text-amber-300">{Number.isFinite(latency) ? `${latency} ms` : 'Unavailable'}</span></div>
                        <div><span className="text-zinc-500 block text-[8px] uppercase">Provider t/s</span><span className="font-bold text-emerald-300">{Number.isFinite(throughput) && throughput > 0 ? throughput : 'Unavailable'}</span></div>
                        <div><span className="text-zinc-500 block text-[8px] uppercase">Output tokens</span><span className="font-bold text-cyan-300">{Number.isFinite(Number(result.tokens)) && Number(result.tokens) > 0 ? result.tokens : 'Unavailable'}</span></div>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto max-h-[50vh] pr-1 py-1">{result.status === 'success' ? <CompareContentRenderer content={result.content} /> : <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-xl text-xs text-rose-300"><p className="font-bold">Provider request failed</p><p className="text-[11px] font-mono break-words mt-1">{result.content}</p></div>}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-20 flex flex-col items-center gap-3 text-center"><div className="p-4 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400"><BarChart2 className="w-8 h-8" /></div><h3 className="text-sm font-black text-zinc-200">No comparison results</h3><p className="text-xs text-zinc-500 max-w-md">Only models confirmed by a live provider model-list response can be selected.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
