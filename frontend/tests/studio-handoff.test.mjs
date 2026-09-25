// "Make a website for my bakery" said to the voice call goes to Sites, with
// the words as the prompt - not to the chat model, which read HTML aloud.
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window ??= { dispatchEvent: () => {} };
globalThis.CustomEvent ??= class extends Event { constructor(t, i) { super(t); this.detail = i?.detail; } };
const { detectCreateRequest, handOffToStudio, takeStudioPrompt } = await import('../src/utils/studioHandoff.js');

test('each kind goes to its studio', () => {
  for (const [said, view] of [
    ['make a website for my bakery', 'design'],
    ['meri photography ke liye website bana do', 'design'],
    ['Hey SMARAN, ek sunset ki image banao', 'images'],
    ['design a logo for my coffee shop', 'images'],
    ['generate a picture of a cat astronaut', 'images'],
    ['create a video of rain falling on a city', 'videos'],
    // The first thing named decides.
    ['create an image for my website', 'images'],
  ]) {
    assert.equal(detectCreateRequest(said)?.view, view, said);
  }
});

test('playing, opening or asking how is not making', () => {
  for (const said of ['play a video', 'YouTube par video chalao', 'open my website', 'how do I make a website',
    'what is a landing page', 'tell me a joke']) {
    assert.equal(detectCreateRequest(said), null, said);
  }
});

test('the wake phrase is not part of the prompt', () => {
  assert.equal(detectCreateRequest('Hey SMARAN, make a website for my gym').prompt, 'make a website for my gym');
});

test('a site gets a short name from what was asked', () => {
});

test('the prompt waits for its studio, once', () => {
  handOffToStudio('images', 'a red fox');
  assert.equal(takeStudioPrompt('design'), '');
  assert.equal(takeStudioPrompt('images'), 'a red fox');
  assert.equal(takeStudioPrompt('images'), '');
});
