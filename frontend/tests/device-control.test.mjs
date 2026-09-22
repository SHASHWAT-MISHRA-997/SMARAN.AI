import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/utils/deviceControl.js', import.meta.url), 'utf8');
async function setup({ floating = false, refused = false, microphone = true } = {}) {
  let fallbackCalls = 0;
  let serviceStarts = 0;
  const plugin = {
    startListeningService: async () => { serviceStarts++; return { listening: true }; },
    prepareFloating: async () => ({ armed: true }),
    openApp: async () => ({ opened: true }),
    isFloating: async () => ({ floating }),
    enterFloating: async () => {
      fallbackCalls++;
      if (refused) throw new Error('Activity stopped');
      return { floating: false };
    },
  };
  const context = vm.createContext({ setTimeout: cb => { cb(); }, console });
  const values = {
    device: plugin,
    isNativeApp: () => true,
    detectDeviceCommand: () => null,
    describeOutcome: () => 'App opened',
    ensureMicrophone: async () => microphone,
  };
  const dependency = new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => dependency);
  await module.evaluate();
  return {
    run: module.namespace.runDeviceCommand,
    calls: () => fallbackCalls,
    startListening: module.namespace.startBackgroundListening,
    serviceStarts: () => serviceStarts,
  };
}

// The crash that closed the app whenever a voice call opened: the listening
// service was started before the microphone had been granted, and Android
// kills an app whose microphone service starts without it.
test('background listening never starts the service without the microphone', async () => {
  const denied = await setup({ microphone: false });
  assert.equal(await denied.startListening(), false);
  assert.equal(denied.serviceStarts(), 0);

  const granted = await setup({ microphone: true });
  assert.equal(await granted.startListening(), true);
  assert.equal(granted.serviceStarts(), 1);
});

for (const refused of [false, true]) {
  test(`arming PiP does not report success when entry is refused (${refused})`, async () => {
    const fixture = await setup({ refused });
    const result = await fixture.run({ action: 'app', name: 'youtube' });
    assert.equal(result.floated, false);
    assert.equal(result.spoken, 'App opened');
  });
}

test('observed floating state skips a duplicate PiP request', async () => {
  const fixture = await setup({ floating: true });
  assert.equal((await fixture.run({ action: 'app', name: 'youtube' })).floated, true);
  assert.equal(fixture.calls(), 0);
});
