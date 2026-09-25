import React, { useState } from 'react';
import { CheckCircle2, XCircle, FileText, Pencil, Terminal, GitBranch, Search, FolderTree, Loader2, ShieldQuestion, ChevronDown, ChevronRight, Brain, Camera } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { summarize } from '../utils/agentEvents.js';

/**
 * What SMARAN Code did, step by step - the part that makes it a coding agent
 * and not a chat reply. Each tool call is shown with its arguments and what
 * came back; a change waiting for approval shows exactly what it will do,
 * with Allow and Deny.
 *
 *   steps: [{ step, name, arguments, result, status: 'running'|'waiting'|'done'|'declined' }]
 *   runId: the agent run, for /api/agent/approve
 */

const ICONS = {
  read_file: FileText, write_file: Pencil, edit_file: Pencil, run_command: Terminal, git: GitBranch,
  search: Search, list_files: FolderTree, search_memory: Brain, save_memory: Brain, snapshot: Camera,
  restore_snapshot: Camera, create_skill: Brain,
};

function Detail({ name, args }) {
  if (name === 'edit_file') {
    return (
      <div className="space-y-1">
        <pre className="overflow-x-auto rounded-lg bg-rose-500/10 p-2 text-[11px] text-rose-200 whitespace-pre-wrap">- {args.find}</pre>
        <pre className="overflow-x-auto rounded-lg bg-emerald-500/10 p-2 text-[11px] text-emerald-200 whitespace-pre-wrap">+ {args.replace}</pre>
      </div>
    );
  }
  if (name === 'write_file') {
    return <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-950 p-2 text-[11px] text-zinc-300 whitespace-pre-wrap">{String(args.content || '').slice(0, 6000)}</pre>;
  }
  if (name === 'run_command' || name === 'git') {
    return <pre className="rounded-lg bg-zinc-950 p-2 font-mono text-[11px] text-amber-200 whitespace-pre-wrap">$ {name === 'git' ? `git ${args.subcommand}` : args.command}</pre>;
  }
  return null;
}

function Step({ item, runId }) {
  const [open, setOpen] = useState(item.status === 'waiting');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const Icon = ICONS[item.name] || Terminal;

  const decide = async (approve) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/agent/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, step: item.step, approve }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const state = {
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />,
    waiting: <ShieldQuestion className="h-3.5 w-3.5 text-amber-400" />,
    done: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    declined: <XCircle className="h-3.5 w-3.5 text-rose-400" />,
  }[item.status];

  return (
    <div className={`rounded-xl border ${item.status === 'waiting' ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-200">{summarize(item.name, item.arguments)}</span>
        {state}
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800 px-3 py-2">
          <Detail name={item.name} args={item.arguments || {}} />
          {item.status === 'waiting' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-amber-300">SMARAN Code wants to do this. Allow it?</span>
              <button type="button" disabled={busy} onClick={() => decide(true)} className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-black text-white hover:bg-emerald-500 disabled:opacity-50">Allow</button>
              <button type="button" disabled={busy} onClick={() => decide(false)} className="rounded-lg border border-rose-500/50 px-3 py-1 text-[11px] font-black text-rose-300 hover:bg-rose-600 hover:text-white disabled:opacity-50">Deny</button>
              {error && <span className="text-[11px] text-rose-400">{error}</span>}
            </div>
          )}
          {item.result != null && (
            <pre className="max-h-56 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap">{String(item.result).slice(0, 8000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentSteps({ steps, runId, live }) {
  if (!steps?.length) return live ? <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> SMARAN Code is reading the task…</p> : null;
  return (
    <div className="mb-3 space-y-1.5" aria-label="SMARAN Code steps">
      {steps.map((item) => <Step key={item.step} item={item} runId={runId} />)}
    </div>
  );
}
