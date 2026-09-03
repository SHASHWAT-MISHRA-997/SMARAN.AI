/**
 * Is this a phone?
 *
 * Asked in one place because the wrong answer keeps costing the same bug. Twice
 * now a control has been hidden "on mobile" by testing isNativeApp() - the
 * packaged Android app - and twice the same phone, pointed at a paired computer
 * in a browser at 192.168.1.5:3003, has failed that test and been handed the
 * desktop behaviour: the composer hidden as though the window were pinned, and
 * Gesture and Vision offered on a device that cannot use either.
 *
 * The packaged app is one way to be a phone, not the definition of one.
 *
 * A finger and a small screen is the definition, and both halves matter. A
 * touchscreen laptop is coarse and wide; a desktop window dragged narrow is
 * fine and small. Neither is a phone.
 */

const query = (text) => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia(text).matches
  : false);

/** Small, and driven by a finger. */
export const isPhone = () => (
  typeof window !== 'undefined'
  && window.innerWidth <= 900
  && query('(pointer: coarse)')
);

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
export const micIsBlockedByOrigin = () => (
  typeof window !== 'undefined'
  && !window.isSecureContext
  && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
);

/** Why, in the words of the thing that is actually refusing. */
export const MIC_BLOCKED_REASON =
  'This page is open over http, and browsers only allow the microphone on '
  + 'https or on localhost - so there is no microphone to reach from here. '
  + 'Typing works. For talking, use the SMARAN.AI app on this phone, where '
  + 'the microphone is available.';
