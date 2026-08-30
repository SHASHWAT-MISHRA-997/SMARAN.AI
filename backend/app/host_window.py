"""Control of the desktop window this app is drawn in.

The workspace and the backend run in one process, so the window object can be
handed here when it is made and driven from an HTTP route afterwards. That is
what makes a genuine picture-in-picture possible: shrinking a div inside the
page only floats over the page, while resizing and pinning the actual window
floats over everything else on the desktop, which is the point of it.

In the browser there is no window to drive, so every call reports that
plainly rather than pretending it worked.
"""

from __future__ import annotations

import logging
import sys
import threading
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

#: Set by desktop_app when it creates the window. None in a browser.
_window: Optional[Any] = None

#: What to go back to. Captured on the way into PiP rather than assumed, so
#: restoring returns the window you had and not a guess at a default.
_previous: Optional[Dict[str, int]] = None

PIP_WIDTH = 420
PIP_HEIGHT = 560
EDGE_GAP = 24


def register(window: Any) -> None:
    global _window
    _window = window
    logger.info("Desktop window registered for picture-in-picture")


def _handle() -> Optional[int]:
    """The OS window handle, found by its title.

    pywebview does not hand one out, and the DWM calls below need it. The
    title is unique enough here - there is one SMARAN.AI window.
    """
    if sys.platform != "win32":
        return None
    try:
        import ctypes

        hwnd = ctypes.windll.user32.FindWindowW(None, "SMARAN.AI")
        return hwnd or None
    except Exception:
        return None


def _set_corners(rounded: bool) -> bool:
    """Round the window's corners, or put them back.

    Windows 11 has an attribute for this - DWMWA_WINDOW_CORNER_PREFERENCE,
    33 - and honours it on build 22000 and later. On Windows 10 the call
    returns a failure code and the corners stay square, which is the correct
    outcome there rather than something to report as broken.
    """
    hwnd = _handle()
    if not hwnd:
        return False
    try:
        import ctypes

        DWMWA_WINDOW_CORNER_PREFERENCE = 33
        DWMWCP_ROUND = 2
        DWMWCP_DEFAULT = 0
        value = ctypes.c_int(DWMWCP_ROUND if rounded else DWMWCP_DEFAULT)
        result = ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
            ctypes.byref(value), ctypes.sizeof(value))
        return result == 0
    except Exception as exc:
        logger.info("Could not set the corner style: %s", exc)
        return False


def available() -> bool:
    return _window is not None


def status() -> Dict[str, Any]:
    return {
        "available": available(),
        "pinned": _previous is not None,
        "detail": (
            "The desktop window can be shrunk and pinned above other apps."
            if available() else
            "There is no desktop window to pin - this is running in a browser, "
            "which cannot float over other applications."
        ),
    }


def enter_pip() -> Dict[str, Any]:
    """Shrink to a corner and stay above other windows."""
    global _previous
    if not available():
        return {"ok": False, "error": status()["detail"]}
    try:
        if _previous is None:
            _previous = {"width": int(_window.width), "height": int(_window.height),
                         "x": int(_window.x), "y": int(_window.y)}
        _window.resize(PIP_WIDTH, PIP_HEIGHT)
        # Bottom right, which is where a picture-in-picture is expected and
        # where it covers least. Screen size is read rather than assumed;
        # a hardcoded 1920x1080 would land off-screen on a smaller display.
        try:
            screens = __import__("webview").screens
            screen = screens[0]
            _window.move(int(screen.width) - PIP_WIDTH - EDGE_GAP,
                         int(screen.height) - PIP_HEIGHT - EDGE_GAP * 4)
        except Exception:
            logger.info("Could not read the screen size; leaving the window where it is.")
        _window.on_top = True
        rounded = _set_corners(True)
        return {"ok": True, "pinned": True, "rounded": rounded,
                "width": PIP_WIDTH, "height": PIP_HEIGHT,
                "detail": ("Pinned above your other windows. Drag it by the title "
                           "bar, and drag any edge to resize it.")}
    except Exception as exc:
        return {"ok": False, "error": "Could not pin the window: %s" % str(exc)[:120]}


def exit_pip() -> Dict[str, Any]:
    """Back to the size and place it was before."""
    global _previous
    if not available():
        return {"ok": False, "error": status()["detail"]}
    try:
        _window.on_top = False
        _set_corners(False)
        if _previous:
            _window.resize(_previous["width"], _previous["height"])
            _window.move(_previous["x"], _previous["y"])
            _previous = None
        return {"ok": True, "pinned": False, "detail": "Back to the full window."}
    except Exception as exc:
        return {"ok": False, "error": "Could not restore the window: %s" % str(exc)[:120]}


def close_app(delay_seconds: float = 2.0) -> bool:
    """Shut the window so an installer can replace the files it is running from.

    Used by the updater and nothing else. The delay exists so the reply to the
    request that asked for this reaches the page before the process it came
    from goes away - closing immediately meant the interface saw a dropped
    connection and reported a failure for something that had worked.

    Returns whether there is a window to close at all. Run from a script
    rather than the installed app, there is not, and saying so is better than
    the interface claiming it closed something.
    """
    if not available():
        return False

    def _shut() -> None:
        time.sleep(delay_seconds)
        try:
            _window.destroy()
        except Exception:
            # The window may already be gone - which is the outcome wanted.
            logger.info("The window was already closed.")

    threading.Thread(target=_shut, daemon=True).start()
    return True
