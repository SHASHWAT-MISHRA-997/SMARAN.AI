import test from 'node:test';
import assert from 'node:assert/strict';
import { comboFromEvent, DEFAULT_SHORTCUTS, loadShortcuts, matches, parseCombo } from '../src/utils/shortcuts.js';

const store = (value) => ({ getItem: () => value, setItem() {} });
const key = (code, mods = {}) => ({ code, key: code.replace(/^Key/, '').toLowerCase(), ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('a saved change is what the app uses, and new shortcuts still appear', () => {
  const list = loadShortcuts(store(JSON.stringify([{ id: 'new_chat', keys: 'Ctrl + Shift + K' }])));
  assert.equal(list.find((s) => s.id === 'new_chat').keys, 'Ctrl + Shift + K');
  assert.equal(list.length, DEFAULT_SHORTCUTS.length);
  assert.equal(loadShortcuts(store('not json')).length, DEFAULT_SHORTCUTS.length);
});

test('combinations match exactly', () => {
  assert.ok(matches(key('KeyN', { ctrlKey: true, altKey: true }), 'Ctrl + Alt + N'));
  assert.ok(!matches(key('KeyN', { ctrlKey: true }), 'Ctrl + Alt + N'));
  assert.ok(!matches(key('KeyN', { ctrlKey: true, altKey: true, shiftKey: true }), 'Ctrl + Alt + N'));
  assert.ok(matches({ code: 'Backquote', key: '`', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, 'Ctrl + `'));
});

test('recording a press gives a readable combination; a bare letter or modifier is ignored', () => {
  assert.equal(comboFromEvent(key('KeyK', { ctrlKey: true, shiftKey: true })), 'Ctrl + Shift + K');
  assert.equal(comboFromEvent(key('KeyK')), null);
  assert.equal(comboFromEvent({ code: 'ControlLeft', key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), null);
  assert.deepEqual(parseCombo('Ctrl + Alt + M'), { ctrl: true, alt: true, shift: false, meta: false, key: 'm' });
});
