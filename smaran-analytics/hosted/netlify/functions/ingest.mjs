import { getStore } from '@netlify/blobs';
import { ALLOWED_EVENTS, ALLOWED_PLATFORMS, dayOf, encodeEventKey, ingestKey, json, timingSafeEqual } from './_shared.mjs';

/**
 * Records one event from an installation.
 *
 * Two stores are written:
 *
 *   events   — one blob per event, written once and never modified. The key
 *              carries everything the summary needs, so aggregating a range
 *              is a prefix listing and reads no blob bodies at all.
 *
 *   installs — one blob per installation, read-modify-write. Two events from
 *              the same installation arriving at the same instant could lose
 *              a launch increment; that is a counter being off by one on a
 *              number nobody makes decisions from, and the alternative is a
 *              lock this does not warrant.
 */
/* The phone app is a web page, so its POST is cross-origin and the browser
 * sends a preflight first. Without an answer to that preflight the request
 * never leaves the device - the console said "blocked by CORS policy", and
 * the phone could never have reported a single install however correct the
 * app's own code was.
 *
 * Only the ingest route opens up, and only for the two things a counter
 * needs. The dashboard route stays closed: it reads data, and nothing but the
 * dashboard should be able to ask it anything. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-ingest-key',
  'access-control-max-age': '86400',
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') return json({ detail: 'Method not allowed.' }, 405, CORS);

  const expected = ingestKey();
  if (!expected) return json({ detail: 'Ingest is not configured.' }, 503, CORS);
  if (!timingSafeEqual(req.headers.get('x-ingest-key') || '', expected)) {
    return json({ detail: 'Bad ingest key.' }, 401, CORS);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ detail: 'Body must be JSON.' }, 400, CORS);
  }

  const installId = String(body.install_id || '').trim();
  if (installId.length < 8 || installId.length > 64) {
    return json({ detail: 'install_id is missing or the wrong length.' }, 400, CORS);
  }

  const event = String(body.event || '').trim().toLowerCase();
  if (!ALLOWED_EVENTS.includes(event)) {
    return json({ detail: `'${event}' is not a recorded event.` }, 400, CORS);
  }

  let platform = String(body.platform || 'unknown').trim().toLowerCase();
  if (!ALLOWED_PLATFORMS.includes(platform)) platform = 'unknown';

  const appVersion = String(body.app_version || 'unknown').slice(0, 32);
  const osVersion = body.os_version ? String(body.os_version).slice(0, 64) : '';
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');

  const events = getStore('events-v2');
  const installs = getStore('installs');

  // A body, not an empty string. Blobs written empty show up in list() but
  // delete() will not remove them, which makes an erasure request impossible
  // to honour. The key still carries everything the summary reads, so the
  // body is only a fallback and a guarantee the blob is real.
  await events.setJSON(
    `${dayOf(now)}/${encodeEventKey({ ts: now, event, platform, appVersion, installId })}`,
    { ts: now, event, platform, app_version: appVersion, install_id: installId },
  );

  const existing = await installs.get(installId, { type: 'json' });
  if (existing) {
    await installs.setJSON(installId, {
      ...existing,
      platform,
      app_version: appVersion,
      os_version: osVersion,
      last_seen: now,
      launches: (existing.launches || 0) + (event === 'launch' ? 1 : 0),
    });
  } else {
    await installs.setJSON(installId, {
      install_id: installId,
      platform,
      app_version: appVersion,
      os_version: osVersion,
      first_seen: now,
      last_seen: now,
      launches: event === 'launch' ? 1 : 0,
    });
  }

  return json({ recorded: true }, 200, CORS);
};

export const config = { path: '/ingest' };
