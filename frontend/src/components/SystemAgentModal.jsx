import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, FileSearch, LoaderCircle, MonitorCog,
  Play, ShieldCheck, Trash2, Wrench, X,
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';


function storedJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch (_) { return fallback; }
}

function errorMessage(payload, fallback) {
  const detail = payload?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail.message === 'string') return detail.message;
  if (typeof payload?.error === 'string') return payload.error;
  return fallback;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) { /* handled below */ }
  if (!response.ok) throw new Error(errorMessage(payload, `Request failed with HTTP ${response.status}.`));
  return payload;
}

function ValueBlock({ value }) {
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-black/30 p-3 text-[11px] leading-5 text-zinc-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ListSection({ title, items }) {
  if (!items?.length) return null;
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-400">{title}</h4>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm leading-6 text-zinc-200">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SystemAgentModal({ isOpen, onClose, selectedModel = 'auto' }) {
  const [status, setStatus] = useState(null);
  const [problem, setProblem] = useState('');
  const [diagnosis, setDiagnosis] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState('collect_system_summary');
  const [params, setParams] = useState({});
  const [preview, setPreview] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    jsonRequest('/api/system-agent/status')
      .then((value) => { if (active) setStatus(value); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [isOpen]);

  const actions = status?.actions || [];
  const action = useMemo(() => actions.find((item) => item.id === operation), [actions, operation]);
  const modelLabel = selectedModel.startsWith('cloud:') ? `Cloud: ${selectedModel.slice(6)}` : `Local: ${selectedModel}`;

  if (!isOpen) return null;

  function modelPayload() {
    if (!selectedModel.startsWith('cloud:')) return { model: selectedModel, selected_model: selectedModel };
    const [, provider, ...parts] = selectedModel.split(':');
    const model = parts.join(':');
    const keys = storedJson('sm_cloud_api_keys', {});
    return {
      model: selectedModel,
      selected_model: selectedModel,
      cloud_provider: provider,
      cloud_model: model,
      cloud_api_key: keys[provider] || '',
    };
  }

  async function runDiagnosis() {
    if (problem.trim().length < 5) {
      setError('Paste the complete error, warning, script output, or problem description first.');
      return;
    }
    setDiagnosing(true);
    setError('');
    setDiagnosis(null);
    try {
      const value = await jsonRequest('/api/system-agent/diagnose', {
        method: 'POST',
        body: JSON.stringify({ input: problem, ...modelPayload() }),
      });
      setDiagnosis(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setDiagnosing(false);
    }
  }

  function changeOperation(next) {
    setOperation(next);
    setParams({});
    setPreview(null);
    setActionResult(null);
    setConfirmed(false);
    setError('');
  }

  function parameterValue(name) {
    return params[name] ?? '';
  }

  function setParameter(name, value) {
    setParams((current) => ({ ...current, [name]: name === 'pid' && value !== '' ? Number(value) : value }));
    setPreview(null);
    setActionResult(null);
    setConfirmed(false);
  }

  async function previewAction(nextOperation = operation, nextParams = params) {
    setActionBusy(true);
    setError('');
    setActionResult(null);
    setConfirmed(false);
    if (nextOperation !== operation) {
      setOperation(nextOperation);
      setParams(nextParams || {});
    }
    try {
      const value = await jsonRequest('/api/system-agent/actions/preview', {
        method: 'POST',
        body: JSON.stringify({ operation: nextOperation, params: nextParams || {} }),
      });
      setPreview(value);
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function executeAction() {
    if (!preview?.changes_system || !confirmed) return;
    setActionBusy(true);
    setError('');
    try {
      const value = await jsonRequest('/api/system-agent/actions/execute', {
        method: 'POST',
        body: JSON.stringify({
          operation: preview.operation,
          params: preview.params,
          confirmation_token: preview.confirmation_token,
          confirmation_expires_at: preview.confirmation_expires_at,
          confirmed: true,
        }),
      });
      setActionResult(value);
      setPreview(null);
      setConfirmed(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="System diagnostic agent">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-700/80 bg-[#111216] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
              <MonitorCog className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">System Diagnostic Agent</h2>
              <p className="text-[11px] text-zinc-400">Diagnose first. Review every machine action before it runs.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Close system diagnostic agent">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.08fr_.92fr]">
          <section className="space-y-5 border-b border-zinc-800 p-5 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-300"><Wrench className="h-4 w-4 text-indigo-300" /> Error and warning diagnosis</div>
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[10px] font-bold text-zinc-300">{modelLabel}</span>
            </div>
            <textarea
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              maxLength={16000}
              className="h-52 w-full resize-y rounded-2xl border border-zinc-700 bg-black/35 p-4 font-mono text-xs leading-6 text-zinc-100 outline-none focus:border-indigo-400"
              placeholder="Paste an exact Windows error, PowerShell or CMD warning, script output, or describe the device problem. Secrets should be removed before pasting."
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] leading-4 text-zinc-500">The pasted text is treated as untrusted data. Diagnosis does not execute it.</p>
              <button type="button" disabled={diagnosing} onClick={runDiagnosis} className="flex shrink-0 items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-400 disabled:opacity-50">
                {diagnosing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                Diagnose
              </button>
            </div>

            {error && (
              <div className="flex gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs leading-5 text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
              </div>
            )}

            {diagnosis?.diagnosis && (
              <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div>
                  <h3 className="text-sm font-black text-white">Diagnosis</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-200">{diagnosis.diagnosis.summary}</p>
                  <p className="mt-2 text-[10px] text-zinc-500">Used {diagnosis.model?.provider} / {diagnosis.model?.id}. No machine action was performed.</p>
                </div>
                <ListSection title="Evidence from your text" items={diagnosis.diagnosis.evidence} />
                <ListSection title="Likely causes" items={diagnosis.diagnosis.likely_causes} />
                <ListSection title="Safe next steps" items={diagnosis.diagnosis.safe_steps} />
                <ListSection title="Questions needed" items={diagnosis.diagnosis.questions} />
                {!!diagnosis.diagnosis.suggested_actions?.length && (
                  <section>
                    <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-400">Reviewed actions available</h4>
                    <div className="space-y-2">
                      {diagnosis.diagnosis.suggested_actions.map((item, index) => (
                        <button key={`${item.operation}-${index}`} type="button" onClick={() => previewAction(item.operation, item.params)} className="flex w-full items-center justify-between rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-left text-xs font-bold text-indigo-200 hover:bg-indigo-500/20">
                          <span>{item.title}</span><span className="text-[10px] uppercase text-indigo-300">Preview</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </section>

          <section className="space-y-5 p-5">
            <div className={`rounded-2xl border p-4 ${status?.host_bridge?.available ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
              <div className="flex items-start gap-3">
                {status?.host_bridge?.available ? <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />}
                <div>
                  <p className={`text-xs font-black ${status?.host_bridge?.available ? 'text-emerald-200' : 'text-amber-200'}`}>{status?.host_bridge?.available ? 'Windows host bridge connected' : 'Host actions unavailable'}</p>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-300">{status?.host_bridge?.message || 'Checking desktop launcher connection...'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-black text-white">Reviewed machine action</h3>
                <p className="mt-1 text-[11px] leading-5 text-zinc-500">Arbitrary CMD and PowerShell commands are not accepted. Choose a validated operation.</p>
              </div>
              <select value={operation} onChange={(event) => changeOperation(event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-xs font-bold text-zinc-100 outline-none focus:border-indigo-400">
                {actions.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.risk.replace('_', ' ')}</option>)}
              </select>

              {action && Object.entries(action.parameters || {}).map(([name, description]) => (
                <label key={name} className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-zinc-400">{description}</span>
                  <input
                    type={name === 'pid' ? 'number' : 'text'}
                    value={parameterValue(name)}
                    onChange={(event) => setParameter(name, event.target.value)}
                    placeholder={name === 'path' ? 'C:\\Users\\You\\Downloads\\example.txt' : name === 'pid' ? '1234' : 'Optional filter'}
                    className="w-full rounded-xl border border-zinc-700 bg-black/35 px-3 py-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-400"
                  />
                </label>
              ))}

              <button type="button" disabled={actionBusy || !status?.host_bridge?.available} onClick={() => previewAction()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2.5 text-xs font-black text-indigo-200 hover:bg-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-40">
                {actionBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                Preview action
              </button>
            </div>

            {preview && (
              <div className={`space-y-3 rounded-2xl border p-4 ${preview.changes_system ? 'border-amber-500/35 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black text-white">{preview.changes_system ? 'Confirmation required' : 'Read-only result'}</p>
                  <span className="rounded-full border border-current/20 px-2 py-1 text-[9px] font-black uppercase text-zinc-300">{preview.risk.replace('_', ' ')}</span>
                </div>
                <ValueBlock value={preview.preview} />
                {preview.changes_system && (
                  <>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/25 bg-black/20 p-3">
                      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                      <span className="text-[11px] leading-5 text-amber-100">I reviewed the exact target and effect above, and I explicitly authorize this one action.</span>
                    </label>
                    <button type="button" disabled={!confirmed || actionBusy} onClick={executeAction} className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-zinc-950 hover:bg-amber-400 disabled:opacity-40">
                      {preview.operation === 'move_path_to_recycle_bin' ? <Trash2 className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      Confirm and run once
                    </button>
                  </>
                )}
              </div>
            )}

            {actionResult && (
              <div className={`space-y-3 rounded-2xl border p-4 ${actionResult.success ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
                <div className="flex items-center gap-2 text-xs font-black text-white">
                  {actionResult.success ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-rose-300" />}
                  {actionResult.success ? 'Action completed' : 'Action failed'}
                </div>
                {actionResult.message && <p className="text-xs text-zinc-200">{actionResult.message}</p>}
                <ValueBlock value={actionResult} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
