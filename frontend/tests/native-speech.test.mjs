import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/utils/nativeSpeech.js', import.meta.url), 'utf8');
async function setup() {
  const listeners = new Map();
  const timers = new Map();
  const counts = { starts: 0, stops: 0, cancels: 0 };
  let now = 0;
  let nextTimer = 0;
  const plugin = {
    requestPermissions: async () => ({ speechRecognition: 'granted' }),
    available: async () => ({ available: true }),
    start: async () => { counts.starts++; },
    stop: async () => { counts.stops++; },
    cancel: async () => { counts.cancels++; },
    speak: async options => { counts.spoken = options; },
    stopSpeaking: async () => {},
    addListener: async (name, callback) => {
      listeners.set(name, callback);
      return { remove: async () => { listeners.delete(name); } };
    },
  };
  const context = vm.createContext({
    setTimeout: (callback, delay) => {
      timers.set(++nextTimer, { callback, at: now + delay });
      return nextTimer;
    },
    clearTimeout: timer => timers.delete(timer),
  });
  const core = new vm.SyntheticModule(['registerPlugin'], function () {
    this.setExport('registerPlugin', () => plugin);
  }, { context });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => core);
  await module.evaluate();
  const flush = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
  return {
    listen: module.namespace.listen, speak: module.namespace.speak,
    stopSpeaking: module.namespace.stopSpeaking, plugin, counts, listeners,
    emit: async (name, payload) => { listeners.get(name)?.(payload); await flush(); },
    tick: async (elapsed) => {
      now += elapsed;
      for (const [timer, value] of timers) {
        if (value.at <= now) { timers.delete(timer); value.callback(); }
      }
      await flush();
    },
  };
}

test('Indian male speech preferences reach native TTS and stopping releases listeners', async () => {
  const fixture = await setup();
  await fixture.speak({ text: 'Namaste. Ready when you are.' });
  assert.equal(fixture.counts.spoken.language, 'en-IN');
  assert.equal(fixture.counts.spoken.gender, 'male');
  assert.equal(fixture.counts.spoken.pitch, 1);
  assert.equal(fixture.listeners.size, 3);
  await fixture.stopSpeaking();
  assert.equal(fixture.listeners.size, 0);
});

test('native speech start failure releases every registered listener', async () => {
  const fixture = await setup();
  fixture.plugin.speak = async () => { throw new Error('TTS not ready'); };
  await assert.rejects(fixture.speak({ text: 'Test' }), /TTS not ready/);
  assert.equal(fixture.listeners.size, 0);
});

test('late final words survive end-of-speech and replace the partial transcript', async () => {
  const fixture = await setup();
  const texts = []; const ends = [];
  await fixture.listen({ onText: text => texts.push(text), onEnd: end => ends.push(end) });
  await fixture.emit('recognitionResults', { matches: ['please keep'], isFinal: false });
  await fixture.emit('listeningState', { status: 'processing' });
  await fixture.tick(2500);
  assert.equal(ends.length, 0);
  await fixture.emit('recognitionResults', { matches: ['please keep the complete sentence'], isFinal: true });
  assert.equal(texts.at(-1), 'please keep the complete sentence');
  assert.equal(ends[0].reason, 'final');
  assert.equal(fixture.listeners.size, 0);
});

test('continuous dictation preserves previous sentences across pauses', async () => {
  const fixture = await setup();
  const texts = [];
  const stop = await fixture.listen({ continuous: true, onText: text => texts.push(text) });
  await fixture.emit('recognitionResults', { matches: ['First sentence.'], isFinal: true });
  await fixture.tick(150);
  assert.equal(fixture.counts.starts, 2);
  await fixture.emit('recognitionResults', { matches: ['Second'], isFinal: false });
  await fixture.emit('recognitionResults', { matches: ['Second sentence.'], isFinal: true });
  assert.equal(texts.at(-1), 'First sentence. Second sentence.');
  await stop.cancel();
  await fixture.tick(200);
  assert.equal(fixture.counts.starts, 2);
});

test('manual stop waits for final words and does not restart', async () => {
  const fixture = await setup();
  const texts = []; const ends = [];
  const stop = await fixture.listen({ continuous: true, onText: text => texts.push(text), onEnd: end => ends.push(end) });
  await fixture.emit('recognitionResults', { matches: ['last'], isFinal: false });
  await stop();
  assert.equal(ends.length, 0);
  await fixture.emit('recognitionResults', { matches: ['last words retained'], isFinal: true });
  assert.equal(texts.at(-1), 'last words retained');
  assert.equal(ends[0].reason, 'manual');
  await fixture.tick(20000);
  assert.equal(fixture.counts.starts, 1);
});

test('runtime errors after start resolves are surfaced rather than swallowed', async () => {
  const fixture = await setup(); const ends = [];
  await fixture.listen({ onEnd: end => ends.push(end) });
  await fixture.emit('recognitionError', { code: 2, noSpeech: false });
  assert.equal(ends[0].reason, 'error');
  assert.match(ends[0].message, /connection/);
  assert.equal(fixture.listeners.size, 0);
});

test('stopping between sentences ends immediately without a false timeout', async () => {
  const fixture = await setup(); const ends = [];
  const stop = await fixture.listen({ continuous: true, onEnd: end => ends.push(end) });
  await fixture.emit('recognitionResults', { matches: ['Finished sentence.'], isFinal: true });
  await stop();
  assert.equal(ends[0].reason, 'manual');
  assert.equal(fixture.counts.stops, 0);
  await fixture.tick(20000);
  assert.equal(ends.length, 1);
  assert.equal(fixture.counts.starts, 1);
});

test('no-match ends a single utterance and releases the recognizer', async () => {
  const fixture = await setup(); const ends = [];
  await fixture.listen({ onEnd: end => ends.push(end) });
  await fixture.emit('recognitionError', { code: 7, noSpeech: true });
  assert.equal(ends[0].reason, 'no-speech');
  assert.equal(fixture.counts.cancels, 1);
  await fixture.tick(20000);
  assert.equal(fixture.counts.starts, 1);
});

test('continuous dictation survives silence and stops cleanly during retry', async () => {
  const fixture = await setup(); const ends = [];
  const stop = await fixture.listen({ continuous: true, onEnd: end => ends.push(end) });
  await fixture.emit('recognitionError', { code: 7, noSpeech: true });
  assert.equal(ends.length, 0);
  await fixture.tick(250);
  assert.equal(fixture.counts.starts, 2);
  await fixture.emit('recognitionError', { code: 7, noSpeech: true });
  await stop();
  assert.equal(ends[0].reason, 'manual');
  await fixture.tick(20000);
  assert.equal(fixture.counts.starts, 2);
  assert.equal(fixture.listeners.size, 0);
});
