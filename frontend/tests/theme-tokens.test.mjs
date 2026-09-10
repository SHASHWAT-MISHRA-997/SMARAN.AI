/**
 * Theme tokens have to be declared symmetrically, or light mode goes missing.
 *
 * Tailwind v4 tree-shakes `@theme`: a variable no utility references is never
 * emitted into `:root`. The `.dark` and `.theme-system` blocks in index.css are
 * hand-written CSS, so they are emitted regardless. Put those two together and
 * a token used by nobody ends up defined in dark and undefined in light - which
 * is invisible until somebody writes `bg-surface`, sees it work in dark mode,
 * ships it, and it paints transparent for every light-mode user.
 *
 * That is exactly what happened to `--color-surface`. These tests pin the two
 * halves of the invariant:
 *   1. every token overridden under `.dark`/`.theme-system` also has a `@theme`
 *      default, and
 *   2. every token in the set is actually referenced by a utility, so Tailwind
 *      keeps it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/index.css'), 'utf8');

/** Pull the body of a top-level rule with the given selector. */
function blockFor(selector) {
  const at = css.indexOf(`\n${selector} {`);
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

const tokensIn = (body) =>
  new Set([...(body ?? '').matchAll(/(--color-[\w-]+)\s*:/g)].map((m) => m[1]));

const themeDefaults = tokensIn(blockFor('@theme'));

test('the @theme block actually exists and defines colour tokens', () => {
  assert.ok(themeDefaults.size > 0, 'no --color-* tokens found in @theme');
});

for (const selector of ['.dark', '.dark.theme-system', '.light.theme-system']) {
  test(`every token overridden under ${selector} has a @theme default`, () => {
    const body = blockFor(selector);
    if (body === null) return; // that variant is not present; nothing to check
    const missing = [...tokensIn(body)].filter((t) => !themeDefaults.has(t));
    assert.deepEqual(
      missing,
      [],
      `${selector} overrides ${missing.join(', ')} but :root never defines ` +
        'them, so light mode gets no value at all',
    );
  });
}

/** Every .jsx under src, so we can see which utilities are really used. */
function jsxFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    return entry.endsWith('.jsx') ? [full] : [];
  });
}

const source = jsxFiles(join(root, 'src'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

test('no theme token is left unreferenced, which is what lets it be shaken out', () => {
  // `bg-surface`, `text-ink`, `border-line` - the utility name is the token
  // name with the `--color-` prefix dropped.
  const orphans = [...themeDefaults].filter((token) => {
    const name = token.replace('--color-', '');
    return !new RegExp(`(?:bg|text|border|from|via|to|ring|fill)-${name}\\b`).test(source);
  });
  assert.deepEqual(
    orphans,
    [],
    `these tokens are declared but no utility uses them, so Tailwind drops ` +
      `them from :root: ${orphans.join(', ')}`,
  );
});
