import { getStore } from '@netlify/blobs';
import {
  daysBetween, decodeEventKey, json, requireDashboardKey, resolveWindow, shiftDay, today,
} from './_shared.mjs';

/**
 * The dashboard's read API: summary, installs and recent.
 *
 * Every event's record is encoded in its blob key, so a window is aggregated
 * by listing the day prefixes it covers. No blob body is fetched, which keeps
 * a year-long window about as cheap as a week.
 */

/**
 * Reads use strong consistency.
 *
 * The default is eventual, and the lag is tens of seconds: a dashboard would
 * show numbers that quietly lag reality, and worse, an erasure request would
 * list a stale set of events and leave some behind while reporting success.
 * Correctness matters more here than the small latency cost.
 */
const readStore = (name) => getStore({ name, consistency: 'strong' });

const listDays = async (store, days) => {
  const batches = await Promise.all(
    days.map(async (day) => {
      const { blobs } = await store.list({ prefix: `${day}/` });
      return blobs.map((b) => decodeEventKey(b.key));
    }),
  );
  return batches.flat();
};

const countBy = (rows, field) =>
  rows.reduce((acc, row) => {
    acc[row[field]] = (acc[row[field]] || 0) + 1;
    return acc;
  }, {});

/** Percentage change, or null when there is nothing to compare against. */
const change = (now, was) => (was ? Math.round(((now - was) / was) * 1000) / 10 : null);

const summary = async (url) => {
  const { from, to, span } = resolveWindow({
    days: url.searchParams.get('days'),
    start: url.searchParams.get('start'),
    end: url.searchParams.get('end'),
  });

  const events = readStore('events-v2');
  const installs = readStore('installs');

  const windowDays = daysBetween(from, to);
  const priorFrom = shiftDay(from, -span);
  const priorDays = daysBetween(priorFrom, shiftDay(from, -1));

  const [rows, priorRows, installList] = await Promise.all([
    listDays(events, windowDays),
    listDays(events, priorDays),
    installs.list().then(({ blobs }) =>
      Promise.all(blobs.map((b) => installs.get(b.key, { type: 'json' }))),
    ),
  ]);

  const known = installList.filter(Boolean);
  const counts = countBy(rows, 'event');
  const prior = countBy(priorRows, 'event');

  const since = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const newInWindow = known.filter((i) => i.first_seen >= from && i.first_seen <= `${to}T23:59:59`).length;
  const newPrevious = known.filter((i) => i.first_seen >= priorFrom && i.first_seen < from).length;

  const daily = windowDays.map((day) => {
    const ofDay = rows.filter((r) => r.ts.slice(0, 10) === day);
    return {
      day,
      installs: ofDay.filter((r) => r.event === 'install').length,
      launches: ofDay.filter((r) => r.event === 'launch').length,
    };
  });

  const versions = Object.fromEntries(
    Object.entries(countBy(known, 'app_version')).sort((a, b) => b[1] - a[1]).slice(0, 12),
  );

  return json({
    window_days: span,
    window_start: from,
    window_end: to,
    trend: {
      new_installs: change(newInWindow, newPrevious),
      launches: change(counts.launch || 0, prior.launch || 0),
      signups: change(counts.signup || 0, prior.signup || 0),
      logins: change(counts.login || 0, prior.login || 0),
      google_signins: change(counts.google_signin || 0, prior.google_signin || 0),
    },
    total_installs: known.length,
    active_24h: known.filter((i) => i.last_seen >= since(1)).length,
    active_7d: known.filter((i) => i.last_seen >= since(7)).length,
    new_installs: newInWindow,
    signups: counts.signup || 0,
    logins: counts.login || 0,
    google_signins: counts.google_signin || 0,
    launches: counts.launch || 0,
    platforms: countBy(known, 'platform'),
    versions,
    daily,
  });
};

const installsRoute = async (url) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 1000);
  const store = readStore('installs');
  const { blobs } = await store.list();
  const rows = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' }))))
    .filter(Boolean)
    .sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))
    .slice(0, limit);
  return json({ installs: rows });
};

const recentRoute = async (url) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 120, 1), 1000);
  const store = readStore('events-v2');
  // Walk back a day at a time and stop as soon as there is enough, rather
  // than listing the whole history to show the newest hundred.
  const rows = [];
  let day = today();
  for (let i = 0; i < 90 && rows.length < limit; i += 1) {
    const { blobs } = await store.list({ prefix: `${day}/` });
    rows.push(...blobs.map((b) => decodeEventKey(b.key)));
    day = shiftDay(day, -1);
  }
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return json({
    events: rows.slice(0, limit).map((r) => ({
      install_id: r.install_id,
      event: r.event,
      platform: r.platform,
      app_version: r.app_version,
      received_at: r.ts,
    })),
  });
};

/**
 * Erase one installation and every event it ever sent.
 *
 * Not a convenience: the DPDP Act and the GDPR both give a person the right
 * to have their records deleted, and a collector with no way to honour that
 * is a collector that cannot lawfully be run.
 */
const eraseRoute = async (url) => {
  const installId = url.searchParams.get('install_id');
  if (!installId) return json({ detail: 'install_id is required.' }, 400);

  // List through the strongly consistent view so nothing recent is missed,
  // but delete through a plain handle: deletes issued against the strong
  // handle reported success and removed nothing.
  const events = readStore('events-v2');
  const installs = readStore('installs');
  const eventWrites = getStore('events-v2');
  const installWrites = getStore('installs');

  // Only the days this installation could have written to. Walking a fixed
  // ten years would be thousands of listings and would time out long before
  // it finished.
  const record = await installs.get(installId, { type: 'json' });
  const from = record ? record.first_seen.slice(0, 10) : shiftDay(today(), -365);
  const span = daysBetween(from, today());

  const removals = await Promise.all(
    span.map(async (day) => {
      const { blobs } = await events.list({ prefix: `${day}/` });
      const mine = blobs.filter((b) => decodeEventKey(b.key).install_id === installId);
      await Promise.all(mine.map((b) => eventWrites.delete(b.key)));
      return mine.length;
    }),
  );

  await installWrites.delete(installId);
  return json({
    erased: installId,
    events_removed: removals.reduce((a, b) => a + b, 0),
    days_scanned: span.length,
  });
};

export default async (req) => {
  const denied = requireDashboardKey(req);
  if (denied) return denied;

  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith('/summary')) return await summary(url);
    if (url.pathname.endsWith('/installs')) return await installsRoute(url);
    if (url.pathname.endsWith('/recent')) return await recentRoute(url);
    if (url.pathname.endsWith('/erase')) return await eraseRoute(url);
  } catch (err) {
    return json({ detail: `Could not read the store: ${err.message}` }, 500);
  }
  return json({ detail: 'Unknown endpoint.' }, 404);
};

export const config = { path: '/api/*' };
