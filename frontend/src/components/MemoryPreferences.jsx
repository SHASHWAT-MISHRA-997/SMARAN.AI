import React, { useEffect, useState } from 'react';
import { Brain, ArrowUp, Copy, Check, Trash2, Pencil, ExternalLink, X, Sparkles } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';
import * as localChat from '../utils/localChat';
import { isNativeApp, loadLink } from '../utils/hostLink';

const noBackend = () => isNativeApp() && !loadLink()?.url;

const MemoryPreferences = () => {
  const [searchAndReference, setSearchAndReference] = useState(
    () => localStorage.getItem('sm_mem_search_reference') === 'true'
  );
  const [generateMemory, setGenerateMemory] = useState(
    () => localStorage.getItem('sm_mem_generate') !== 'false'
  );
  const [sensitiveTopics, setSensitiveTopics] = useState(
    () => localStorage.getItem('sm_mem_sensitive') === 'true'
  );

  const [facts, setFacts] = useState([]);
  const [newFact, setNewFact] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [loading, setLoading] = useState(false);

  // Import Modal State
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importProvider, setImportProvider] = useState('chatgpt');
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const EXPORT_PROMPT = `Please export all your remembered facts, user preferences, personal context, project details, and working guidelines about me as clean JSON in the following exact format:
{
  "facts": [
    { "fact": "Preferred language is TypeScript and Python", "category": "preference" },
    { "fact": "User is building SMARAN.AI local AI assistant", "category": "project" }
  ]
}`;

  const loadFacts = async () => {
    if (noBackend()) {
      setFacts(localChat.loadFacts() || []);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory`);
      if (res.ok) {
        const data = await res.json();
        setFacts(Array.isArray(data) ? data : []);
      }
    } catch {
      setFacts(localChat.loadFacts() || []);
    }
  };

  useEffect(() => {
    loadFacts();
  }, []);

  const handleToggleSearchRef = (v) => {
    setSearchAndReference(v);
    localStorage.setItem('sm_mem_search_reference', String(v));
  };

  const handleToggleGenerate = (v) => {
    setGenerateMemory(v);
    localStorage.setItem('sm_mem_generate', String(v));
  };

  const handleToggleSensitive = (v) => {
    setSensitiveTopics(v);
    localStorage.setItem('sm_mem_sensitive', String(v));
  };

  const handleAddFact = async (e) => {
    e?.preventDefault();
    const text = newFact.trim();
    if (!text) return;
    if (noBackend()) {
      const updated = localChat.addFact(text);
      setFacts(updated);
      setNewFact('');
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact: text, category: 'manual' }),
      });
      if (res.ok) {
        const added = await res.json();
        setFacts((prev) => [added, ...prev]);
        setNewFact('');
      }
    } catch {
      // Fallback
    }
  };

  const handleDeleteFact = async (id) => {
    if (noBackend()) {
      const updated = (localChat.loadFacts() || []).filter((f) => f.id !== id);
      localChat.saveFacts?.(updated);
      setFacts(updated);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setFacts((prev) => prev.filter((f) => f.id !== id));
      }
    } catch {
      // Fallback
    }
  };

  const handleSaveEdit = async (id) => {
    if (!editingText.trim()) return;
    if (noBackend()) {
      const all = localChat.loadFacts() || [];
      const updated = all.map((f) => (f.id === id ? { ...f, fact: editingText.trim() } : f));
      localChat.saveFacts?.(updated);
      setFacts(updated);
      setEditingId(null);
      return;
    }
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/memory/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact: editingText.trim() }),
      });
      if (res.ok) {
        setFacts((prev) => prev.map((f) => (f.id === id ? { ...f, fact: editingText.trim() } : f)));
        setEditingId(null);
      }
    } catch {
      // Fallback
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(EXPORT_PROMPT);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleExecuteImport = async () => {
    setImportError('');
    setImportSuccess('');
    try {
      const parsed = JSON.parse(importJsonText);
      const rawFacts = Array.isArray(parsed) ? parsed : parsed.facts || [];
      if (!rawFacts.length) {
        setImportError('No facts array found in JSON. Format should be: { "facts": [{ "fact": "..." }] }');
        return;
      }
      const res = await fetchWithAuth(`${API_BASE}/api/memory/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: importProvider,
          facts: rawFacts,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setImportSuccess(`Successfully imported ${result.imported_count || rawFacts.length} memories from ${importProvider.toUpperCase()}!`);
        await loadFacts();
        setTimeout(() => {
          setImportModalOpen(false);
          setImportJsonText('');
          setImportSuccess('');
        }, 1500);
      } else {
        setImportError(`Server returned ${res.status}`);
      }
    } catch (err) {
      setImportError(`JSON Parse error: ${err.message}. Please paste valid JSON.`);
    }
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 max-w-2xl flex flex-col h-full">
      <div className="pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <h3 className="text-lg font-black flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-500" /> Memory
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Configure how SMARAN retrieves and updates memory across conversations.
        </p>
      </div>

      {/* 1. Search and reference chats */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Search and reference chats</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Allow SMARAN to search for relevant details in past chats.{' '}
            <a href="#learn-more" className="text-indigo-500 hover:underline">Learn more ↗</a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleToggleSearchRef(!searchAndReference)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            searchAndReference ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Search and reference chats"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              searchAndReference ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 2. Generate memory from chats */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Generate memory from chats</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Allow SMARAN to generate memory from your chats.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleToggleGenerate(!generateMemory)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            generateMemory ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Generate memory from chats"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              generateMemory ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 3. Include sensitive topics in memory */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Include sensitive topics in memory</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Allow SMARAN to save details about sensitive topics like health conditions or religious beliefs to memory.{' '}
            <a href="#learn-more" className="text-indigo-500 hover:underline">Learn more ↗</a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleToggleSensitive(!sensitiveTopics)}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
            sensitiveTopics ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          aria-label="Toggle Include sensitive topics in memory"
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
              sensitiveTopics ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* 4. Import memory from other AI providers */}
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Import memory from other AI providers</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Bring relevant context and data from another AI provider to SMARAN. We&rsquo;ll provide a prompt you can use to fetch the memory from your other account.{' '}
            <a href="#learn-more" className="text-indigo-500 hover:underline">Learn more ↗</a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportModalOpen(true)}
          className="px-3.5 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-bold transition cursor-pointer shrink-0"
        >
          Start import
        </button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800/80" />

      {/* Memory Items List */}
      <div className="flex-1 min-h-[140px] max-h-72 overflow-y-auto space-y-2 py-2">
        {facts.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-zinc-500 italic py-8">
            No files yet
          </div>
        ) : (
          facts.map((f) => (
            <div
              key={f.id}
              className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between gap-2 text-xs"
            >
              {editingId === f.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    className="flex-1 px-2 py-1 rounded bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-xs outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(f.id)}
                    className="text-emerald-500 font-bold hover:underline"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-zinc-400 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 break-words">{f.fact || f.content}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(f.id);
                        setEditingText(f.fact || f.content || '');
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                      title="Edit fact"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFact(f.id)}
                      className="p-1 text-zinc-400 hover:text-rose-500 cursor-pointer"
                      title="Delete fact"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom quick-entry input bar matching Screenshot 4 */}
      <form onSubmit={handleAddFact} className="relative mt-auto pt-2">
        <input
          type="text"
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          placeholder="Don't ask about my former baseball career"
          className="w-full pl-4 pr-11 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 shadow-inner"
        />
        <button
          type="submit"
          disabled={!newFact.trim()}
          className="absolute right-2 top-4 p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-white transition cursor-pointer disabled:cursor-not-allowed"
          title="Add memory rule"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </form>

      {/* Import Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <h4 className="text-base font-black flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" /> Import Memory from Other AI
              </h4>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Provider selector */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-zinc-400">Source Provider:</span>
              <div className="flex gap-2">
                {['chatgpt', 'claude', 'gemini'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setImportProvider(p)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition ${
                      importProvider === p
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 1: Copy Prompt */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-300">Step 1: Copy Prompt to paste into {importProvider.toUpperCase()}</span>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 text-[11px] font-bold text-indigo-400 hover:text-indigo-300"
                >
                  {copiedPrompt ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPrompt ? 'Copied!' : 'Copy Prompt'}</span>
                </button>
              </div>
              <textarea
                readOnly
                value={EXPORT_PROMPT}
                rows={4}
                className="w-full text-[11px] font-mono p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-400 select-all outline-none"
              />
            </div>

            {/* Step 2: Paste JSON */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-300">Step 2: Paste the JSON response here</span>
              <textarea
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                placeholder='{ "facts": [ { "fact": "..." } ] }'
                rows={5}
                className="w-full text-[11px] font-mono p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-100 outline-none focus:border-indigo-500"
              />
            </div>

            {importError && (
              <p className="text-xs text-rose-400 font-medium">{importError}</p>
            )}
            {importSuccess && (
              <p className="text-xs text-emerald-400 font-medium">{importSuccess}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={!importJsonText.trim()}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold shadow-md transition cursor-pointer"
              >
                Import Memories
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryPreferences;
