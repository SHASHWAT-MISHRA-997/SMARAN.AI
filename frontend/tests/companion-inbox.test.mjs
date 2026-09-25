// Dispatch queued commands for the phone, and the phone never collected them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const events = [];
globalThis.window = {
  dispatchEvent: (e) => events.push(e), setInterval: () => 1, clearInterval: () => {},
};
globalThis.document = { hidden: false };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.localStorage = { getItem: () => null };
const { commandText, safeUrl, actionable, startCompanionInbox, COMMAND_EVENT } = await import('../src/utils/companionInbox.js');

test('the text is read whatever key the desktop used', () => {
  assert.equal(commandText({ params: { prompt: ' hi ' } }), 'hi');
  assert.equal(commandText({ params: { text: 'say this' } }), 'say this');
  assert.equal(commandText({ params: { message: 'm' } }), 'm');
  assert.equal(commandText({}), '');
});

test('only http and https links are opened', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('file:///etc/passwd'), null);
  assert.equal(safeUrl('intent://x'), null);
});

test('unknown actions are dropped', () => {
  assert.deepEqual(actionable([{ action: 'prompt' }, { action: 'desktop_action' }, { action: 'screenshot' }, null]).map((c) => c.action), ['prompt']);
});

test('collected commands are handed on as events', async () => {
  events.length = 0;
  startCompanionInbox({
    link: () => ({ url: 'http://pc:3003', token: 't' }),
    poll: async () => [{ action: 'prompt', params: { prompt: 'x' } }, { action: 'desktop_action' }],
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(events.map((e) => [e.type, e.detail.action]), [[COMMAND_EVENT, 'prompt']]);
});

test('not paired: nothing is polled', async () => {
  let polled = false;
  startCompanionInbox({ link: () => null, poll: async () => { polled = true; return []; } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(polled, false);
});
