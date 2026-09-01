/**
 * Making the Back button mean "go back" instead of "leave".
 *
 * On Android the hardware Back button asks the WebView to go back in history,
 * and leaves the app when there is nowhere to go. This app is one page that
 * never navigates, so there was never anywhere to go: opening Settings, the
 * Model Hub or the Sites screen and pressing Back closed the whole app.
 *
 * One history entry for "something is open", not one per overlay.
 *
 * Per-overlay entries looked tidier and were wrong. Settings hands off to the
 * pairing screen by closing itself and opening the other in the same render;
 * React ran Settings' cleanup first, which called history.back(), and the
 * popstate that produced arrived after the pairing screen had registered its
 * own listener - so the pairing screen closed itself the instant it opened and
 * you landed back on the conversation. Reported as "Device Connections does
 * not work".
 *
 * With a single entry, a hand-off never changes whether anything is open, the
 * effect does not re-run, and nothing is pushed or popped. Back closes the
 * topmost thing; the order below is what "topmost" means.
 */

import { useEffect, useRef } from 'react';

export function useBackClose(layers) {
  // Read inside the handler, so the entry does not have to be rebuilt every
  // time one of them changes.
  const current = useRef(layers);
  current.current = layers;

  const anyOpen = layers.some((layer) => layer.open);

  useEffect(() => {
    if (!anyOpen) return undefined;

    window.history.pushState({ smaranLayer: true }, '');
    let closedByBack = false;

    const onPop = () => {
      closedByBack = true;
      const top = current.current.find((layer) => layer.open);
      top?.close();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed from the interface. The entry we pushed is still there, and
      // left alone it would swallow the next Back press.
      if (!closedByBack) {
        window.history.back();
      }
    };
  }, [anyOpen]);
}
