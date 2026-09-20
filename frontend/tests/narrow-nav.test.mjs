/**
 * Every screen the wide layout can reach, the narrow one can reach too.
 *
 * The desktop navigation lives in an <aside> carrying `hidden md:flex`. Below
 * 768px that aside is display:none and a drawer replaces it - and the drawer
 * had only Sites and Plugins & Skills. Design Studio, Terminal and Scheduled
 * were therefore in the markup but in a container that was never shown, so
 * narrowing the window removed them from the application. The views work
 * perfectly at that width; App.jsx renders a header with a Back button for
 * them. Only the way in was missing, which meant someone who resized could
 * not get back to a screen they had been using a moment earlier.
 *
 * Drawer entries are recognised by closing the drawer as they navigate -
 * `onNavigate('x'); setMobileOpen(false)` - which is what distinguishes them
 * from the desktop buttons that navigate and leave the sidebar alone.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, '..', 'src', 'components', 'Sidebar.jsx'),
  'utf8',
);

/**
 * Deliberately absent from the narrow drawer, with the reason.
 *
 * Nothing is here today. An entry is only justified when a screen genuinely
 * cannot work at that size - not merely because it was forgotten, which is
 * the bug this file exists to catch.
 */
const INTENTIONALLY_WIDE_ONLY = new Map([
  ['account', 'Not a view. App.jsx routes it to the settings modal on its '
    + '"Account & Profile" tab, and Settings is in the drawer, so it is '
    + 'already reachable at any width.'],
  ['updates', 'Not a view either - the same settings modal on its "updates" '
    + 'tab, reached through the Settings entry the drawer already has.'],
  ['scheduled', 'Cron runs on the machine hosting SMARAN, and a phone or a '
    + 'tablet is a client of that machine rather than the machine. The screen '
    + 'loaded there and did nothing, which is why it is absent rather than '
    + 'merely narrow: the desktop entry is itself behind !isHandheld(), so '
    + 'below 768px on a handset there is no destination to mirror.'],
]);

function targets(pattern) {
  return new Set(
    [...source.matchAll(pattern)].map((match) => match[1]),
  );
}

test('every destination the desktop nav offers is in the narrow drawer too', () => {
  const all = targets(/onNavigate\('([a-z]+)'\)/g);
  const inDrawer = targets(/onNavigate\('([a-z]+)'\);\s*setMobileOpen\(false\)/g);

  assert.ok(all.size > 0, 'no navigation targets found at all');
  assert.ok(inDrawer.size > 0, 'the narrow drawer offers no destinations');

  const missing = [...all].filter(
    (t) => !inDrawer.has(t) && !INTENTIONALLY_WIDE_ONLY.has(t),
  );

  assert.deepEqual(
    missing,
    [],
    `unreachable below 768px: ${missing.join(', ')}. These are in the `
      + 'desktop aside (hidden md:flex) with no entry in the drawer that '
      + 'replaces it, so narrowing the window removes them from the app. '
      + 'Add them to the drawer, or record why they cannot work there in '
      + 'INTENTIONALLY_WIDE_ONLY.',
  );
});

test('the ones that were missing are specifically present', () => {
  // Scheduled was the third of these. It is now desktop-only in substance,
  // not just in layout, and INTENTIONALLY_WIDE_ONLY carries the reason.
  for (const view of ['design', 'terminal']) {
    assert.match(
      source,
      new RegExp(`onNavigate\\('${view}'\\);\\s*setMobileOpen\\(false\\)`),
      `${view} has no narrow-width entry point`,
    );
  }
});

test('anything excluded from the drawer carries a stated reason', () => {
  for (const [view, reason] of INTENTIONALLY_WIDE_ONLY) {
    assert.ok(
      typeof reason === 'string' && reason.length > 20,
      `${view} is excluded from the drawer without a real explanation`,
    );
  }
});
