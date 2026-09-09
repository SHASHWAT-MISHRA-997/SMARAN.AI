import React, { useState } from 'react';
import { createPortal } from 'react-dom';

export default function ShareConversation({ messages }) {
  const [snapshot, setSnapshot] = useState(null);
  const [notice, setNotice] = useState('');
  const text = snapshot?.map(m => `${m.role === 'user' ? 'You' : 'SMARAN'}\n\n${m.content}`).join('\n\n---\n\n') || '';
  const open = () => {
    setNotice('');
    setSnapshot(messages.filter(m => ['user', 'assistant'].includes(m.role) && !m.isLoading && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content })));
  };
  return <>
    <button type="button" onClick={open} className="px-3 py-2 rounded-xl border border-zinc-500/30 text-xs" disabled={!messages.length}>Share</button>
    {snapshot !== null && createPortal(<div className="fixed inset-0 z-[200] bg-black/65 flex items-center justify-center p-4" onKeyDown={e => { if (e.key === 'Escape') setSnapshot(null); }}>
      <section role="dialog" aria-modal="true" aria-label="Share conversation" className="w-full max-w-2xl max-h-[85dvh] rounded-2xl bg-white dark:bg-zinc-900 p-5 flex flex-col gap-4 shadow-2xl">
        <header className="flex justify-between gap-4"><h2 className="font-bold text-lg">Share conversation</h2><button autoFocus aria-label="Close share preview" onClick={() => setSnapshot(null)}>✕</button></header>
        <p className="text-sm text-zinc-500">Review this snapshot before sharing. Later messages are not included. Attachments and account details are not exported; personal information written in messages remains visible.</p>
        <pre className="overflow-auto min-h-24 whitespace-pre-wrap rounded-xl border border-zinc-500/30 p-4 text-sm">{text || 'No completed messages to share.'}</pre>
        <p className="text-xs text-zinc-500">Share as text or a file. Public links are not configured on this installation.</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={!text} className="rounded-lg border px-3 py-2" onClick={async () => { try { await navigator.clipboard.writeText(text); setNotice('Copied snapshot.'); } catch { setNotice('Clipboard unavailable. Download the snapshot instead.'); } }}>Copy text</button>
          <button disabled={!text} className="rounded-lg border px-3 py-2" onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = 'smaran-conversation.txt'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download snapshot</button>
          {typeof navigator.share === 'function' && <button disabled={!text} className="rounded-lg border px-3 py-2" onClick={async () => {
            try { await navigator.share({ title: 'SMARAN conversation', text }); }
            catch (error) { if (error.name !== 'AbortError') setNotice('Sharing unavailable. Use copy or download.'); }
          }}>Share…</button>}
        </div>
        <p role="status" className="text-sm">{notice}</p>
      </section>
    </div>, document.body)}
  </>;
}
