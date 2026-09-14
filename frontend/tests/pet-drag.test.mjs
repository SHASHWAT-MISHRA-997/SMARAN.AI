/**
 * The companion can be moved, and looks like the assistant.
 *
 * It was fixed to the bottom-right corner by .sm-pet with no way to move it,
 * so it sat on top of whatever happened to be under that corner and stayed
 * there. It was also just a figure on the page, with nothing marking it out.
 *
 * Two things are easy to get wrong here and both are checked:
 *
 * - the decorative ring must not swallow the press. The frame is
 *   pointer-events-none and only an inner wrapper takes events, so a ring
 *   drawn over the avatar would intercept the click and the drag that the
 *   button underneath needs.
 * - the dragged position must win over the CSS corner. .sm-pet sets right and
 *   bottom; a box cannot honour those and left/top at once, so the inline
 *   style has to clear them.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(here, '..', 'src', 'components', 'DesktopPet.jsx'), 'utf8');
const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8');

function ringRule() {
  const found = /\.sm-pet-ring\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(found, '.sm-pet-ring is gone from the stylesheet');
  return found[1];
}

test('the ring cannot intercept the press that drags the companion', () => {
  assert.match(ringRule(), /pointer-events:\s*none/,
    'the ring takes pointer events, so it will swallow the click and the drag');
  assert.match(jsx, /aria-hidden="true"\s+className="sm-pet-ring"/,
    'the ring is not marked decorative, so a screen reader will announce it');
});

test('it is a ring, not a filled disc behind the avatar', () => {
  const rule = ringRule();
  assert.match(rule, /border-radius:\s*9999px/, 'the ring is not round');
  assert.match(rule, /mask-composite:\s*(xor|exclude)/,
    'without the mask this paints a solid disc over the companion');
});

test('a dragged position overrides the corner the CSS pins it to', () => {
  assert.match(css, /\.sm-pet\s*\{[\s\S]*?right:/,
    'the corner rule is gone; this test is checking the wrong thing');
  assert.match(jsx, /right:\s*'auto'/,
    'inline left/top is set without clearing right, so both apply and it jumps');
  assert.match(jsx, /bottom:\s*'auto'/,
    'inline left/top is set without clearing bottom, so both apply and it jumps');
});

test('the press is handled and the position is remembered', () => {
  assert.match(jsx, /onPointerDown=\{beginDrag\}/, 'nothing starts a drag');
  assert.match(jsx, /sm_pet_position/, 'the position is not persisted');
  assert.match(jsx, /window\.addEventListener\('pointermove'/, 'nothing follows the pointer');
  assert.match(jsx, /window\.removeEventListener\('pointermove'/,
    'the move listener is never removed, which leaks one per drag');
});

test('it cannot be dragged out of reach', () => {
  assert.match(jsx, /window\.innerWidth\s*-\s*state\.w/,
    'nothing clamps the x position, so it can be dropped off the right edge');
  assert.match(jsx, /window\.innerHeight\s*-\s*state\.h/,
    'nothing clamps the y position, so it can be dropped below the window');
  assert.match(jsx, /addEventListener\('resize'/,
    'a smaller window would strand it outside the viewport');
});

test('a spinning ring is not forced on someone who asked for less motion', () => {
  assert.match(css, /prefers-reduced-motion[\s\S]{0,200}\.sm-pet-ring\s*\{\s*animation:\s*none/,
    'the ring keeps animating under prefers-reduced-motion');
});
