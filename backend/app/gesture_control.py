"""Turning a hand gesture into a keypress the whole desktop hears.

The gesture recogniser runs in the page and, until now, only ever moved
SMARAN.AI's own interface - it could switch a character or end a call, but it
could not pause a video in a browser behind it. What it needs is to reach the
desktop, which is a keypress, and this is where that happens.

Every action here is a media or navigation key that Windows already routes to
whatever has focus. That is the point: the volume key changes the volume of
whatever is playing, and page-down scrolls whatever you are reading, without
this code knowing or caring which application that is.

Deliberately narrow. These are the keys a person uses while watching or
reading something - play, volume, skip, scroll - and nothing that deletes,
closes or types. A hand waved past a camera should not be able to do
something you cannot undo, and gestures misfire.
"""

from __future__ import annotations

import logging
import sys
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Windows virtual key codes. Sent with keybd_event, which is how these keys
# actually work - SendKeys has no codes for the media ones, which is why the
# six volume and media commands in desktop_agent had never worked.
VK = {
    "play_pause": 0xB3,
    "next_track": 0xB0,
    "prev_track": 0xB1,
    "volume_up": 0xAF,
    "volume_down": 0xAE,
    "mute": 0xAD,
    "page_up": 0x21,
    "page_down": 0x22,
}

#: What each gesture does. Chosen so the hand shape suggests the action:
#: a raised palm stops, a thumb points the volume the way it is pointing,
#: a pinch quietens, a swipe moves along.
GESTURE_ACTIONS: Dict[str, Dict[str, Any]] = {
    "open_palm":   {"key": "play_pause",  "label": "Play or pause"},
    "thumb_up":    {"key": "volume_up",   "label": "Volume up",   "repeat": 3},
    "thumb_down":  {"key": "volume_down", "label": "Volume down", "repeat": 3},
    "pinch":       {"key": "mute",        "label": "Mute or unmute"},
    "swipe_right": {"key": "next_track",  "label": "Next"},
    "swipe_left":  {"key": "prev_track",  "label": "Previous"},
    # Scrolling is a hand moved up or down, which is what the movement means
    # everywhere else. It was on "point up" and "victory", which are shapes
    # rather than directions and say nothing about which way the page goes.
    "swipe_up":    {"key": "page_up",     "label": "Scroll up"},
    "swipe_down":  {"key": "page_down",   "label": "Scroll down"},
    # Kept as a second way to scroll, for anyone who would rather hold a shape
    # still than move their arm.
    "point":       {"key": "page_up",     "label": "Scroll up (held)"},
    "victory":     {"key": "page_down",   "label": "Scroll down (held)"},
    # The fist is not a key. It is the way out: a gesture that stops gestures,
    # so you can switch this off without reaching for the keyboard - which is
    # the whole reason you were using your hands.
    "fist":        {"key": None,          "label": "Turn desktop gestures off",
                    "stops": True},
}


def legend() -> list[dict]:
    """What each gesture does, for the on-screen list."""
    return [{"gesture": name, **spec} for name, spec in GESTURE_ACTIONS.items()]


def perform(gesture: str) -> Dict[str, Any]:
    """Send the key this gesture stands for."""
    spec = GESTURE_ACTIONS.get(gesture)
    if not spec:
        return {"ok": False, "error": "No desktop action for %r." % gesture}

    if spec.get("stops"):
        return {"ok": True, "stop": True, "action": spec["label"]}

    if sys.platform != "win32":
        return {"ok": False,
                "error": "Desktop gestures send Windows media keys; this is %s." % sys.platform}

    try:
        import ctypes

        user32 = ctypes.windll.user32
        KEYEVENTF_KEYUP = 0x0002
        code = VK[spec["key"]]
        for _ in range(spec.get("repeat", 1)):
            user32.keybd_event(code, 0, 0, 0)
            user32.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)
        return {"ok": True, "action": spec["label"], "key": spec["key"]}
    except Exception as exc:
        return {"ok": False, "error": "Could not send the key: %s" % str(exc)[:120]}
