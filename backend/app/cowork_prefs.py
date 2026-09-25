"""Settings -> Cowork, stored and enforced on the backend.

The tab saved a JSON file nothing read - and shipped a default folder that was
one developer's own home directory. What each setting now does:

  dispatch_enabled   off: the desktop sends nothing to the phone and accepts
                     no work from it (companion dispatch, queue, from-device).
  cowork_files_path  where SMARAN keeps Cowork work - scheduled jobs' folders.
  trusted_folders    SMARAN may create, rename, move and copy files inside
                     these without asking. Deleting always asks.
  preferred_browser  links SMARAN opens use this browser.

"Require trusted devices" is not a setting any more: since the network guard
every device must be paired, and switching that off would not be safe.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Dict, List, Optional

from app.config import settings

BROWSERS = ("default", "chrome", "edge", "firefox", "brave")
_lock = threading.Lock()


def _default_folder() -> str:
    return str(Path.home() / "SMARAN" / "Cowork")


def defaults() -> Dict:
    folder = _default_folder()
    return {"dispatch_enabled": True, "cowork_files_path": folder, "trusted_folders": [folder],
            "preferred_browser": "default"}


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "cowork_prefs.json")


def load() -> Dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        saved = {}
    prefs = defaults()
    prefs.update({k: v for k, v in saved.items() if k in prefs})
    return prefs


def _check_folder(raw: str) -> str:
    text = str(raw or "").strip().strip('"')
    if not text:
        raise ValueError("Give a folder path.")
    path = Path(text).expanduser()
    if not path.is_absolute():
        raise ValueError("Use a full folder path, like C:\\Users\\you\\Documents\\Work.")
    resolved = path.resolve()
    if resolved == Path(resolved.anchor):
        raise ValueError("A whole drive cannot be a Cowork folder. Choose a folder on it.")
    system = [Path(os.environ.get("SystemRoot", r"C:\Windows")), Path(r"C:\Program Files"),
              Path(r"C:\Program Files (x86)"), Path("/etc"), Path("/usr"), Path("/bin"), Path("/boot")]
    for bad in system:
        try:
            resolved.relative_to(bad.resolve())
            raise ValueError("%s is a system folder." % resolved)
        except ValueError as exc:
            if "system folder" in str(exc):
                raise
    if resolved == Path.home().resolve():
        raise ValueError("Your whole home folder is too broad. Choose a folder inside it.")
    return str(resolved)


def save(update: Dict) -> Dict:
    prefs = load()
    if "dispatch_enabled" in update:
        prefs["dispatch_enabled"] = bool(update["dispatch_enabled"])
    if "cowork_files_path" in update:
        folder = _check_folder(update["cowork_files_path"])
        os.makedirs(folder, exist_ok=True)
        prefs["cowork_files_path"] = folder
    if "trusted_folders" in update:
        folders: List[str] = []
        for raw in update["trusted_folders"] or []:
            folder = _check_folder(raw)
            if folder not in folders:
                folders.append(folder)
        if len(folders) > 20:
            raise ValueError("Up to 20 trusted folders.")
        prefs["trusted_folders"] = folders
    if "preferred_browser" in update:
        if update["preferred_browser"] not in BROWSERS:
            raise ValueError("Choose default, Chrome, Edge, Firefox or Brave.")
        prefs["preferred_browser"] = update["preferred_browser"]
    with _lock:
        os.makedirs(os.path.dirname(_path()), exist_ok=True)
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(prefs, fh, indent=2)
        os.replace(tmp, _path())
    return prefs


def dispatch_enabled() -> bool:
    return bool(load()["dispatch_enabled"])


def in_trusted_folder(*paths: str) -> bool:
    """Every path given lies inside one of the trusted folders."""
    trusted = [Path(f).resolve() for f in load()["trusted_folders"]]
    if not paths or not trusted:
        return False
    for raw in paths:
        if not raw:
            return False
        target = Path(str(raw)).expanduser().resolve()
        if not any(target == t or t in target.parents for t in trusted):
            return False
    return True


_BROWSER_BINARIES = {
    "chrome": ["chrome", "google-chrome", "google-chrome-stable",
               r"C:\Program Files\Google\Chrome\Application\chrome.exe",
               r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"],
    "edge": ["msedge", "microsoft-edge", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
             r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"],
    "firefox": ["firefox", r"C:\Program Files\Mozilla Firefox\firefox.exe"],
    "brave": ["brave", "brave-browser",
              os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"),
              r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"],
}


def browser_command() -> Optional[str]:
    """The executable for the preferred browser, or None for the system default."""
    choice = load()["preferred_browser"]
    for candidate in _BROWSER_BINARIES.get(choice, []):
        found = shutil.which(candidate) or (candidate if os.path.isfile(candidate) else None)
        if found:
            return found
    return None


def keep_artifact(source: str, kind: str, title: str) -> Optional[str]:
    """Copy a finished image or video into the Cowork files folder, named after what was asked.

    The files stay where the app serves them from; this is the copy a person
    can find in File Explorer. Returns the copy's path, or None if it failed.
    """
    import re
    import time

    try:
        folder = os.path.join(load()["cowork_files_path"], kind)
        os.makedirs(folder, exist_ok=True)
        stem = re.sub(r"[^A-Za-z0-9]+", "-", (title or kind).lower()).strip("-")[:50] or kind.lower()
        target = os.path.join(folder, "%s-%s%s" % (time.strftime("%Y%m%d-%H%M%S"), stem, Path(source).suffix))
        shutil.copy2(source, target)
        return target
    except OSError:
        return None


def browser_available(choice: str) -> bool:
    if choice == "default":
        return True
    return any(shutil.which(c) or os.path.isfile(c) for c in _BROWSER_BINARIES.get(choice, []))

