/**
 * A bench for the Director panel.
 *
 * The panel normally sits behind a PIN screen, an open project and a run that
 * takes minutes, so this mounts it on its own against a stubbed backend. Each
 * state the panel has to render — the setup form, a run in flight, and a
 * finished run with a refused write — can then be looked at directly.
 *
 * `?state=setup|working|done` picks which. Development only: Vite builds
 * index.html and nothing else, so none of this ships.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';

import DirectorPanel from '../../src/components/DirectorPanel.jsx';

const MODELS = {
  local: [
    { model: 'qwen2.5-coder:7b', parameters: '7.6B' },
    { model: 'llama3.2:3b', parameters: '3.2B' },
  ],
  paid_providers: ['anthropic', 'openai'],
  note: '',
};

const task = (id, role, title, state, extra = {}) => ({
  id, role, title, state,
  instruction: `Instructions for ${title}.`,
  scopes: extra.scopes || [`src/${id}/**`],
  depends_on: extra.depends_on || [],
  acceptance: extra.acceptance || ['Renders at 360px wide'],
  // `??` would swallow a deliberate null, and a task that never ran must not
  // be shown with an owner.
  owner: 'owner' in extra ? extra.owner : 'local/qwen2.5-coder:7b',
  attempts: extra.attempts ?? 1,
  error: extra.error ?? null,
  output: extra.output ?? null,
  fallback_reason: extra.fallback_reason ?? null,
  duration: extra.duration ?? 12.4,
});

const WORKING = {
  id: 'run1', state: 'working', request: 'Build a video gallery.', error: null,
  applied: false,
  graph: {
    tasks: [
      task('markup', 'ui', 'Page markup', 'done'),
      task('styles', 'ui', 'Dark theme', 'running', { duration: null }),
      task('data', 'backend', 'Video data', 'running', {
        owner: 'local/llama3.2:3b',
        fallback_reason: 'Moved to local/llama3.2:3b after local/qwen2.5-coder:7b was rate limited',
      }),
      task('render', 'feature', 'Rendering', 'pending', { owner: null, depends_on: ['data'] }),
      task('review', 'review', 'Review', 'pending', {
        owner: null, scopes: [], depends_on: ['markup', 'styles', 'data', 'render'],
      }),
    ],
  },
  review: null,
  changes: [{ id: 'c1', path: 'index.html', lines_added: 18, lines_removed: 0 }],
  events: [],
};

const DONE = {
  ...WORKING,
  state: 'done',
  graph: {
    tasks: [
      task('markup', 'ui', 'Page markup', 'done'),
      task('styles', 'ui', 'Dark theme', 'done'),
      task('data', 'backend', 'Video data', 'done'),
      task('render', 'feature', 'Rendering', 'failed', {
        error: 'No model completed this task after 3 attempts. local/qwen2.5-coder:7b timed out',
        owner: 'local/qwen2.5-coder:7b', attempts: 3,
      }),
      task('review', 'review', 'Review', 'blocked', { owner: null, scopes: [] }),
    ],
  },
  review: {
    verdict: 'changes-needed', owner: 'local/qwen2.5-coder:7b',
    summary: 'Markup, styling and data are in place; the rendering script is missing.',
    problems: ['app.js was never written, so the grid stays empty.'],
    next_steps: [],
  },
  changes: [
    { id: 'c1', path: 'index.html', lines_added: 18, lines_removed: 0 },
    { id: 'c2', path: 'styles.css', lines_added: 42, lines_removed: 3 },
  ],
  events: [{
    kind: 'out-of-scope',
    message: 'Dark theme tried to write index.html, which it does not own. Discarded.',
    path: 'index.html',
  }],
};

const which = new URLSearchParams(window.location.search).get('state') || 'setup';
const RUN = which === 'working' ? WORKING : which === 'done' ? DONE : null;

// Only the two calls the panel makes. Anything else is a mistake worth seeing.
window.fetch = async (url) => {
  const body = String(url).includes('/models') ? MODELS
    : String(url).includes('/runs') ? RUN
      : { detail: `the bench did not expect ${url}` };
  return { ok: true, status: 200, json: async () => body };
};

function Bench() {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="dark">
      <DirectorPanel isOpen={open} onClose={() => setOpen(false)} />
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
                className="m-4 rounded bg-cyan-500 px-3 py-2 text-black">
          Reopen
        </button>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
// The panel reads a run from state, so for the two run benches it is primed
// by letting it start one: the stub answers /runs with the fixture above.
root.render(<Bench />);

if (RUN) {
  // The panel only polls once it has a run, and it gets one by starting it.
  // Filling the form and pressing the button is what a person would do, so
  // that is what the bench does rather than reaching into the component.
  const set = (selector, value) => {
    const node = document.querySelector(selector);
    if (!node) return false;
    const proto = node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  // The start button stays disabled until the model list has arrived, so this
  // waits for it rather than guessing at a delay.
  const attempt = () => {
    const filled = set('#director-request', 'Build a video gallery.')
      && set('#director-root', 'C:/tmp/gallery');
    const button = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Start the run'));
    if (filled && button && !button.disabled) {
      button.click();
      return;
    }
    window.setTimeout(attempt, 80);
  };
  window.setTimeout(attempt, 80);
}
