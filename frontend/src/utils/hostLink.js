/**
 * Where the app talks to.
 *
 * On the desktop the answer is trivial: the backend is the page's own origin.
 * In the packaged phone app there is no backend at the origin, so the app has
 * to decide for itself:
 *
 *   * **Linked** — a desktop was paired by scanning its QR code and is
 *     reachable on this network. Everything works: documents, local models,
 *     device control, memory.
 *   * **Standalone** — no desktop in reach. The app keeps working on its own
 *     using the cloud keys stored on the phone, and anything written offline
 *     is queued and merged into the desktop's history the next time the two
 *     meet.
 *
 * The choice is re-checked in the background, so walking in the door with the
 * desktop switched on quietly upgrades the session.
 */

const LINK_KEY = 'sm_host_link';
const REACH_TIMEOUT_MS = 2500;

/** True when running inside the packaged Android/iOS shell. */
export const isNativeApp = () => {
  if (typeof window === 'undefined') return false;
  const capacitor = window.Capacitor;
  return Boolean(capacitor?.isNativePlatform?.() ?? capacitor?.isNative);
};

/** The paired desktop, as stored after scanning its QR code. */
export const loadLink = () => {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveLink = (link) => {
  if (!link) localStorage.removeItem(LINK_KEY);
  else localStorage.setItem(LINK_KEY, JSON.stringify(link));
};

/** Ask a candidate host whether it is a SMARAN.AI backend, briefly. */
export const probeHost = async (baseUrl) => {
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/ping`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return data?.app === 'SMARAN.AI';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Resolve the API base for this launch.
 *
 * Returns `{ base, mode }` where mode is 'origin' (desktop build),
 * 'linked' (paired desktop answered) or 'standalone' (phone on its own).
 */
export const resolveHost = async () => {
  if (!isNativeApp()) {
    return { base: import.meta.env.VITE_API_BASE_URL || '', mode: 'origin' };
  }
  const link = loadLink();
  if (link?.url && await probeHost(link.url)) {
    return { base: link.url, mode: 'linked', link };
  }
  return { base: '', mode: 'standalone', link };
};

/**
 * Pair with a desktop from a scanned QR payload.
 *
 * The payload is the small JSON the desktop encodes: its LAN address and a
 * one-time code. Claiming the code returns a device token that authenticates
 * every later sync.
 */
export const pairWithPayload = async (payload, deviceName = 'Phone') => {
  let parsed;
  try {
    parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    throw new Error('That QR code is not a SMARAN.AI pairing code.');
  }
  if (!parsed?.url || !parsed?.code) {
    throw new Error('That QR code is missing the address or the pairing code.');
  }
  if (!await probeHost(parsed.url)) {
    throw new Error(`${parsed.url} did not answer. Check that both devices are on the same Wi-Fi.`);
  }

  const response = await fetch(`${parsed.url}/api/companion/pairing/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: parsed.code,
      device_name: deviceName,
      device_kind: /tablet|ipad/i.test(navigator.userAgent) ? 'tablet' : 'phone',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || 'Pairing was refused by the desktop.');
  }

  const link = {
    url: parsed.url,
    token: data.token,
    deviceId: data.device_id,
    name: data.name,
    pairedAt: data.paired_at,
  };
  saveLink(link);
  return link;
};

/**
 * Conversation sync.
 *
 * Anything written while the desktop was unreachable is held in local storage
 * and pushed on the next successful contact, so nothing said on the phone is
 * lost because the PC happened to be off.
 */
const PENDING_KEY = 'sm_pending_messages';
const CURSOR_KEY = 'sm_sync_cursor';

export const queueForSync = (message) => {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    pending.push(message);
    // A runaway queue would eventually fill storage; the oldest go first.
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-400)));
  } catch { /* storage full or unavailable */ }
};

export const syncWithHost = async (link) => {
  if (!link?.url || !link?.token) return null;
  let pending = [];
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  } catch { /* ignore */ }

  const since = localStorage.getItem(CURSOR_KEY) || null;
  let data;
  try {
    const response = await fetch(`${link.url}/api/companion/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.token, messages: pending, since }),
    });
    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null; // Desktop is asleep; try again next time.
  }

  // Only clear the queue once the desktop has confirmed it took them.
  localStorage.removeItem(PENDING_KEY);
  if (data.server_time) localStorage.setItem(CURSOR_KEY, data.server_time);
  return data;
};

/** Ask the paired desktop to do something. */
export const askHost = async (link, action, params = {}) => {
  if (!link?.url || !link?.token) {
    throw new Error('No desktop is linked to this device.');
  }
  const response = await fetch(`${link.url}/api/companion/from-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: link.token, action, params }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || 'The desktop refused that request.');
  return data;
};

/** Collect anything the desktop queued for this device. */
export const pollHostCommands = async (link) => {
  if (!link?.url || !link?.token) return [];
  try {
    const response = await fetch(
      `${link.url}/api/companion/commands?token=${encodeURIComponent(link.token)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.commands || [];
  } catch {
    return [];
  }
};
