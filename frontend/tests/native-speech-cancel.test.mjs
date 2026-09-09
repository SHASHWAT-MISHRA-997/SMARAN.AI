import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('ending speech while native listeners initialize prevents late playback', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let plays = 0;
  let removed = 0;
  const plugin = {
    stopSpeaking: async () => {},
    speak: async () => { plays++; },
    addListener: async () => { entered(); await gate; return { remove: async () => { removed++; } }; },
  };
  const context = vm.createContext({ console, Date, Math });
  const dep = new vm.SyntheticModule(['registerPlugin'], function () {
    this.setExport('registerPlugin', () => plugin);
  }, { context });
  const source = await readFile(new URL('../src/utils/nativeSpeech.js', import.meta.url), 'utf8');
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(() => dep);
  await mod.evaluate();
  const pending = mod.namespace.speak({ text: 'This must not play after ending the call' });
  await ready;
  await mod.namespace.stopSpeaking();
  release();
  await pending;
  assert.equal(plays, 0);
  assert.equal(removed, 4);
});

test('a stale utterance stop handle cannot stop a newer reply', async () => {
  let stops = 0;
  const plugin = {
    stopSpeaking: async () => { stops++; },
    speak: async () => {},
    addListener: async () => ({ remove: async () => {} }),
  };
  const context = vm.createContext({ console, Date, Math });
  const dep = new vm.SyntheticModule(['registerPlugin'], function () {
    this.setExport('registerPlugin', () => plugin);
  }, { context });
  const source = await readFile(new URL('../src/utils/nativeSpeech.js', import.meta.url), 'utf8');
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(() => dep);
  await mod.evaluate();
  const oldReply = await mod.namespace.speak({ text: 'Old reply' });
  const currentReply = await mod.namespace.speak({ text: 'Current reply' });
  const before = stops;
  await oldReply.stop();
  assert.equal(stops, before);
  await currentReply.stop();
  assert.equal(stops, before + 1);
});
