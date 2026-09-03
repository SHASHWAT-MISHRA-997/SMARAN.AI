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
