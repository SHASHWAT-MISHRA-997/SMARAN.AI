import { loadLink } from './hostLink.js';

/**
 * The pairing token, as a header, when this browser is a paired device.
 *
 * The device-management screens talk to the desktop over the LAN when they are
 * running on the phone: API_BASE is the paired host's address, so
 * GET /api/companion/devices leaves the handset and arrives at the PC as a
 * network request.
 *
 * Those routes used to accept anyone. They now want proof, and the phone's
 * proof is the token it was given when the owner scanned the QR - pairing is
 * the owner saying, at their own keyboard, that this device may act for them.
 *
 * On the desktop itself this returns nothing, and nothing is needed: a request
 * from the machine SMARAN is running on is the owner by definition.
 */
export function companionHeaders() {
  try {
    const link = loadLink();
    return link?.token ? { 'X-Companion-Token': link.token } : {};
  } catch {
    return {};
  }
}

/**
 * Every request from the paired phone to its desktop carries the pairing token.
 *
 * companionHeaders() was only added where a caller remembered to - fetchWithAuth
 * and a few settings screens - while the chat itself used plain fetch. On the
 * desktop that is fine (same machine, cookie); on the paired phone every chat
 * request reached the PC with no proof and was refused: "Sign in to use
 * SMARAN.AI from another device", with the phone showing paired.
 *
 * So the phone app adds it once, at the fetch layer, for requests whose origin
 * is the paired host - and only those. A request to any other address never
 * sees the token. Returns the wrapped fetch (also installed on window).
 */
export function withCompanionToken(baseFetch, getLink = loadLink) {
  return function fetchWithCompanion(input, init) {
    try {
      const link = getLink();
      if (!link?.token || !link?.url) return baseFetch(input, init);
      const url = new URL(typeof input === 'string' ? input : input?.url || String(input), window.location.href);
      const host = new URL(link.url);
      if (url.origin !== host.origin) return baseFetch(input, init);
      const headers = new Headers(init?.headers || (typeof input !== 'string' && input?.headers) || undefined);
      if (!headers.has('X-Companion-Token')) headers.set('X-Companion-Token', link.token);
      return baseFetch(input, { ...(init || {}), headers });
    } catch {
      return baseFetch(input, init);
    }
  };
}

export function installCompanionFetch() {
  const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
  const native = Boolean(capacitor?.isNativePlatform?.() ?? capacitor?.isNative);
  if (!native || window.__smCompanionFetch) return;
  window.__smCompanionFetch = true;
  window.fetch = withCompanionToken(window.fetch.bind(window));
}
