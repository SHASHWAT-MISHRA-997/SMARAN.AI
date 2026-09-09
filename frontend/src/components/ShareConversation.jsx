import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE } from '../context/AuthContext';

export default function ShareConversation({ messages }) {
  const [snapshot, setSnapshot] = useState(null);
  const [notice, setNotice] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [shareData, setShareData] = useState(null);

  const text = snapshot?.map(m => `${m.role === 'user' ? 'You' : 'SMARAN'}\n\n${m.content}`).join('\n\n---\n\n') || '';

  const open = () => {
    setNotice('');
    setShareData(null);
    setSnapshot(
      messages
        .filter(m => ['user', 'assistant'].includes(m.role) && !m.isLoading && typeof m.content === 'string' && m.content.trim())
        .map(m => ({ role: m.role, content: m.content }))
    );
  };

  const createPublicLink = async () => {
    if (!snapshot || !snapshot.length) return;
    setIsPublishing(true);
    setNotice('');
    try {
      const resp = await fetch(`${API_BASE}/api/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'SMARAN Conversation',
          messages: snapshot,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create share link.');
      }
      const data = await resp.json();
      setShareData(data);
      setNotice('Public link created. You can copy or revoke it below.');
    } catch (err) {
      setNotice(err.message || 'Could not create public link. Export as text instead.');
    } finally {
      setIsPublishing(false);
    }
  };

  const revokePublicLink = async () => {
    if (!shareData?.share_id || !shareData?.revocation_token) return;
    setNotice('Revoking public link...');
    try {
      const resp = await fetch(`${API_BASE}/api/share/${shareData.share_id}?secret=${encodeURIComponent(shareData.revocation_token)}`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        setShareData(null);
        setNotice('Public link revoked and permanently disabled.');
      } else {
        setNotice('Could not revoke link.');
      }
    } catch {
      setNotice('Network error while revoking link.');
    }
  };

  const getFullShareUrl = (path) => {
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${path}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="px-3 py-2 rounded-xl border border-line text-xs font-semibold text-ink transition hover:bg-raised"
        disabled={!messages.length}
      >
        Share
      </button>

      {snapshot !== null && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-veil flex items-center justify-center p-4 backdrop-blur-sm"
          onKeyDown={e => { if (e.key === 'Escape') setSnapshot(null); }}
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
                aria-label="Close share preview"
                className="text-ink-muted hover:text-ink text-sm px-2 py-1 rounded"
                onClick={() => setSnapshot(null)}
              >
                ✕
              </button>
            </header>

            <p className="text-sm text-ink-muted leading-relaxed">
              Review this snapshot before sharing. Later messages are not included. Attachments and account details are not exported; personal information written in messages remains visible.
            </p>

            <pre className="overflow-auto min-h-24 max-h-48 whitespace-pre-wrap rounded-xl border border-line bg-sunken p-4 text-xs font-mono text-ink">
              {text || 'No completed messages to share.'}
            </pre>

            <p className="text-xs text-ink-faint">
              Share as text or a file. Public links are not configured for external access without public hosting; snapshot links can be published below.
            </p>

            {/* Public Link Section */}
            <div className="rounded-xl border border-line bg-sunken p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink">Public Link Sharing</span>
                <span className="text-[11px] text-ink-faint">Immutable snapshot</span>
              </div>

              {!shareData ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-ink-muted">
                    Publish an immutable read-only snapshot. Anyone with the link will be able to view it.
                  </p>
                  <button
                    type="button"
                    disabled={!text || isPublishing}
                    onClick={createPublicLink}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition"
                  >
                    {isPublishing ? 'Creating…' : 'Create public link'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={getFullShareUrl(shareData.share_url)}
                      className="flex-1 rounded-lg border border-line bg-raised px-3 py-1.5 text-xs text-ink select-all outline-none"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(getFullShareUrl(shareData.share_url));
                          setNotice('Copied public link to clipboard.');
                        } catch {
                          setNotice('Failed to copy. Select and copy the text box directly.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={revokePublicLink}
                      className="px-2.5 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-medium transition"
                      title="Permanently disable this public link"
                    >
                      Revoke
                    </button>
                  </div>
                  <p className="text-[11px] text-ink-faint">
                    Snapshot is published. You can revoke and disable this link at any time from this device.
                  </p>
                </div>
              )}
            </div>

            {/* Local Export Controls */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <span className="text-xs text-ink-faint mr-1">Local export:</span>
              <button
                disabled={!text}
                className="rounded-lg border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-sunken disabled:opacity-40 transition"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                    setNotice('Copied snapshot.');
                  } catch {
                    setNotice('Clipboard unavailable. Download the snapshot instead.');
                  }
                }}
              >
                Copy text
              </button>
              <button
                disabled={!text}
                className="rounded-lg border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-sunken disabled:opacity-40 transition"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'smaran-conversation.txt';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download snapshot
              </button>
              {typeof navigator.share === 'function' && (
                <button
                  disabled={!text}
                  className="rounded-lg border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-sunken disabled:opacity-40 transition"
                  onClick={async () => {
                    try {
                      await navigator.share({ title: 'SMARAN conversation', text });
                    } catch (error) {
                      if (error.name !== 'AbortError') setNotice('Sharing unavailable. Use copy or download.');
                    }
                  }}
                >
                  Share…
                </button>
              )}
            </div>

            <p role="status" className="text-xs font-medium text-indigo-400 min-h-[1.2rem]">
              {notice}
            </p>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
