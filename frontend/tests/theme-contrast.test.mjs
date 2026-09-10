/**
 * A surface that changes with the theme must take its text with it.
 *
 * The failure this catches is not "a dark panel in light mode" - a panel that
 * is `bg-zinc-900 text-white` in both themes is merely inconsistent, and it is
 * readable. The bug is a background that flips while the text stays put:
 *
 *   bg-white dark:bg-zinc-900 text-zinc-100
 *
 * In dark mode that is near-white on near-black and looks correct. In light
 * mode it is near-white on white. That was the memory import box: you pasted
 * JSON into it and the box stayed empty.
 *
 * The rule is deliberately narrow so it does not cry wolf. It only fires when
 * a single className has a `dark:`-conditional background *and* a text colour
 * with no `dark:` counterpart that would be unreadable against one of the two
 * backgrounds. Ternaries that pair their own background and text per branch -
 * `active ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600'` - are the
 * common shape and are correctly ignored.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    return entry.endsWith('.jsx') ? [full] : [];
  });
}

/** Text shades that vanish on a white background. */
const PALE_TEXT = /(?<![\w:-])text-(?:white|zinc-100|zinc-200|slate-100|slate-200|gray-100)\b/;
/** A background that is white in light mode and dark in dark mode. */
const FLIPPING_BG = /(?<![\w:-])bg-(?:white|zinc-50|slate-50|gray-50)\b(?![/[])/;
const HAS_DARK_BG = /(?<![\w:-])dark:bg-(?:zinc|slate|gray|neutral)-(?:800|900|950)\b/;
const HAS_DARK_TEXT = /(?<![\w:-])dark:text-/;
/** A ternary pairs its own colours per branch; those are fine. */
const TERNARY = /\?[^:]*:/;

test('no element flips its background with the theme while its text stays pale', () => {
  const offenders = [];

  for (const file of jsxFiles(join(root, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (TERNARY.test(line)) return;
      if (!FLIPPING_BG.test(line) || !HAS_DARK_BG.test(line)) return;
      const pale = line.match(PALE_TEXT);
      if (!pale) return;
      // A `dark:text-*` alongside it means the pair was handled deliberately.
      if (HAS_DARK_TEXT.test(line)) return;
      offenders.push(
        `${relative(root, file)}:${index + 1} — ${pale[0]} stays put while the ` +
          'background flips, so it is invisible in light mode',
      );
    });
  }

  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`);
});
