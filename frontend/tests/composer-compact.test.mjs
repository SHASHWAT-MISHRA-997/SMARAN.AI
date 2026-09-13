/**
 * Whatever hides the composer's tools must leave a way back to them.
 *
 * The composer has two tool groups for wide layouts and a plus button that
 * holds the same things for narrow ones. The groups are hidden by a container
 * query measuring the chat workspace; the plus button was shown by Tailwind's
 * `sm:hidden`, which measures the viewport. Those are different numbers
 * whenever the workspace is narrower than the window - a docked panel, a
 * split view, a half-width window - and in that gap both disappeared. Speak,
 * Web ON, Compare, Attach and the language picker left the screen with
 * nothing to say where they had gone.
 *
 * Asserted against the source stylesheet rather than a rendered page, because
 * the rule has to be right for every width, not the handful a test picks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8');

/** The body of the first @container block that mentions `selector`. */
function containerBlockHiding(selector) {
  const start = css.indexOf('@container chat-workspace');
  assert.notEqual(start, -1, 'the chat-workspace container query is gone');

  // Walk braces from the block's opening one so nested rules stay included.
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = css.slice(open + 1, i);
        assert.ok(body.includes(selector), `${selector} is not in this block`);
        return body;
      }
    }
  }
  throw new Error('unbalanced braces in index.css');
}

test('hiding the desktop tool groups also reveals the button that replaces them', () => {
  const body = containerBlockHiding('.composer-desktop-left');

  assert.match(
    body,
    /\.composer-desktop-left[^}]*display:\s*none/,
    'expected this block to hide the desktop tool groups',
  );

  assert.match(
    body,
    /\.composer-compact-more\s*\{[^}]*display:\s*flex/,
    'the desktop tool groups are hidden here but .composer-compact-more is not '
      + 'shown, so at these widths nothing on screen opens Speak, Web, Compare, '
      + 'Attach or the language picker',
  );
});

test('the compact tools and send button are revealed by the same block', () => {
  const body = containerBlockHiding('.composer-desktop-left');
  for (const selector of ['.composer-compact-tools', '.composer-compact-send']) {
    assert.match(
      body,
      new RegExp(`\\${selector}[^}]*display:\\s*flex`),
      `${selector} must be shown wherever the desktop groups are hidden`,
    );
  }
});

test('the plus button still carries the class the container query targets', () => {
  const jsx = readFileSync(
    join(here, '..', 'src', 'components', 'ChatArea.jsx'),
    'utf8',
  );
  assert.ok(
    jsx.includes('composer-compact-more'),
    'ChatArea no longer renders composer-compact-more, so the CSS rule that '
      + 'restores the opener has nothing to apply to',
  );
});
