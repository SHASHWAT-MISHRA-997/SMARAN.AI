import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { isNativeApp } from '../utils/hostLink';
import { device } from '../utils/devicePlugin';

/* Sharing is a copy of the conversation, sent from this device.

   There used to be a "public link" too. It was served by the SMARAN.AI app on
   the person's own computer, so the link only worked while that PC was on and
   reachable - unlike ChatGPT or Claude, whose links are hosted - and a file
   "snapshot" download beside it. Both are gone. What is left works anywhere,
   with no computer involved: the device's own share sheet (WhatsApp, Gmail,
   Telegram, Drive...) and Copy text.

   On a phone the share sheet comes from the app's native plugin, because
   Android's WebView does not implement navigator.share - which is why the
   Share button never appeared on a phone before. */

// Android passes shared text through a transaction with a hard size limit
// (about 1 MB). Past this the share sheet fails outright, so a very long
// conversation is trimmed from the start and says so.
const MAX_SHARE_CHARS = 90000;

// A web answer's [1] [2] mean nothing once copied out of the app, so its
// numbered sources travel with it.
const sourcesOf = (message) => {
  let refs = message.references;
  if (typeof refs === 'string') { try { refs = JSON.parse(refs); } catch { refs = []; } }
  const web = Array.isArray(refs) ? refs.filter((r) => r?.url) : [];
  if (!web.length) return '';
  return `\n\nSources:\n${web.map((r, i) => `[${r.n || i + 1}] ${r.document_name || r.title || r.domain || ''} - ${r.url}`).join('\n')}`;
};

const formatConversation = (messages) => {
  const turns = messages.map((m) => `${m.role === 'user' ? 'You' : 'SMARAN.AI'}:\n${String(m.content || '').trim()}${m.role === 'user' ? '' : sourcesOf(m)}`);
  const heading = `SMARAN.AI conversation - ${new Date().toLocaleString()}`;
  let body = turns.join('\n\n');
  if (body.length > MAX_SHARE_CHARS) {
    body = '[Earlier messages trimmed - this conversation is too long to share in full.]\n\n'
      + body.slice(body.length - MAX_SHARE_CHARS);
  }
  return `${heading}\n\n${body}\n`;
};

export default function ShareConversation({ messages }) {
  const [snapshot, setSnapshot] = useState(null);
  const [notice, setNotice] = useState('');

  const text = snapshot && snapshot.length ? formatConversation(snapshot) : '';

  const open = () => {
    setNotice('');
    setSnapshot(
      messages
        .filter((m) => ['user', 'assistant'].includes(m.role) && !m.isLoading
          && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content })),
    );
  };

  const close = () => setSnapshot(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied. Paste it anywhere.');
      return true;
    } catch {
      setNotice('Copying was blocked here. Select the text above and copy it.');
      return false;
    }
  };

  const share = async () => {
    if (!text) return;
    setNotice('');
    if (isNativeApp()) {
      try {
        const result = await device.shareText({ text, title: 'SMARAN.AI conversation' });
        if (result?.shared) return;
      } catch { /* an older app build without the method - fall through */ }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'SMARAN.AI conversation', text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    // Nothing here can open a share sheet; the next best thing is the text
    // on the clipboard, and saying so.
    if (await copy()) setNotice('Sharing is not available here, so the conversation was copied instead.');
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="h-8 px-3 rounded-xl border border-line text-xs font-semibold text-ink transition hover:bg-raised flex items-center justify-center shrink-0"
        disabled={!messages.length}
      >
        Share
      </button>

      {snapshot !== null && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-veil flex items-center justify-center p-4 backdrop-blur-sm"
          onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Share conversation"
            className="w-full max-w-2xl max-h-[85dvh] rounded-2xl bg-raised border border-line p-5 flex flex-col gap-4 shadow-2xl text-ink"
          >
            <header className="flex justify-between items-center gap-4">
              <h2 className="font-bold text-lg text-ink">Share conversation</h2>
              <button
                autoFocus
                aria-label="Close"
                className="text-ink-muted hover:text-ink text-sm px-2 py-1 rounded"
                onClick={close}
              >
                ✕
              </button>
            </header>

            <p className="text-sm text-ink-muted leading-relaxed">
              Sends a copy of this conversation as text - to WhatsApp, email, notes or
              anywhere else. Nothing is uploaded by SMARAN.AI; the copy goes only where you
              send it. Anything personal written in the messages is included, so check it first.
            </p>

            <pre className="overflow-auto min-h-24 max-h-64 whitespace-pre-wrap rounded-xl border border-line bg-sunken p-4 text-xs font-mono text-ink select-text">
              {text || 'No completed messages to share yet.'}
            </pre>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={!text}
                onClick={copy}
                className="rounded-lg border border-line bg-raised px-4 py-2 text-sm font-medium text-ink hover:bg-sunken disabled:opacity-40 transition"
              >
                Copy text
              </button>
              <button
                type="button"
                disabled={!text}
                onClick={share}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
              >
                Share…
              </button>
            </div>

            <p role="status" className="text-xs font-medium text-indigo-400 min-h-[1.2rem]">
              {notice}
            </p>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
