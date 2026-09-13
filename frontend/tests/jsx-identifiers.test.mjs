/**
 * Every component used in JSX is actually defined.
 *
 * `<Send className="h-4 w-4"/>` was added to Sidebar.jsx while `Send` was not
 * among the icons imported from lucide-react. `npm run build` succeeded -
 * bundlers resolve modules, not identifiers - so nothing failed until the
 * component rendered, at which point a ReferenceError takes out the whole
 * sidebar. Caught here by reading the source instead of trusting the build.
 *
 * Deliberately conservative: it only looks at capitalised, non-namespaced tags
 * and counts any import, local declaration or destructure as a definition. It
 * is meant to catch a name that exists nowhere, not to police style.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'src');

function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsxFiles(full));
    else if (entry.endsWith('.jsx')) out.push(full);
  }
  return out;
}

/** Names this file brings into scope, however it does so. */
function defined(source) {
  const names = new Set();
  const add = (raw) => {
    for (const piece of raw.split(',')) {
      // `Foo as Bar` binds Bar; `{ a, b }` inside a destructure binds each.
      const name = piece.split(/\bas\b/).pop().replace(/[{}\s]/g, '');
      if (name) names.add(name);
    }
  };

  for (const m of source.matchAll(/import\s+([^;]+?)\s+from\s+['"]/g)) add(m[1]);
  for (const m of source.matchAll(/(?:const|let|var|function|class)\s+([A-Z]\w*)/g)) {
    names.add(m[1]);
  }
  // Any destructuring pattern, including renames in a parameter list:
  // `({ icon: Icon, children })` binds Icon, and a component that arrives as
  // a prop is the common way these files take an icon. Object literals get
  // scanned too, which can only hide a fault, never invent one - the right
  // trade for a guard whose value is being quiet until it is certain.
  // Array patterns are included for the same reason: a row rendered from a
  // tuple - `.map(([label, value, note, Icon, color]) => ...)` - binds Icon
  // positionally, with no name to key on.
  for (const m of source.matchAll(/[{[]([^{}[\]]*)[}\]]/g)) {
    for (const piece of m[1].split(',')) {
      const renamed = piece.match(/:\s*([A-Z]\w*)\s*$/);
      if (renamed) { names.add(renamed[1]); continue; }
      const plain = piece.match(/^\s*\.{0,3}\s*([A-Z]\w*)\s*$/);
      if (plain) names.add(plain[1]);
    }
  }
  return names;
}

/** Capitalised JSX tags, which React resolves as identifiers. */
function used(source) {
  const names = new Set();
  for (const m of source.matchAll(/<([A-Z]\w*)(?=[\s/>])/g)) names.add(m[1]);
  return names;
}

// React.Fragment shorthand and members like <Foo.Bar> are skipped by the
// pattern above; nothing else is exempt.
const files = jsxFiles(root);

test('every JSX component name resolves to something in its file', () => {
  assert.ok(files.length > 0, 'no .jsx files found');

  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const known = defined(source);
    for (const name of used(source)) {
      if (!known.has(name)) {
        problems.push(`${file.slice(root.length + 1)}: <${name}> is never defined`);
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    'These render as a ReferenceError at runtime and the build will not '
      + 'complain:\n  ' + problems.join('\n  '),
  );
});
