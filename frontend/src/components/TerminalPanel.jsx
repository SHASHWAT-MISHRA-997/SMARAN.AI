import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalSquare, X, Loader2, ShieldAlert } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * A terminal.
 *
 * There was not one before. What looked like one on the extensions screen -
 * "PowerShell & Terminal Executor", listed as Running - was a name in a
 * hardcoded array with nothing behind it.
 *
 * What you type runs: your machine, your shell, no allowlist and no
 * confirmation, because an allowlist would defeat the reason you opened a
 * terminal. What the model produces does not run - it arrives as a block with
 * an Approve button, because a model can be wrong and it reads pages and
 * documents that can carry instructions written to be obeyed.
 */
const TerminalPanel = ({ isOpen, onClose }) => {
  const [lines, setLines] = useState([]);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [context, setContext] = useState(null);
  const [pending, setPending] = useState(null);
  // Up and down through what you have typed, like any other shell.
  const [history, setHistory] = useState([]);
  const [historyAt, setHistoryAt] = useState(-1);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/terminal/context`, { credentials: 'include' });
        if (res.ok) setContext(await res.json());
      } catch (_) { /* the header just stays quiet */ }
    })();
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    // Follow the output, the way a terminal does.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const send = useCallback(async (text, source = 'user') => {
    const trimmed = (text || '').trim();
    if (!trimmed || running) return;
    setRunning(true);
    setPending(null);
    setLines((previous) => [...previous, { kind: 'command', text: trimmed }]);

    try {
      const res = await fetch(`${API_BASE}/api/terminal/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed, source }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        setLines((p) => [...p, { kind: 'error', text: detail?.detail || `HTTP ${res.status}` }]);
        return;
      }

      // Output is streamed line by line rather than buffered, so a long build
      // shows progress instead of sitting blank until it ends.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const parts = carry.split('\n');
        carry = parts.pop() || '';
        for (const part of parts) {
          if (!part.trim()) continue;
          let event;
          try { event = JSON.parse(part); } catch (_) { continue; }
          if (event.type === 'needs_approval') {
            setPending(event);
          } else if (event.type === 'output') {
            setLines((p) => [...p, { kind: 'output', text: event.text }]);
          } else if (event.type === 'error') {
            setLines((p) => [...p, { kind: 'error', text: event.text }]);
          } else if (event.type === 'exit') {
            setLines((p) => [...p, { kind: event.code === 0 ? 'exit' : 'error', text: event.text }]);
          }
        }
      }
    } catch (err) {
      setLines((p) => [...p, { kind: 'error', text: String(err).slice(0, 200) }]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }, [running]);

  const submit = (event) => {
    event.preventDefault();
    const text = command.trim();
    if (!text) return;
    setHistory((h) => [text, ...h.filter((x) => x !== text)].slice(0, 100));
    setHistoryAt(-1);
    setCommand('');
    send(text, 'user');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:h-[70vh] sm:rounded-2xl">

        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <TerminalSquare className="h-4 w-4 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-white">Terminal</p>
            <p className="truncate font-mono text-[10px] text-zinc-500">
              {context ? `${context.shell} · ${context.cwd}` : 'Asking where commands will run…'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close terminal"
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
          {lines.length === 0 && (
            <p className="text-zinc-600">
              Type a command. It runs in {context?.shell || 'your shell'}, as you, with no
              allowlist — this is your machine.
            </p>
          )}
          {lines.map((line, index) => (
            <pre key={index} className={`whitespace-pre-wrap break-words ${
              line.kind === 'command' ? 'mt-2 font-bold text-cyan-300'
                : line.kind === 'error' ? 'text-rose-400'
                : line.kind === 'exit' ? 'text-zinc-500'
                : 'text-zinc-300'
            }`}>
              {line.kind === 'command' ? `> ${line.text}` : line.text}
            </pre>
          ))}
          {running && (
            <p className="mt-1 flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> running…
            </p>
          )}
        </div>

        {/* A command the model wrote. It has not run and will not until you
            say so - shown in full, because approving something you cannot
            read is not approval. */}
        {pending && (
          <div className="border-t border-amber-700/50 bg-amber-950/30 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" /> SMARAN.AI wants to run this
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/40 px-2.5 py-2 font-mono text-[11px] text-amber-100">
              {pending.command}
            </pre>
            <p className="mt-1.5 text-[10px] leading-4 text-amber-200/70">
              It runs as you and can change anything you can change. Read it first.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => send(pending.command, 'user')}
                className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-[11px] font-black text-amber-200 hover:bg-amber-500/30">
                Approve and run
              </button>
              <button type="button" onClick={() => setPending(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-bold text-zinc-400 hover:text-white">
                No
              </button>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
          <span className="font-mono text-sm font-bold text-emerald-400">&gt;</span>
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              // Shell history, because retyping a long command is the first
              // thing anyone misses.
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                const next = Math.min(historyAt + 1, history.length - 1);
                if (next >= 0) { setHistoryAt(next); setCommand(history[next]); }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = historyAt - 1;
                setHistoryAt(next);
                setCommand(next >= 0 ? history[next] : '');
              }
            }}
            disabled={running}
            spellCheck={false}
            autoComplete="off"
            placeholder={running ? 'waiting for the command to finish…' : 'git status'}
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 disabled:opacity-50"
          />
        </form>
      </div>
    </div>
  );
};

export default TerminalPanel;
