import React, { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { feedback } from '../utils/feedback';

/**
 * Reminders set by voice or chat ("remind me in 10 minutes to stretch") come
 * due on the computer; this asks for them every 15 seconds, and each one is
 * shown here, said aloud, and sent as a system notification when allowed.
 * The server hands each reminder out once, so two windows do not both ring.
 */
const POLL_MS = 15000;

function say(text) {
  try {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(`Reminder: ${text}`);
    window.speechSynthesis.speak(u);
  } catch { /* no voice here */ }
}

function notify(text) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') new Notification('SMARAN reminder', { body: text });
  } catch { /* not allowed in this window */ }
}

export default function ReminderAlerts({ enabled }) {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    if (!enabled) return undefined;
    // Asked once, quietly; a refusal just means no system notification.
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reminders/fired`, { credentials: 'include' });
        if (!res.ok) return;
        const { reminders = [] } = await res.json();
        if (stopped || !reminders.length) return;
        setAlerts((prev) => [...prev, ...reminders].slice(-5));
        reminders.forEach((r) => { say(r.text); notify(r.text); });
        feedback('warn');
      } catch { /* backend asleep; try again next time */ }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [enabled]);

  if (!alerts.length) return null;
  return (
    <div className="fixed right-4 top-4 z-[200] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" role="alert" aria-live="assertive">
      {alerts.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-amber-400/50 bg-zinc-950/95 p-3 text-zinc-100 shadow-2xl shadow-amber-500/10 backdrop-blur animate-in slide-in-from-top-2">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-amber-300">Reminder</p>
            <p className="break-words text-sm">{a.text}</p>
          </div>
          <button type="button" aria-label="Dismiss reminder" onClick={() => setAlerts((prev) => prev.filter((x) => x.id !== a.id))}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
