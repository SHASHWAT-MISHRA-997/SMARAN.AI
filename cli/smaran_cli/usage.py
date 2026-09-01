"""Counting installs and launches of the command line tool.

The desktop app has reported this since it shipped, and nothing else did - so
the dashboard could only ever say "windows", and the command line was
invisible however much it was used.

Four fields go out and nothing else: a random id for this installation, the
word "install" or "launch", the platform - "cli", so it is counted separately
from the app rather than blurred into it - and the version. No command, no
prompt, no file, no key, no address.

The id lives beside the tool's own settings, is generated here, and is not
derived from anything about the machine or the person.

Off with SMARAN_NO_ANALYTICS=1, and inert in any build that was not given an
endpoint - which is what a source checkout is.
"""

from __future__ import annotations

import json
import os
import platform
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from . import __version__

try:  # written by the build; absent in a source checkout
    from . import analytics_config as _baked
except ImportError:
    _baked = None

ENDPOINT = (os.getenv("SMARAN_ANALYTICS_URL") or getattr(_baked, "ENDPOINT", "") or "").strip()
INGEST_KEY = (os.getenv("SMARAN_ANALYTICS_KEY") or getattr(_baked, "INGEST_KEY", "") or "").strip()


def _state_file() -> Path:
    root = os.getenv("LOCALAPPDATA") or os.path.expanduser("~/.local/share")
    return Path(root) / "SMARAN.AI" / "cli-usage.json"


def _load() -> dict:
    try:
        return json.loads(_state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(state: dict) -> None:
    try:
        path = _state_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state), encoding="utf-8")
    except OSError:
        # Not being able to remember is not worth telling anyone about; the
        # worst case is an install counted as an install twice.
        pass


def enabled() -> bool:
    return bool(ENDPOINT and INGEST_KEY) and os.getenv("SMARAN_NO_ANALYTICS", "") != "1"


def _send(event: str, install_id: str) -> None:
    payload = {
        "install_id": install_id,
        "event": event,
        "platform": "cli",
        "app_version": __version__,
        "os_version": platform.release()[:64],
    }
    request = urllib.request.Request(
        ENDPOINT.rstrip("/") + "/ingest",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Ingest-Key": INGEST_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8):
            pass
    except (urllib.error.URLError, OSError, TimeoutError):
        # A counter must never be the reason a command is slow or fails.
        pass


def report_startup() -> None:
    """Called once per run, on a background thread that is never waited for."""
    if not enabled():
        return

    state = _load()
    install_id = state.get("install_id")
    if not install_id:
        install_id = uuid.uuid4().hex
        state["install_id"] = install_id

    event = "launch" if state.get("installed") else "install"
    state["installed"] = True
    _save(state)

    threading.Thread(
        target=_send, args=(event, install_id), name="cli-usage", daemon=True,
    ).start()
