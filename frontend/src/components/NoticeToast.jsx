import React, { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { NOTICE_EVENT } from '../utils/companionInbox';

/**
 * A short notice at the top of the screen - for now, messages the desktop
 * sends to this phone through Dispatch. Stays eight seconds, or until closed.
 */
export default function NoticeToast() {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let timer;
    const show = (event) => {
      const text = String(event?.detail?.text || '').slice(0, 500);
      if (!text) return;
      setNotice(text);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNotice(null), 8000);
    };
    window.addEventListener(NOTICE_EVENT, show);
    return () => {
      window.removeEventListener(NOTICE_EVENT, show);
      window.clearTimeout(timer);
    };
  }, []);

  if (!notice) return null;
  return (
    <div role="status" aria-live="polite"
         className="fixed left-1/2 top-4 z-[10001] flex w-[min(92vw,480px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-indigo-500/40 bg-zinc-900/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur">
      <Bell className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
      <p className="flex-1 leading-relaxed">{notice}</p>
      <button type="button" onClick={() => setNotice(null)} aria-label="Close notice"
              className="rounded-md p-0.5 text-zinc-400 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
