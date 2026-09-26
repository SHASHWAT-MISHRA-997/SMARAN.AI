import React, { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, AlertCircle, Square, Play, ShieldCheck, ExternalLink, X, Monitor, HelpCircle } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';
import { isNativeApp } from '../utils/hostLink';

/* Live browsing: SMARAN opens a real browser window on the computer and works
   through a task in it - opening pages, reading, clicking, typing - while each
   step appears here with a screenshot. The backend does the work
   (backend/app/live_browser.py); this screen starts it, shows it, stops it.

   It runs on the computer. A phone paired with that computer drives the
   computer's browser; a phone on its own has nothing to drive. */

const card = 'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60';
const field = 'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 '
  + 'px-3 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-indigo-500';

const EXAMPLES = [
  'Find today\'s top headline on bbc.com/news',
  'What is the current price of the iPhone 16 on apple.com/in?',
  'Search Wikipedia for Chandrayaan-3 and tell me its launch date',
  'Find three highly rated Python courses on YouTube',
];

/* "Whole computer": the same loop over the whole screen - any app, not only
   a browser (backend/app/computer_agent.py). It clicks and types with your
   mouse and keyboard, so it needs Computer use on in Settings. */
const COMPUTER_EXAMPLES = [
  'Open Notepad and write a short note saying the build passed',
  'Open the Calculator and work out 1234 x 56',
  'Open Settings and tell me which Windows version this is',
];

const ACTION_LABEL = {
  open: 'Opened a page',
  click: 'Clicked',
  type: 'Typed',
  scroll: 'Scrolled',
  back: 'Went back',
};

export default function LiveBrowser() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [note, setNote] = useState('');
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [enlarged, setEnlarged] = useState('');
  const endRef = useRef(null);
  const [mode, setMode] = useState('browser');     // 'browser' | 'computer'
  const sessionRef = useRef('');
  const computer = mode === 'computer';

  useEffect(() => {
    // No computer to drive only on the phone app with nothing paired. In the
    // desktop app the page is served by the backend itself, so API_BASE is
    // empty by design - and this told the desktop app to "pair this phone".
    if (!API_BASE && isNativeApp()) {
      setStatusError('Live browsing drives a browser on your computer, so it needs the SMARAN.AI '
        + 'desktop app. Pair this phone with your computer in Settings, and it will drive that '
        + 'computer\'s browser.');
      return;
    }
    fetchWithAuth(`${API_BASE}/api/browse/status`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setStatus)
      .catch(() => setStatusError('Could not reach SMARAN.AI on your computer. Is the desktop app running?'));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [steps, answer]);

  const start = async (event) => {
    event?.preventDefault();
    const wanted = task.trim();
    if (!wanted || running) return;
    setRunning(true);
    setSteps([]);
    setAnswer(null);
    setError('');
    setNote('');
    try {
      const res = await fetchWithAuth(`${API_BASE}${computer ? '/api/computer/run' : '/api/browse'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(computer ? { goal: wanted } : { task: wanted }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `The browser could not be started (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'session') sessionRef.current = event.token;
          else if (event.type === 'status') setNote(event.message);
          else if (event.type === 'step' && computer) {
            setNote('');
            setSteps((all) => [...all, {
              step: event.n, action: event.label, thought: event.thought,
              result: event.result + (event.model ? ` · seen by ${event.model}${event.where && event.where !== 'local' ? ` (${event.where})` : ''}` : ''),
              failed: event.ok === false,
              screenshot: event.screenshot ? `data:image/jpeg;base64,${event.screenshot}` : '',
            }]);
          }
          else if (event.type === 'step') { setNote(''); setSteps((all) => [...all, event]); }
          else if (event.type === 'done' && computer) setAnswer({ answer: event.summary });
          else if (event.type === 'question') setAnswer({ answer: event.question, question: true });
          else if (event.type === 'done') setAnswer(event);
          else if (event.type === 'stopped') setNote('Stopped.');
          else if (event.type === 'error') setError(event.message);
        }
      }
    } catch (err) {
      setError(err.message || 'Live browsing stopped unexpectedly.');
    } finally {
      setRunning(false);
    }
  };

  const stop = async () => {
    setNote('Stopping after this step…');
    try {
      if (computer) {
        await fetchWithAuth(`${API_BASE}/api/control/stop`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: sessionRef.current || undefined }),
        });
      } else {
        await fetchWithAuth(`${API_BASE}/api/browse/stop`, { method: 'POST' });
      }
    } catch { /* shown by the stream */ }
  };

  // The whole-computer mode needs no browser; only the browser mode does.
  const ready = !statusError && (computer ? Boolean(status) : status?.available);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black text-zinc-900 dark:text-white">
            <Globe className="h-5 w-5 text-indigo-500" /> Live Browser &amp; Computer use
          </h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Give it a task and watch it work: SMARAN opens a browser window on your computer,
            reads pages, clicks and types, and reports what it found - every step shown below.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-zinc-300 dark:border-zinc-700 p-1" role="tablist" aria-label="What SMARAN drives">
          {[['browser', 'Browser', Globe], ['computer', 'Whole computer', Monitor]].map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} disabled={running}
                    onClick={() => { setMode(id); setSteps([]); setAnswer(null); setError(''); }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${mode === id ? 'bg-indigo-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {statusError && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-amber-700 dark:text-amber-300`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{statusError}</p>
          </div>
        )}

        {status && !status.available && !computer && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-amber-700 dark:text-amber-300`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>No Chrome, Chromium, Edge or Brave was found on this computer. Install one of them and come back.</p>
          </div>
        )}

        {ready && (
          <form onSubmit={start} className={`${card} space-y-3 p-4 sm:p-5`}>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) start(e); }}
              rows={2}
              maxLength={2000}
              disabled={running}
              placeholder={computer
                ? 'What should it do on this computer? For example: open Notepad and write a shopping list.'
                : 'What should it find or do? For example: find the opening hours of the Red Fort.'}
              className={`${field} resize-y`}
            />
            <div className="flex flex-wrap gap-2">
              {(computer ? COMPUTER_EXAMPLES : EXAMPLES).map((example) => (
                <button key={example} type="button" disabled={running}
                        onClick={() => setTask(example)}
                        className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 disabled:opacity-40 transition">
                  {example}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                {computer
                  ? 'It uses your mouse and keyboard - hands off while it works, or press Stop. It never types passwords or OTPs, and asks you before anything about money, buying, sending or the power button.'
                  : `A fresh window with no logins, using ${status.browser || 'your browser'}. It never types passwords or card details, and stops before paying, sending or deleting anything.`}
              </p>
              {running ? (
                <button type="button" onClick={stop}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-500/50 px-4 py-2 text-sm font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 transition">
                  <Square className="h-4 w-4" /> Stop
                </button>
              ) : (
                <button type="submit" disabled={!task.trim()}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition">
                  <Play className="h-4 w-4" /> Start
                </button>
              )}
            </div>
          </form>
        )}

        {(steps.length > 0 || note || running) && (
          <ol className="space-y-3">
            {steps.map((step) => (
              <li key={step.step} className={`${card} flex gap-3 p-3`}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-[11px] font-black text-indigo-600 dark:text-indigo-300">
                  {step.step}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${step.failed ? 'text-rose-600 dark:text-rose-300' : 'text-zinc-900 dark:text-white'}`}>
                    {ACTION_LABEL[step.action] || step.action}
                    <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">{step.result}</span>
                  </p>
                  {step.thought && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{step.thought}</p>}
                  {step.url && (
                    <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-indigo-600 dark:text-indigo-300">
                      <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{step.url}</span>
                    </p>
                  )}
                </div>
                {step.screenshot && (
                  <button type="button" onClick={() => setEnlarged(step.screenshot)}
                          className="shrink-0 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
                          aria-label={`Enlarge screenshot of step ${step.step}`}>
                    <img src={step.screenshot} alt="" className="h-20 w-32 object-cover object-top" />
                  </button>
                )}
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> {note || 'Working on the next step…'}
              </li>
            )}
          </ol>
        )}

        {error && (
          <div className={`${card} flex items-start gap-3 p-4 text-sm text-rose-700 dark:text-rose-300`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <p>{error}</p>
          </div>
        )}

        {answer && (
          <div className={`${card} border-indigo-500/40 p-4 sm:p-5`}>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
              {answer.question ? <><HelpCircle className="h-3.5 w-3.5" /> SMARAN needs you</> : 'Answer'}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-900 dark:text-white">{answer.answer}</p>
            {answer.url && (
              <a href={answer.url} target="_blank" rel="noopener noreferrer"
                 className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-300 hover:underline">
                <ExternalLink className="h-3 w-3" /> Source
              </a>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {enlarged && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
             onClick={() => setEnlarged('')} role="dialog" aria-modal="true" aria-label="Screenshot">
          <button type="button" aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
          <img src={enlarged} alt="Screenshot of the browser" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
