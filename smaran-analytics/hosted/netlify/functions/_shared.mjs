/** Shared vocabulary and helpers for the analytics functions. */

import { readFileSync } from 'node:fs';

/**
 * The ingest and dashboard keys.
 *
 * An environment variable wins if one is set. Otherwise they are read from
 * keys.json, which is uploaded with the deploy and git-ignored: Netlify's
 * connector kept reporting env vars as saved while listing none, so the
 * functions never received them.
 *
 * Read once per cold start, not per request.
 */
let cachedKeys = null;

const fileKeys = () => {
  if (cachedKeys) return cachedKeys;
  try {
    cachedKeys = JSON.parse(readFileSync(new URL('../../keys.json', import.meta.url), 'utf8'));
  } catch {
    cachedKeys = {};
  }
  return cachedKeys;
};

export const ingestKey = () =>
  (process.env.ANALYTICS_INGEST_KEY || fileKeys().ingest || '').trim();

export const dashboardKey = () =>
  (process.env.ANALYTICS_DASHBOARD_KEY || fileKeys().dashboard || '').trim();


export const ALLOWED_EVENTS = [
  'install', 'launch', 'heartbeat', 'signup', 'login', 'google_signin',
];

/* What sent the event, not merely which operating system it ran on.
 *
 * Only the desktop app reported anything, so the dashboard could only ever
 * say "windows" - the phone, the command line and the editor extension were
 * invisible however many people used them. Reporting the surface separately
 * is the difference between "3 installs" and knowing where they are.
 *
 * The three desktop values stay as they were so existing rows keep meaning
 * what they meant. */
export const ALLOWED_PLATFORMS = [
  'windows', 'macos', 'linux',   // the desktop app
  'android',                     // the phone app
  'cli',                         // smaran.exe
  'vscode',                      // the editor extension
  'unknown',
];

/* Events from the marketing site, which is a different thing from an install.
   `visit` is counted once per browsing session, so it is a count of visits and
   not of people: telling those apart needs a cookie or a fingerprint, and the
   site promises neither.

   `download_click` records that a download link was pressed. It is not the
   same number as a completed download — GitHub counts those itself, server
   side, and the dashboard shows that figure separately. A click that never
   finishes still counts here, which is why the two are never added together. */
export const WEB_EVENTS = ['visit', 'download_click'];

export const WEB_LABELS = ['exe', 'apk', 'vsix', 'cli', 'page', 'unknown'];

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Counters must never be served from a cache; a stale dashboard that
      // looks live is worse than one that is slow.
      'cache-control': 'no-store',
    },
  });

export const dayOf = (iso) => iso.slice(0, 10);

/* An event's whole record lives in its key, so a range can be aggregated by
   listing prefixes without fetching a single blob body.

   The record is base64url-encoded rather than percent-encoded and joined.
   Percent-encoding put characters like %3A and %2B in the key; listing
   returned them decoded, so delete() was called with a key that had never
   been written and silently removed nothing - which meant an erasure request
   reported success and left the data in place. base64url has no character
   that any layer will rewrite. */

const b64url = (text) =>
  Buffer.from(text, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (text) =>
  Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export const encodeEventKey = ({ ts, event, platform, appVersion, installId }) =>
  b64url(JSON.stringify([ts, event, platform, appVersion, installId, Math.random().toString(36).slice(2, 8)]));

export const encodeWebKey = ({ ts, event, label }) =>
  b64url(JSON.stringify([ts, event, label, Math.random().toString(36).slice(2, 8)]));

export const decodeWebKey = (key) => {
  const [ts, event, label] = JSON.parse(unb64url(key.split('/').pop()));
  return { ts, event, label };
};

export const decodeEventKey = (key) => {
  const [ts, event, platform, appVersion, installId] = JSON.parse(unb64url(key.split('/').pop()));
  return { ts, event, platform, app_version: appVersion, install_id: installId };
};

/** Compare in constant time, so a wrong key cannot be guessed byte by byte. */
export const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
};

/** Every date from start to end inclusive, as YYYY-MM-DD. */
export const daysBetween = (start, end) => {
  const out = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  // A guard rather than a while(true): a bad pair of dates should return an
  // empty range, not spin.
  for (let i = 0; cursor <= last && i < 3650; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};

export const shiftDay = (day, delta) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Resolve the reporting window.
 *
 * Explicit dates win over a rolling count, so any month or year can be looked
 * at rather than only the last week, month or quarter.
 */
export const resolveWindow = ({ days, start, end }) => {
  if (start || end) {
    const from = start || shiftDay(today(), -3650);
    const to = end || today();
    const span = Math.max(1, daysBetween(from, to).length - 1);
    return { from, to, span };
  }
  const span = Math.min(Math.max(Number(days) || 30, 1), 3650);
  return { from: shiftDay(today(), -(span - 1)), to: today(), span };
};

/** Guards the dashboard's data. The page itself is public; these are not. */
export const requireDashboardKey = (req) => {
  const expected = dashboardKey();
  if (!expected) return json({ detail: 'Dashboard access is not configured.' }, 503);
  const url = new URL(req.url);
  const given = req.headers.get('x-dashboard-key') || url.searchParams.get('key') || '';
  if (!timingSafeEqual(given, expected)) {
    return json({ detail: 'Bad or missing dashboard key.' }, 401);
  }
  return null;
};
