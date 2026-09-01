/**
 * Making the Back button mean "go back" instead of "leave".
 *
 * On Android the hardware Back button asks the WebView to go back in history,
 * and leaves the app when there is nowhere to go. This app is one page that
 * never navigates, so there was never anywhere to go: opening Settings, the
 * Model Hub or the Sites screen and pressing Back closed the whole app,
 * losing whatever was on screen. There was no on-screen way back out of the
 * full-screen sections either, so on a phone some of them were a dead end.
 *
 * The fix is to give Back something to pop. Every overlay adds one history
 * entry while it is open, so Back closes the topmost one and only leaves the
 * app once nothing is left to close. Closing with the X removes that entry
 * again, or the next Back press would appear to do nothing.
 *
 * No plugin needed: this is the History API, which Capacitor's Back button
 * already drives, and it gives the browser build the same behaviour for free.
 */

import { useEffect } from 'react';

export function useBackClose(isOpen, close) {
  useEffect(() => {
    if (!isOpen) return undefined;

    window.history.pushState({ smaranLayer: true }, '');
    let closedByBack = false;

    const onPop = () => {
      closedByBack = true;
      close();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed from the interface rather than by Back. The entry we pushed is
      // still there, and left alone it would swallow the next Back press.
      if (!closedByBack) {
        window.history.back();
      }
    };
    // `close` is intentionally not a dependency: callers pass an inline arrow,
    // which would re-run this on every render and push an entry each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
