import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e) };
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) { super(type); this.detail = init?.detail; }
};

const { getFloatView, setFloatView, floatsAtAll, drawsFigure } = await import('../src/utils/floatView.js');

beforeEach(() => { store.clear(); events.length = 0; });

// The bug: the floating window showed a slice of the chat. With no choice
// made, it shows the character - the one the user talks to in calls.
test('with no choice made, the float shows the call character', () => {
  assert.equal(getFloatView(), 'myra');
  store.set('sm_avatar_id', 'evelyn');
  assert.equal(getFloatView(), 'amarya');
  store.set('sm_avatar_id', 'core');
  assert.equal(getFloatView(), 'core');
  assert.equal(drawsFigure(), true);
});

test('a choice is kept, announced, and unknown values are ignored', () => {
  setFloatView('conversation');
  assert.equal(getFloatView(), 'conversation');
  assert.equal(drawsFigure(), false);
  assert.equal(events.at(-1).detail.view, 'conversation');
  setFloatView('nonsense');
  assert.equal(getFloatView(), 'conversation');
  store.set('sm_float_view', 'riyo');
  assert.equal(getFloatView(), 'myra');
});

test('off stops the app from floating at all', () => {
  assert.equal(floatsAtAll(), true);
  setFloatView('off');
  assert.equal(floatsAtAll(), false);
  assert.equal(drawsFigure(), false);
});
