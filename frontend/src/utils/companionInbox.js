/* What the desktop sends to this phone (Dispatch), collected and acted on.
 *
 * The desktop's Dispatch page queued commands for the paired phone, and the
 * phone had a function to collect them (pollHostCommands) that nothing ever
 * called - so Dispatch reported "queued" and nothing arrived. This collects
 * them while the app is open and hands each one on:
 *
 *   prompt            -> asked in the chat, as if typed here
 *   speak             -> read aloud
 *   notify / message  -> shown as a notice
 *   open_url          -> opened, http(s) only
 *   new_chat          -> a fresh conversation
 *
 * Only the paired desktop can queue them (it needs the pairing), and only the
 * actions above are acted on; anything else is ignored.
 */
import { loadLink, pollHostCommands } from './hostLink.js';

export const COMMAND_EVENT = 'smaran:companion-command';
export const NOTICE_EVENT = 'smaran:notice';

const HANDLED = new Set(['prompt', 'speak', 'notify', 'message', 'open_url', 'new_chat']);

/** The text a command carries, whatever key the sender used. */
export function commandText(command) {
  const p = command?.params || {};
  const value = p.prompt ?? p.text ?? p.message ?? p.body ?? p.title ?? '';
  return String(value).trim().slice(0, 4000);
}

/** A safe URL to open, or null: http and https only. */
export function safeUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Keep only commands this phone acts on. */
export function actionable(commands) {
  return (Array.isArray(commands) ? commands : []).filter((c) => HANDLED.has(c?.action));
}

export function notify(text) {
  if (typeof window === 'undefined' || !text) return;
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { text } }));
}

/** Start collecting; returns stop(). Paired phone app only. */
export function startCompanionInbox({ intervalMs = 4000, poll = pollHostCommands, link = loadLink } = {}) {
  if (typeof window === 'undefined') return () => {};
  let busy = false;
  const tick = async () => {
    if (busy || document.hidden) return;
    const current = link();
    if (!current?.url || !current?.token) return;
    busy = true;
    try {
      for (const command of actionable(await poll(current))) {
        window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: command }));
      }
    } finally {
      busy = false;
    }
  };
  const timer = window.setInterval(tick, intervalMs);
  tick();
  return () => window.clearInterval(timer);
}
