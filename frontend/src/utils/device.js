/**
 * Is this a phone?
 *
 * Asked in one place because the wrong answer keeps costing the same bug. Twice
 * now a control has been hidden "on mobile" by testing isNativeApp() - the
 * packaged Android app - and twice the same phone, pointed at a paired computer
 * in a browser at 192.168.1.5:3003, has failed that test and been handed the
 * desktop behaviour: the composer hidden as though the window were pinned, and
 * Vision offered on a device that cannot use it.
 *
 * The packaged app is one way to be a phone, not the definition of one.
 *
 * A finger and a small screen is the definition, and both halves matter. A
 * touchscreen laptop is coarse and wide; a desktop window dragged narrow is
 * fine and small. Neither is a phone.
 */

import { isNativeApp } from './hostLink.js';

const query = (text) => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia(text).matches
  : false);

/** Small, and driven by a finger.
 *
 * Android WebView can report the physical viewport width (1080px on this
 * device) even while it is a phone. Width alone then crosses the desktop
 * breakpoint when the handset rotates and mounts the performance drawer.
 * The mobile user-agent is the stable signal for a packaged phone; the
 * coarse-pointer/width check keeps this useful for browser phones too.
 */
export const isPhone = () => {
  if (typeof window === 'undefined') return false;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  return mobileUserAgent || (window.innerWidth <= 900 && query('(pointer: coarse)'));
};

/**
 * Is this a phone or a tablet - anything held rather than sat at?
 *
 * `isPhone` deliberately means small. This means touch, at any size, and it
 * exists because three features are desktop-only in substance rather than in
 * layout: cron automations, the gateway and its bots, and the sandbox's
 * security controls all act on a machine that is running SMARAN as a server.
 * A handset or a tablet is a client of that machine, never the machine, so
 * those screens loaded there and then did nothing - which is the report that
 * prompted this.
 *
 * iPadOS is the awkward one. Safari on iPad has claimed to be a Macintosh
 * since iPadOS 13, so the user-agent test `isPhone` relies on is answered
 * "desktop" by the most common tablet there is. `maxTouchPoints` is how that
 * lie is caught: a real Mac reports 0, an iPad reports 5.
 */
export const isHandheld = () => {
  if (typeof window === 'undefined') return false;
  if (isPhone()) return true;
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  // iPad in desktop mode, then Android tablets, which drop "Mobile" from the
  // user-agent string but keep "Android".
  if (/Macintosh/.test(userAgent) && touchPoints > 1) return true;
  return /Android|iPad|Tablet|PlayBook|Silk/i.test(userAgent);
  // Deliberately no "touch plus a coarse pointer" fallback beyond this. It
  // read true on a touchscreen Windows laptop, which is a machine that runs
  // SMARAN as a server and must keep all three screens. A Windows tablet is
  // indistinguishable from that laptop from in here, and of the two wrong
  // answers, showing a desktop the controls it can use is the better one.
};

/**
 * Could this window be a pinned picture-in-picture one?
 *
 * Small and driven by a mouse. No phone is ever pinned, which is the whole
 * point of asking.
 */
export const couldBePinned = (maxWidth = 460) => (
  typeof window !== 'undefined'
  && window.innerWidth <= maxWidth
  && query('(pointer: fine)')
);

/**
 * Can this page use a microphone at all?
 *
 * Browsers only expose the microphone on a secure origin - https, or
 * localhost. A phone opening the paired computer at http://192.168.1.5:3003
 * is neither, and there `navigator.mediaDevices` simply does not exist.
 * Measured, not assumed:
 *
 *     origin            http://192.168.1.5:8805
 *     isSecureContext   false
 *     mediaDevices      undefined
 *     SpeechRecognition function
 *
 * That last line is the trap. Recognition is still defined, so code that
 * checks whether it exists concludes it can listen, starts it, and gets
 * nothing - which is how "voice input unavailable, try again" happened for a
 * condition retrying cannot change.
 *
 * Nothing in this app can grant itself the microphone. What it can do is say
 * which of the two doors is shut.
 */
export const micIsBlockedByOrigin = () => {
  if (isNativeApp()) return false;
  return (
    typeof window !== 'undefined'
    && !window.isSecureContext
    && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
  );
};

/** Why, in the words of the thing that is actually refusing. */
export const MIC_BLOCKED_REASON =
  'This page is open over http, and browsers only allow the microphone on '
  + 'https or on localhost - so there is no microphone to reach from here. '
  + 'Typing works. For talking, use the SMARAN.AI app on this phone, where '
  + 'the microphone is available.';

