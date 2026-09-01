"""
Usage reporting.

Counts how many installations exist and how they are used, so the software can
be improved with evidence rather than guesswork. It replaces an earlier
approach that pushed notifications to a public ntfy.sh topic — the topic name
was compiled into the shipped binary, so anyone who extracted it could read
every notification and post fake ones.

WHAT IS SENT
    a random installation id, the platform, the app version, and an event name
    from a fixed list, with the time it happened.

WHAT IS NEVER SENT
    conversations, prompts, file names, file contents, model API keys, email
    addresses, names, or anything typed into the app.

The person using the software is told this and can switch it off; when they
do, nothing leaves the machine. That is not decoration: India's DPDP Act 2023
and the GDPR both require notice, and a switch that is ignored would make the
notice a lie.

Reporting is disabled unless the build carries an endpoint, so a source
checkout reports nothing at all.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import Optional

logger = logging.getLogger("usage_reporting")

# Where the counters go. An environment variable wins, so a developer can
# point a local build somewhere else without rebuilding. Otherwise the
# values come from analytics_config, which the build step generates.
#
# Environment variables cannot carry this on their own: PyInstaller reads
# them at build time and the frozen app reads them at run time, so a value
# set while building simply is not there when the app starts.
#
# The ingest key ships inside the binary and must be assumed extractable.
# That is why it only permits writing counters, and why the dashboard has
# a separate key that is never distributed.
try:
    from app import analytics_config as _baked
except ImportError:  # a source checkout has no generated config
    _baked = None

ENDPOINT = (os.getenv("SMARAN_ANALYTICS_URL") or getattr(_baked, "ENDPOINT", "") or "").strip()
INGEST_KEY = (os.getenv("SMARAN_ANALYTICS_KEY") or getattr(_baked, "INGEST_KEY", "") or "").strip()

APP_VERSION = os.getenv("SMARAN_APP_VERSION", "2.9.9")
HEARTBEAT_HOURS = 12

_PLATFORMS = {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}


def _data_dir() -> str:
    return os.getenv("DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "data")


def _state_file() -> str:
    return os.path.join(_data_dir(), "usage-reporting.json")


def _load_state() -> dict:
    try:
        with open(_state_file(), "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    try:
        os.makedirs(_data_dir(), exist_ok=True)
        with open(_state_file(), "w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2)
    except OSError:
        pass


def installation_id() -> str:
    """A random id for this installation.

    Deliberately random rather than derived from the machine: a hardware
    fingerprint would follow the person across reinstalls and identify them,
    which is exactly what this must not do.
    """
    state = _load_state()
    existing = state.get("installation_id")
    if existing:
        return str(existing)
    fresh = uuid.uuid4().hex
    state["installation_id"] = fresh
    state["first_seen"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save_state(state)
    return fresh


def is_enabled() -> bool:
    """Reporting is on unless the user turned it off, and needs an endpoint."""
    if not ENDPOINT:
        return False
    return bool(_load_state().get("enabled", True))


def set_enabled(enabled: bool) -> None:
    state = _load_state()
    state["enabled"] = bool(enabled)
    _save_state(state)


def is_configured() -> bool:
    """Whether this build can report at all, regardless of the user's choice."""
    return bool(ENDPOINT)


def _is_first_launch() -> bool:
    state = _load_state()
    if state.get("installed_reported"):
        return False
    state["installed_reported"] = True
    _save_state(state)
    return True


def report(event: str) -> None:
    """Send one event, on a background thread. Never raises, never blocks."""
    if not is_enabled():
        return

    def _send() -> None:
        payload = {
            "install_id": installation_id(),
            "event": event,
            "platform": _PLATFORMS.get(platform.system(), "unknown"),
            "app_version": APP_VERSION,
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
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            # Analytics must never be the reason the app misbehaves, so a
            # failure here is noted at debug level and otherwise ignored.
            logger.debug("Usage event '%s' was not delivered: %s", event, exc)

    threading.Thread(target=_send, name=f"usage-{event}", daemon=True).start()


def start() -> None:
    """Report the launch, then a heartbeat twice a day while the app runs."""
    if not is_enabled():
        return

    report("install" if _is_first_launch() else "launch")

    def _loop() -> None:
        while True:
            time.sleep(HEARTBEAT_HOURS * 3600)
            if not is_enabled():
                return
            report("heartbeat")

    threading.Thread(target=_loop, name="usage-heartbeat", daemon=True).start()


def status() -> dict:
    """What the settings screen shows about reporting."""
    return {
        "configured": is_configured(),
        "enabled": is_enabled(),
        "installation_id": installation_id() if is_configured() else None,
        "collected": [
            "A random installation id (not an account, not derived from hardware)",
            "Platform and app version",
            "Event names: install, launch, heartbeat, sign-up, sign-in",
        ],
        "never_collected": [
            "Conversations, prompts, or anything typed",
            "Files, file names, or their contents",
            "Model API keys",
            "Names, email addresses, or location",
        ],
    }
