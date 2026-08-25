import { getStore } from '@netlify/blobs';
import { decodeWebKey } from './_shared.mjs';

/**
 * The three numbers the website shows, and the heartbeat behind one of them.
 *
 * These are served without a key because the site prints them for everyone.
 * Only the totals are exposed here — the per-day breakdown, the platforms and
 * the installation list stay behind the dashboard key on /api/*.
 *
 *   POST /live   a tab saying it is still open
 *   GET  /stats  visitors, downloads and who is reading right now
 */

/* Presence is bucketed by the minute and keyed by a per-tab id, so a tab that
   beats twice inside one minute overwrites its own key instead of counting
   twice. Reading two buckets covers a 30-second heartbeat with room for a slow
   request, and needs no deletes on the write path.

   The id is random per tab and never leaves sessionStorage. It identifies a
   tab for as long as that tab is open and nothing else: it is not stored
   against a person, an address or a previous visit, and closing the tab ends
   it for good. */
const MINUTE = (d = new Date()) => d.toISOString().slice(0, 16);

const bucketsBack = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(MINUTE(new Date(Date.now() - i * 60_000)));
  }
  return out;
};

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors },
  });

const liveStore = () => getStore({ name: 'live-v1', consistency: 'strong' });

const beat = async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return reply({ detail: 'Body must be JSON.' }, 400);
  }
  const sid = String(body.sid || '').trim().slice(0, 40);
  if (sid.length < 6) return reply({ detail: 'sid is missing or too short.' }, 400);
  // Only characters a generated id uses, so nothing that could confuse a key.
  if (!/^[a-z0-9]+$/i.test(sid)) return reply({ detail: 'sid is malformed.' }, 400);

  await liveStore().setJSON(`${MINUTE()}/${sid}`, { t: 1 });
  return reply({ ok: true });
};

/** Distinct tabs seen in the last two minute buckets. */
const viewingNow = async () => {
  const store = liveStore();
  const found = new Set();
  await Promise.all(
    bucketsBack(2).map(async (bucket) => {
      const { blobs } = await store.list({ prefix: `${bucket}/` });
      blobs.forEach((b) => found.add(b.key.split('/').pop()));
    }),
  );
  return found.size;
};

/* Buckets older than ten minutes are dead weight. They are swept on a read
   rather than on every heartbeat, so the cost lands on the rarer call, and a
   failed sweep is ignored: stale keys cost a little storage, while a thrown
   error would cost the visitor their numbers. */
const sweep = async () => {
  try {
    const store = liveStore();
    const writes = getStore('live-v1');
    const keep = new Set(bucketsBack(10));
    const { blobs } = await store.list();
    await Promise.all(
      blobs
        .filter((b) => !keep.has(b.key.split('/')[0]))
        .slice(0, 200)
        .map((b) => writes.delete(b.key)),
    );
  } catch { /* not worth failing a read for */ }
};

const GITHUB_RELEASES =
  'https://api.github.com/repos/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases';

/**
 * GitHub's own count, taken where the file is actually served.
 *
 * Cached for ten minutes. Unauthenticated GitHub allows 60 requests an hour
 * per address, and Netlify's functions share addresses with everybody else on
 * the platform, so calling it once per page view spent the allowance almost
 * immediately and the site started showing a dash instead of a number.
 *
 * A failed fetch falls back to the last good value rather than to null, so a
 * rate limit hides the figure only if it has never been read at all. The
 * cached value is kept even once stale for the same reason: a number from ten
 * minutes ago is true, and a dash is not more honest than that.
 */
const CACHE_MS = 10 * 60 * 1000;

const githubDownloads = async () => {
  const cache = getStore('cache-v1');
  let last = null;
  try {
    last = await cache.get('github-downloads', { type: 'json' });
    if (last && Date.now() - last.at < CACHE_MS) return last.total;
  } catch { /* a cache miss is not a failure */ }

  try {
    const res = await fetch(GITHUB_RELEASES, {
      headers: { 'user-agent': 'smaran-analytics', accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return last ? last.total : null;

    const releases = await res.json();
    let total = 0;
    for (const rel of releases) {
      for (const asset of rel.assets || []) total += asset.download_count;
    }
    try {
      await cache.setJSON('github-downloads', { total, at: Date.now() });
    } catch { /* serving the number matters more than remembering it */ }
    return total;
  } catch {
    // null only when there has never been a reading. An unreachable API is
    // not the same as nobody downloading, and the site hides the figure
    // rather than printing a zero that reads as a fact.
    return last ? last.total : null;
  }
};

const stats = async () => {
  const store = getStore({ name: 'web-v1', consistency: 'strong' });

  /* One unprefixed listing. Asking for a day prefix at a time meant 3650 round
     trips for an all-time figure, which timed out rather than answering. The
     event is read from the key, so no blob body is fetched either way. */
  const [rows, downloads, viewing] = await Promise.all([
    store.list().then(({ blobs }) => blobs.map((b) => decodeWebKey(b.key))),
    githubDownloads(),
    viewingNow(),
  ]);

  sweep();

  return reply({
    visitors: rows.filter((r) => r.event === 'visit').length,
    downloads,
    viewing_now: viewing,
  });
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith('/live')) {
      if (req.method !== 'POST') return reply({ detail: 'Method not allowed.' }, 405);
      return await beat(req);
    }
    if (url.pathname.endsWith('/stats')) {
      if (req.method !== 'GET') return reply({ detail: 'Method not allowed.' }, 405);
      return await stats(url);
    }
  } catch (err) {
    return reply({ detail: `Could not read the store: ${err.message}` }, 500);
  }
  return reply({ detail: 'Unknown endpoint.' }, 404);
};

export const config = { path: ['/live', '/stats'] };
