import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/utils/deviceControl.js', import.meta.url), 'utf8');
async function setup({ floating = false, refused = false, microphone = true, floats = true } = {}) {
  let fallbackCalls = 0;
  let armed = 0;
  const played = [];
  let serviceStarts = 0;
  const plugin = {
    startListeningService: async () => { serviceStarts++; return { listening: true }; },
    prepareFloating: async () => { armed++; return { armed: true }; },
    openApp: async () => ({ opened: true }),
    playMusic: async (args) => { played.push(args); return { opened: true, mode: 'search' }; },
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
    answerFollowUp: (asked, answer) => (answer === 'kesariya' ? { action: 'music', query: 'kesariya', app: asked.app } : null),
    cancelledLine: () => 'Okay.',
    ensureMicrophone: async () => microphone,
    floatsAtAll: () => floats,
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
    armed: () => armed,
    played,
    handle: module.namespace.handleIfDeviceCommand,
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

// "Off" in Settings means opening an app leaves SMARAN where it is: nothing
// armed for auto-enter, and no direct request for the window afterwards.
test('a floating window turned off in Settings is never requested', async () => {
  const fixture = await setup({ floats: false });
  const result = await fixture.run({ action: 'app', name: 'whatsapp' });
  assert.equal(fixture.armed(), 0);
  assert.equal(fixture.calls(), 0);
  assert.equal(result.floated, false);

  const on = await setup({ floats: true });
  await on.run({ action: 'app', name: 'whatsapp' });
  assert.equal(on.armed(), 1);
});

// "Play music on Spotify" -> "Which song?" -> "kesariya": the answer is read
// against the question, once, and only the very next thing said.
test('a question is answered by the next utterance, and only that one', async () => {
  const fixture = await setup();
  const ask = { action: 'ask', about: 'song', app: 'Spotify', question: 'Which song should I play on Spotify?' };
  const first = await fixture.run(ask);
  assert.equal(first.awaitsAnswer, true);
  assert.equal(first.spoken, ask.question);
  assert.equal(fixture.armed(), 0, 'asking opens nothing and floats nothing');

  const answered = await fixture.handle('kesariya');
  assert.equal(JSON.stringify(fixture.played), JSON.stringify([{ query: 'kesariya', app: 'Spotify' }]));
  assert.equal(answered.startsPlayback, true);

  // The question is spent: the same word again is not an answer to anything.
  assert.equal(await fixture.handle('kesariya'), null);
});
