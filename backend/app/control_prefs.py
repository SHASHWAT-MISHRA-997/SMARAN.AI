"""Settings -> Capabilities: whether SMARAN may control the computer, and what asks first.

These were two switches that wrote to the browser's storage and nothing read.
The desktop agent's own check only worked if the caller volunteered the
setting inside each request - which nobody did, and which is no way to
enforce a safety switch. Here they are stored on the backend and read by
DesktopAgent.execute, the one place every desktop action passes through.

  computer_use_enabled   off: no desktop action runs, from chat, voice or
                         anywhere else.
  confirm_changes        off: actions that change files or settings run
                         without asking. Power actions (sleep, restart,
                         shut down) and high-risk actions always ask.

capabilities() replaces a badge that said "Verified" without checking
anything: it tests what desktop control actually depends on.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import threading
from typing import Dict

from app.config import settings

DEFAULTS = {"computer_use_enabled": True, "confirm_changes": True}
_lock = threading.Lock()


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "control_prefs.json")


def load() -> Dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        saved = {}
    prefs = dict(DEFAULTS)
    prefs.update({k: bool(v) for k, v in saved.items() if k in DEFAULTS})
    return prefs


def save(update: Dict) -> Dict:
    prefs = load()
    prefs.update({k: bool(v) for k, v in update.items() if k in DEFAULTS and v is not None})
    with _lock:
        os.makedirs(os.path.dirname(_path()), exist_ok=True)
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(prefs, fh, indent=2)
        os.replace(tmp, _path())
    return prefs


def must_confirm(spec: Dict) -> bool:
    """Whether this action waits for the person, under the owner's setting."""
    if not spec.get("requires_confirmation"):
        return False
    if spec.get("category") == "power" or spec.get("risk") in ("high", "critical"):
        return True          # always, whatever the setting
    return load()["confirm_changes"]


def capabilities() -> Dict:
    """What desktop control can actually do on this machine, checked now."""
    checks = []
    if sys.platform == "win32":
        try:
            import ctypes
            user32 = ctypes.windll.user32
            ok = bool(user32.GetSystemMetrics(0))
            checks.append(("Keyboard and mouse (Windows input)", ok, "" if ok else "Windows input is not available"))
        except Exception as exc:  # noqa: BLE001
            checks.append(("Keyboard and mouse (Windows input)", False, str(exc)[:120]))
    else:
        has_display = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        tool = shutil.which("xdotool")
        checks.append(("Desktop session", has_display, "" if has_display else "No graphical desktop was found"))
        checks.append(("Keyboard and mouse (xdotool)", bool(tool), "" if tool else "Install xdotool to allow typing and clicking"))
    try:
        from PIL import ImageGrab
        image = ImageGrab.grab(bbox=(0, 0, 8, 8))
        checks.append(("Screenshots", image is not None, ""))
    except Exception as exc:  # noqa: BLE001
        checks.append(("Screenshots", False, str(exc)[:120]))
    opener = sys.platform == "win32" or bool(shutil.which("xdg-open"))
    checks.append(("Opening apps, folders and websites", opener, "" if opener else "xdg-open was not found"))
    return {
        "platform": {"win32": "Windows", "linux": "Linux", "darwin": "macOS"}.get(sys.platform, sys.platform),
        "checks": [{"name": n, "ok": ok, "note": note} for n, ok, note in checks],
        "ready": all(ok for _, ok, _ in checks),
    }
