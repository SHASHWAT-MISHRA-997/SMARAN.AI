import { loadLink } from './hostLink';

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
