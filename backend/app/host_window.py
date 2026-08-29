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
        return {"ok": True, "pinned": True,
                "detail": "Pinned above other windows. Drag it by its title bar."}
    except Exception as exc:
        return {"ok": False, "error": "Could not pin the window: %s" % str(exc)[:120]}


def exit_pip() -> Dict[str, Any]:
    """Back to the size and place it was before."""
    global _previous
    if not available():
        return {"ok": False, "error": status()["detail"]}
    try:
        _window.on_top = False
        if _previous:
            _window.resize(_previous["width"], _previous["height"])
            _window.move(_previous["x"], _previous["y"])
            _previous = None
        return {"ok": True, "pinned": False, "detail": "Back to the full window."}
    except Exception as exc:
        return {"ok": False, "error": "Could not restore the window: %s" % str(exc)[:120]}
