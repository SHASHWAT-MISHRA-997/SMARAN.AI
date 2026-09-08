/**
 * The Energy Core's state language.
 *
 * The fault these cover: the core fell back to the idle tint for any state it
 * did not recognise, so a state nobody had added drew a healthy cyan core. It
 * had one fixed screen-reader label, so none of these conditions reached
 * anyone using one. And there was no offline state at all, on the one
 * indicator that would have shown it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_STATES, FAULT_STATES, STATE_TINT, coreStateLabel, coreStateTint,
  resolveCoreState,
} from '../src/utils/coreStates.js';

test('every state the core can be asked for has a tint', () => {
  const missing = CORE_STATES.filter((s) => !STATE_TINT[s]);
  assert.deepEqual(missing, [], `states with no tint: ${missing}`);
});

test('every state has a label that is not the fallback by accident', () => {
  for (const state of CORE_STATES) {
    const label = coreStateLabel(state);
    assert.ok(label, `${state} has no label`);
    if (state !== 'idle') {
      assert.notEqual(label, coreStateLabel('idle'),
        `${state} falls back to the idle label`);
    }
  }
});

test('no two states share a tint unless they mean the same thing', () => {
  // listening/capturing and thinking/uploading are deliberately paired: one is
  // the phone doing it locally, the other the same thing over the wire.
  // Sorted, because the pair below is sorted before it is looked up.
  const allowed = new Set(['capturing|listening', 'thinking|uploading', 'idle|speaking']);
  const seen = new Map();
  for (const state of CORE_STATES) {
    const key = STATE_TINT[state].join(',');
    if (seen.has(key)) {
      const pair = [seen.get(key), state].sort().join('|');
      assert.ok(allowed.has(pair), `${pair} share a tint without meaning the same`);
    } else {
      seen.set(key, state);
    }
  }
});

test('a fault never draws as a healthy core', () => {
  const healthy = new Set(['idle', 'listening', 'capturing', 'thinking',
                           'uploading', 'speaking', 'success']
    .map((s) => STATE_TINT[s].join(',')));
  for (const state of FAULT_STATES) {
    assert.ok(!healthy.has(STATE_TINT[state].join(',')),
      `${state} is drawn in a healthy colour`);
  }
});

test('offline is colder and dimmer than muted', () => {
  const brightness = (c) => c[0] + c[1] + c[2];
  assert.ok(brightness(STATE_TINT.offline) < brightness(STATE_TINT.muted),
    'offline must not look like a working core being held quiet');
});

test('an unrecognised state falls back rather than throwing', () => {
  assert.deepEqual(coreStateTint('nonsense'), STATE_TINT.idle);
  assert.equal(coreStateLabel('nonsense'), coreStateLabel('idle'));
});

// ---- what the core shows when the network is gone -------------------------

test('online, the core shows whatever the call is doing', () => {
  for (const state of CORE_STATES) {
    assert.equal(resolveCoreState({ voiceState: state, online: true }), state);
  }
});

test('offline outranks the states that describe an intention', () => {
  for (const state of ['idle', 'listening', 'thinking', 'uploading', 'speaking']) {
    assert.equal(resolveCoreState({ voiceState: state, online: false }), 'offline',
      `${state} cannot be true with no network`);
  }
});

test('offline does not hide a microphone problem the user must act on', () => {
  assert.equal(resolveCoreState({ voiceState: 'permission', online: false }), 'permission');
  assert.equal(resolveCoreState({ voiceState: 'muted', online: false }), 'muted');
});

test('an unknown state resolves to something drawable', () => {
  assert.equal(resolveCoreState({ voiceState: 'nonsense' }), 'idle');
  assert.ok(CORE_STATES.includes(resolveCoreState({})));
});

test('the offline label says what to expect, not just that it is broken', () => {
  const label = coreStateLabel('offline');
  assert.match(label, /offline/i);
  assert.match(label, /reach/i);
});
