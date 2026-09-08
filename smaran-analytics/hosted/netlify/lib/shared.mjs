/** Shared vocabulary and helpers for the analytics functions. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

/**
 * Deploy only one-way verifiers for the randomly generated API keys.
 * Raw keys remain on the client/local machine. Existing server environment
 * configuration is supported without including its plaintext in any bundle.
 */
let cachedHashes = null;

const fileHashes = () => {
  if (cachedHashes) return cachedHashes;
  try {
    // Bundlers inline this helper into different function entry points. The
    // included file stays at the Lambda task root, independent of entry depth.
    cachedHashes = JSON.parse(readFileSync(resolve(process.env.LAMBDA_TASK_ROOT || process.cwd(), 'key-hashes.json'), 'utf8'));
  } catch {
    cachedHashes = {};
  }
  return cachedHashes;
};

export const hashKey = (key) => createHash('sha256').update(key, 'utf8').digest('hex');
const environmentValue = (name) => globalThis.Netlify?.env?.get(name) ?? process.env[name];

export const keyHash = (kind) => {
  if (!['ingest', 'dashboard'].includes(kind)) return '';
  const prefix = `ANALYTICS_${kind.toUpperCase()}_KEY`;
  const raw = (environmentValue(prefix) || '').trim();
  const digest = raw ? hashKey(raw) : (environmentValue(`${prefix}_SHA256`) ?? fileHashes()[kind] ?? '');
  return typeof digest === 'string' && /^[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : '';
};

export const matchesKeyHash = (given, expected) => {
  if (typeof given !== 'string' || !given || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return cryptoTimingSafeEqual(Buffer.from(hashKey(given), 'hex'), Buffer.from(expected, 'hex'));
};


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

export const WEB_LABELS = ['exe', 'apk', 'vsix', 'cli', 'linux', 'page', 'unknown'];

export const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
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
const validDay = (day) => {
  const value = String(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Use dates in YYYY-MM-DD format.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Choose valid calendar dates.');
  }
  return date;
};

export const daysBetween = (start, end) => {
  const out = [];
  const cursor = validDay(start);
  const last = validDay(end);
  const count = (last - cursor) / 86400000 + 1;
  if (count < 1 || count > 3650) throw new RangeError('Choose an ordered range of at most 3650 days.');
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
    const to = end || today();
    validDay(to);
    const from = start || shiftDay(to, -3649);
    const span = daysBetween(from, to).length;
    return { from, to, span };
  }
  const span = days == null || days === '' ? 30 : Number(days);
  if (!Number.isInteger(span) || span < 1 || span > 3650) {
    throw new RangeError('Days must be an integer between 1 and 3650.');
  }
  return { from: shiftDay(today(), -(span - 1)), to: today(), span };
};

/** Guards the dashboard's data. The page itself is public; these are not. */
export const requireDashboardKey = (req) => {
  const expected = keyHash('dashboard');
  if (!expected) return json({ detail: 'Dashboard access is not configured.' }, 503);
  const url = new URL(req.url);
  const given = req.headers.get('x-dashboard-key') || url.searchParams.get('key') || '';
  if (!matchesKeyHash(given, expected)) {
    return json({ detail: 'Bad or missing dashboard key.' }, 401);
  }
  return null;
};
