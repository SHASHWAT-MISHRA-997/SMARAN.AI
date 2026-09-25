"""Settings -> General (Desktop): each switch does what it says.

The tab used to save a JSON file that nothing read: SMARAN did not start
with Windows, the Quick Entry shortcut did nothing, the computer went to
sleep (and scheduled jobs with it), and the stored "version" went stale
after the first update. Now:

  run_on_startup   a Run entry for this user (Windows) or an autostart file
                   (Linux) pointing at the installed app. Installed app only.
  quick_entry      a system-wide hotkey that brings SMARAN to the front.
                   Windows, installed app.
  keep_awake       asks Windows not to idle-sleep while SMARAN runs. The
                   screen may still turn off; closing a laptop lid still
                   sleeps.

Applied on save and again at start, from the same file.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
from typing import Dict, Optional

from app.config import settings

logger = logging.getLogger(__name__)

DEFAULTS = {"run_on_startup": False, "quick_entry_shortcut": "Ctrl+Alt+Space", "keep_awake": False}
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "SMARAN.AI"
_lock = threading.Lock()


def installed() -> bool:
    return bool(getattr(sys, "frozen", False))


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "desktop_prefs.json")


def load() -> Dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        saved = {}
    prefs = dict(DEFAULTS)
    prefs.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return prefs


def _executable() -> str:
    return os.environ.get("APPIMAGE") or sys.executable


# --- run on startup -----------------------------------------------------------

def startup_registered() -> bool:
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
                winreg.QueryValueEx(key, RUN_NAME)
                return True
        except OSError:
            return False
    return os.path.isfile(_autostart_file())


def _autostart_file() -> str:
    return os.path.join(os.path.expanduser("~"), ".config", "autostart", "smaran-ai.desktop")


def set_startup(on: bool) -> None:
    if on and not installed():
        raise RuntimeError("Starting with the computer works in the installed app, not when run from source.")
    if sys.platform == "win32":
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            if on:
                winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, '"%s"' % _executable())
            else:
                try:
                    winreg.DeleteValue(key, RUN_NAME)
                except FileNotFoundError:
                    pass
        return
    path = _autostart_file()
    if on:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("[Desktop Entry]\nType=Application\nName=SMARAN.AI\nExec=\"%s\"\nX-GNOME-Autostart-enabled=true\n"
                     % _executable())
    elif os.path.isfile(path):
        os.remove(path)


# --- keep awake ---------------------------------------------------------------

class _KeepAwake:
    """Holds a 'system required' request on a thread of its own until released."""

    def __init__(self):
        self._stop: Optional[threading.Event] = None

    @property
    def active(self) -> bool:
        return self._stop is not None

    def set(self, on: bool) -> None:
        if sys.platform != "win32":
            if on:
                raise RuntimeError("Keeping the computer awake is available on Windows.")
            return
        if on and not self._stop:
            stop = threading.Event()

            def hold():
                import ctypes
                ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
                stop.wait()
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)

            self._stop = stop
            threading.Thread(target=hold, name="keep-awake", daemon=True).start()
        elif not on and self._stop:
            self._stop.set()
            self._stop = None


keep_awake = _KeepAwake()


# --- quick entry hotkey -------------------------------------------------------

_MODS = {"ctrl": 0x0002, "control": 0x0002, "alt": 0x0001, "shift": 0x0004, "win": 0x0008, "meta": 0x0008}
_KEYS = {"space": 0x20, "enter": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "`": 0xC0}


def parse_hotkey(text: str):
    """'Ctrl+Alt+Space' -> (modifiers, virtual key); ValueError when it cannot be a hotkey."""
    parts = [p.strip().lower() for p in str(text or "").replace(" ", "").split("+") if p.strip()]
    mods, key = 0, None
    for part in parts:
        if part in _MODS:
            mods |= _MODS[part]
        elif part in _KEYS:
            key = _KEYS[part]
        elif len(part) == 1 and part.isalnum():
            key = ord(part.upper())
        elif part.startswith("f") and part[1:].isdigit() and 1 <= int(part[1:]) <= 12:
            key = 0x6F + int(part[1:])
        else:
            raise ValueError("Unknown key '%s' in the shortcut." % part)
    if key is None or not mods:
        raise ValueError("Use a key with Ctrl, Alt, Shift or Win, like Ctrl+Alt+Space.")
    return mods, key


class _Hotkey:
    def __init__(self):
        self._thread_id: Optional[int] = None
        self.error = ""

    def set(self, text: str) -> None:
        self.stop()
        if sys.platform != "win32" or not text:
            return
        mods, key = parse_hotkey(text)
        ready = threading.Event()

        def loop():
            import ctypes
            from ctypes import wintypes
            user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
            self._thread_id = kernel32.GetCurrentThreadId()
            if not user32.RegisterHotKey(None, 1, mods | 0x4000, key):   # 0x4000: no auto-repeat
                self.error = "Another app is already using %s." % text
                self._thread_id = None
                ready.set()
                return
            self.error = ""
            ready.set()
            msg = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == 0x0312:   # WM_HOTKEY
                    try:
                        from app.host_window import bring_to_front
                        bring_to_front()
                    except Exception:  # noqa: BLE001
                        logger.info("Quick Entry could not bring the window forward", exc_info=True)
            user32.UnregisterHotKey(None, 1)

        threading.Thread(target=loop, name="quick-entry", daemon=True).start()
        ready.wait(3)
        if self.error:
            raise RuntimeError(self.error)

    def stop(self) -> None:
        if self._thread_id and sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.PostThreadMessageW(self._thread_id, 0x0012, 0, 0)   # WM_QUIT
        self._thread_id = None

    @property
    def active(self) -> bool:
        return self._thread_id is not None


hotkey = _Hotkey()


# --- the whole tab -------------------------------------------------------------

def status() -> Dict:
    from app.updates import APP_VERSION

    prefs = load()
    return {
        **prefs,
        "version": APP_VERSION,           # read live, never from the saved file
        "installed": installed(),
        "platform": sys.platform,
        "startup_registered": startup_registered(),
        "keep_awake_active": keep_awake.active,
        "quick_entry_active": hotkey.active,
        "quick_entry_error": hotkey.error,
        "supports": {
            "run_on_startup": installed() and sys.platform in ("win32", "linux"),
            "keep_awake": sys.platform == "win32",
            "quick_entry": sys.platform == "win32" and installed(),
        },
    }


def save(update: Dict) -> Dict:
    prefs = load()
    errors = []
    if "run_on_startup" in update:
        want = bool(update["run_on_startup"])
        try:
            set_startup(want)
            prefs["run_on_startup"] = want
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
    if "keep_awake" in update:
        want = bool(update["keep_awake"])
        try:
            keep_awake.set(want)
            prefs["keep_awake"] = want
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
    if "quick_entry_shortcut" in update:
        text = str(update["quick_entry_shortcut"] or "").strip()
        try:
            if text:
                parse_hotkey(text)
            if installed():
                hotkey.set(text)
            prefs["quick_entry_shortcut"] = text
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
    with _lock:
        os.makedirs(os.path.dirname(_path()), exist_ok=True)
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(prefs, fh, indent=2)
        os.replace(tmp, _path())
    return {**status(), "errors": errors}


def apply_at_start() -> None:
    """Re-apply what was saved: the hotkey and the awake request live only as long as the process."""
    prefs = load()
    try:
        if prefs["keep_awake"]:
            keep_awake.set(True)
    except Exception:  # noqa: BLE001
        logger.info("Could not keep the computer awake", exc_info=True)
    try:
        if installed() and prefs["quick_entry_shortcut"]:
            hotkey.set(prefs["quick_entry_shortcut"])
    except Exception:  # noqa: BLE001
        logger.info("Quick Entry shortcut not registered", exc_info=True)
