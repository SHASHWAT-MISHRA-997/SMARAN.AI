import { getStore } from '@netlify/blobs';
import { WEB_EVENTS, WEB_LABELS, dayOf, encodeWebKey, json } from './_shared.mjs';

/**
 * Records one event from the public website.
 *
 * Unlike /ingest this takes no key. It cannot: the caller is a script served
 * to every visitor, so any key it carried would be readable by opening the
 * page source. Anyone who finds this endpoint can therefore inflate the
 * counters, and the dashboard says so rather than presenting the number as
 * something it is not. The figure worth trusting for downloads is GitHub's,
 * which is counted server side and cannot be pushed up from here.
 *
 * Nothing identifying is written. No IP address, no user agent, no referrer,
 * no cookie and no id of any kind — only the day, which of two events it was,
 * and a label saying which download was pressed. That is the whole record,
 * and it is why the site can still say nothing about a visitor is uploaded.
 */

/* An origin allowlist keeps the counters answering for this site rather than
   for whoever embeds the script somewhere else. It is not a security control —
   Origin is set by the caller — it just stops accidental cross-counting. */
const ALLOWED_ORIGINS = [
  'https://smaran-ai.netlify.app',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const cors = (origin) => ({
  'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
});

export default async (req) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (req.method !== 'POST') {
    return json({ detail: 'Method not allowed.' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ detail: 'Body must be JSON.' }, 400);
  }

  const event = String(body.event || '').trim().toLowerCase();
  if (!WEB_EVENTS.includes(event)) {
    return json({ detail: `'${event}' is not a recorded event.` }, 400);
  }

  let label = String(body.label || 'page').trim().toLowerCase();
  if (!WEB_LABELS.includes(label)) label = 'unknown';

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const web = getStore('web-v1');

  await web.setJSON(
    `${dayOf(now)}/${encodeWebKey({ ts: now, event, label })}`,
    { ts: now, event, label },
  );

  return new Response(JSON.stringify({ recorded: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
  });
};

export const config = { path: '/hit' };
