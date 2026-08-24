/**
 * Service worker: finds the desktop app, relays questions to it, and holds
 * the per-site permissions.
 *
 * The extension never talks to a model directly. Everything goes through the
 * SMARAN.AI backend on this machine, which is where the keys and the model
 * routing already live — duplicating that here would mean two places to
 * configure and two places to get wrong.
 */

const RUNTIME_PORTS = [3003, 3004, 3005, 8000];
const PERMISSION_KEY = 'sitePermissions';

/** Ports the app might be on. It prefers 3003 and takes any free port if not. */
async function findBackend() {
  const remembered = (await chrome.storage.local.get('backendUrl')).backendUrl;
  const candidates = remembered
    ? [remembered, ...RUNTIME_PORTS.map((p) => `http://127.0.0.1:${p}`)]
    : RUNTIME_PORTS.map((p) => `http://127.0.0.1:${p}`);

  for (const base of [...new Set(candidates)]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const response = await fetch(`${base}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        await chrome.storage.local.set({ backendUrl: base });
        return base;
      }
    } catch {
      // Try the next one. A closed port is the normal case for most of these.
    }
  }
  return null;
}

/* ---------------------------------------------------------- permissions */

/** 'allow' | 'ask' | 'never', per origin. Default is to ask. */
async function permissionFor(origin) {
  const all = (await chrome.storage.local.get(PERMISSION_KEY))[PERMISSION_KEY] || {};
  return all[origin] || 'ask';
}

async function setPermission(origin, value) {
  const all = (await chrome.storage.local.get(PERMISSION_KEY))[PERMISSION_KEY] || {};
  if (value === 'ask') delete all[origin];
  else all[origin] = value;
  await chrome.storage.local.set({ [PERMISSION_KEY]: all });
  return all;
}

/* --------------------------------------------------------------- page */

/**
 * Read the visible page.
 *
 * Injected rather than declared as a content script, so nothing runs on any
 * page until the person actually asks a question about it.
 */
function readPage() {
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main, article, [role=main]') || document.body;

  const links = [...document.querySelectorAll('a[href]')]
    .slice(0, 60)
    .map((a) => ({ text: clean(a.innerText).slice(0, 80), href: a.href }))
    .filter((l) => l.text);

  const fields = [...document.querySelectorAll('input, textarea, select')]
    .slice(0, 40)
    .map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || el.id || '',
      label: clean(el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || ''),
    }));

  const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')]
    .slice(0, 40)
    .map((el, i) => ({ index: i, text: clean(el.innerText || el.value || el.getAttribute('aria-label')) }))
    .filter((b) => b.text);

  return {
    url: location.href,
    title: document.title,
    // Enough to answer questions about, not so much that it costs a fortune
    // to send or drowns the model in navigation chrome.
    text: clean(main.innerText).slice(0, 12000),
    links,
    fields,
    buttons,
  };
}

/** Act on the page. Only ever called after the person has allowed this site. */
function actOnPage(action) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const byText = (selector, text) => {
    const needle = (text || '').toLowerCase();
    return [...document.querySelectorAll(selector)]
      .filter(visible)
      .find((el) => ((el.innerText || el.value || '').toLowerCase().includes(needle)));
  };

  switch (action.type) {
    case 'click': {
      const el = byText('button, a, [role=button], input[type=submit]', action.text);
      if (!el) return { ok: false, reason: `Nothing clickable reads "${action.text}".` };
      el.click();
      return { ok: true, did: `Clicked "${(el.innerText || el.value || '').trim().slice(0, 60)}".` };
    }
    case 'type': {
      const fields = [...document.querySelectorAll('input, textarea')].filter(visible);
      const el = action.field
        ? fields.find((f) => `${f.name} ${f.id} ${f.placeholder} ${f.getAttribute('aria-label') || ''}`
            .toLowerCase().includes(action.field.toLowerCase()))
        : fields[0];
      if (!el) return { ok: false, reason: `No field matching "${action.field}".` };
      // React and friends listen for input events, not for value assignment.
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(el, action.value || '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, did: `Typed into ${el.name || el.id || 'the field'}.` };
    }
    case 'scroll': {
      window.scrollBy({ top: (action.amount || 1) * window.innerHeight * 0.8, behavior: 'smooth' });
      return { ok: true, did: 'Scrolled.' };
    }
    default:
      return { ok: false, reason: `Unknown action "${action.type}".` };
  }
}

/* ------------------------------------------------------------ messaging */

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  (async () => {
    try {
      switch (message.kind) {
        case 'status': {
          const base = await findBackend();
          respond({ backend: base, connected: Boolean(base) });
          return;
        }

        case 'permission:get': {
          respond({ value: await permissionFor(message.origin) });
          return;
        }

        case 'permission:set': {
          respond({ all: await setPermission(message.origin, message.value) });
          return;
        }

        case 'page:read': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) { respond({ error: 'No page is open.' }); return; }
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: readPage,
          });
          respond({ page: result });
          return;
        }

        case 'page:act': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) { respond({ error: 'No page is open.' }); return; }

          const origin = new URL(tab.url).origin;
          if (await permissionFor(origin) !== 'allow') {
            respond({ error: `Acting on ${origin} is not allowed. Turn it on for this site first.` });
            return;
          }
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: actOnPage,
            args: [message.action],
          });
          respond({ result });
          return;
        }

        case 'ask': {
          const base = await findBackend();
          if (!base) {
            respond({ error: 'SMARAN.AI is not running on this machine. Start the app and try again.' });
            return;
          }
          const response = await fetch(`${base}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: message.sessionId,
              prompt: message.prompt,
              mode: message.mode || 'auto',
            }),
          });
          if (!response.ok) {
            respond({ error: `The app answered ${response.status}.` });
            return;
          }
          // The chat endpoint streams newline-delimited JSON.
          const raw = await response.text();
          let answer = '';
          let model = '';
          raw.split('\n').filter(Boolean).forEach((line) => {
            try {
              const chunk = JSON.parse(line);
              if (chunk.token) answer += chunk.token;
              if (chunk.model_routed) model = chunk.model_routed;
            } catch { /* a partial line at the end is normal */ }
          });
          respond({ answer: answer.trim(), model });
          return;
        }

        default:
          respond({ error: `Unknown request "${message.kind}".` });
      }
    } catch (err) {
      respond({ error: String(err?.message || err) });
    }
  })();

  return true; // keep the channel open for the async reply
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
