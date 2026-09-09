import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/utils/deviceControl.js', import.meta.url), 'utf8');
async function setup({ floating = false, refused = false } = {}) {
  let fallbackCalls = 0;
  const plugin = {
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
    registerPlugin: () => plugin,
    isNativeApp: () => true,
    detectDeviceCommand: () => null,
    describeOutcome: () => 'App opened',
  };
  const dependency = new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => dependency);
  await module.evaluate();
  return { run: module.namespace.runDeviceCommand, calls: () => fallbackCalls };
}

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
