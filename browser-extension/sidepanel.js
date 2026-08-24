/**
 * The side panel.
 *
 * Keeps one rule: the page is read when a question is asked about it, and
 * acted on only where the person has said the extension may. Everything the
 * assistant is told about the page is shown in the transcript first, so
 * nothing is sent that cannot be seen.
 */

const $ = (sel) => document.querySelector(sel);
const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

const sessionId = `chrome-${Date.now()}`;
let origin = '';
let permission = 'ask';

/* ------------------------------------------------------------- transcript */

function bubble(role, text, meta) {
  const log = $('#log');
  $('.hello')?.remove();

  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const body = document.createElement('p');
  body.className = 'msg-text';
  body.textContent = text;
  wrap.appendChild(body);

  if (meta) {
    const tag = document.createElement('p');
    tag.className = 'msg-meta';
    tag.textContent = meta;
    wrap.appendChild(tag);
  }

  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}

/* ------------------------------------------------------------ connection */

async function refreshStatus() {
  const { connected, backend } = await send({ kind: 'status' });
  const state = $('#state');
  if (connected) {
    state.textContent = `Connected to ${backend.replace('http://', '')}`;
    state.className = 'state ok';
  } else {
    state.textContent = 'The app is not running';
    state.className = 'state bad';
  }
  return connected;
}

/* ----------------------------------------------------------- permissions */

const PERM_LABEL = { allow: 'Allowed', ask: 'Read only', never: 'Blocked' };

async function refreshSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    origin = new URL(tab.url).origin;
  } catch {
    origin = '';
  }

  if (!origin || origin.startsWith('chrome')) {
    $('#siteLabel').textContent = 'No page';
    $('#siteDot').dataset.perm = 'never';
    return;
  }

  permission = (await send({ kind: 'permission:get', origin })).value;
  $('#siteLabel').textContent = PERM_LABEL[permission];
  $('#siteDot').dataset.perm = permission;
  $('#permOrigin').textContent = origin;
  document.querySelectorAll('[data-perm]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.perm === permission)));
}

$('#siteBtn').addEventListener('click', () => {
  const panel = $('#perm');
  panel.hidden = !panel.hidden;
});

document.querySelectorAll('[data-perm]').forEach((button) => {
  button.addEventListener('click', async () => {
    await send({ kind: 'permission:set', origin, value: button.dataset.perm });
    await refreshSite();
    $('#perm').hidden = true;
  });
});

chrome.tabs.onActivated.addListener(refreshSite);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') refreshSite(); });

/* ---------------------------------------------------------------- asking */

async function ask(question) {
  if (!question.trim()) return;

  bubble('you', question);
  $('#prompt').value = '';
  $('#send').disabled = true;

  const thinking = bubble('ai', 'Thinking…');

  try {
    if (permission === 'never' && $('#includePage').checked) {
      thinking.querySelector('.msg-text').textContent =
        'This site is blocked, so the page was not read. Change it above if you want that.';
      return;
    }

    let prompt = question;

    if ($('#includePage').checked && origin && !origin.startsWith('chrome')) {
      const { page, error } = await send({ kind: 'page:read' });
      if (error) {
        thinking.querySelector('.msg-text').textContent = error;
        return;
      }

      // Say what was taken, before it is sent.
      thinking.querySelector('.msg-meta')?.remove();
      const note = document.createElement('p');
      note.className = 'msg-meta';
      note.textContent = `Read ${page.title || page.url} — ${page.text.length} characters, `
        + `${page.links.length} links, ${page.fields.length} fields.`;
      thinking.appendChild(note);

      prompt = [
        `The person is looking at this page and asked: ${question}`,
        '',
        `URL: ${page.url}`,
        `Title: ${page.title}`,
        '',
        'Page text:',
        page.text,
        page.fields.length ? `\nForm fields: ${page.fields.map((f) => f.label || f.name).filter(Boolean).join(', ')}` : '',
        'Answer from the page. If the page does not say, say so rather than guessing.',
      ].join('\n');
    }

    const { answer, model, error } = await send({ kind: 'ask', sessionId, prompt });
    thinking.querySelector('.msg-text').textContent =
      error || answer || 'The app returned nothing.';
    if (model) {
      const tag = document.createElement('p');
      tag.className = 'msg-meta';
      tag.textContent = model;
      thinking.appendChild(tag);
    }
  } catch (err) {
    thinking.querySelector('.msg-text').textContent = String(err.message || err);
  } finally {
    $('#send').disabled = false;
    $('#log').scrollTop = $('#log').scrollHeight;
  }
}

$('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  ask($('#prompt').value);
});

$('#prompt').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    ask($('#prompt').value);
  }
});

// Grow with the text, up to a point.
$('#prompt').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
});

document.querySelectorAll('.chip').forEach((chip) =>
  chip.addEventListener('click', () => ask(chip.textContent)));

refreshStatus();
refreshSite();
setInterval(refreshStatus, 20000);
