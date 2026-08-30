"""Tells the app when a newer build has been published.

The app ships as a downloaded installer, so nothing pushes a new version at
it. It has to look. This asks the public downloads repository what the latest
release is, compares that to the version it was built as, and hands the
answer to the interface, which shows a notice the way an operating system
would rather than leaving people on an old build indefinitely.

Nothing is downloaded or installed automatically. The check reads a public
endpoint, sends no identifying information, and the person decides whether to
act on it. An update that installs itself without asking is a different
product, and not one anybody asked for.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from typing import Optional

logger = logging.getLogger("updates")

APP_VERSION = os.getenv("SMARAN_APP_VERSION", "2.9.1")

# The public repository that holds the released builds. The source is private;
# only the artefacts are published, and this reads the release metadata.
RELEASES_API = os.getenv(
    "SMARAN_RELEASES_API",
    "https://api.github.com/repos/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest",
)
RELEASES_PAGE = os.getenv(
    "SMARAN_RELEASES_PAGE",
    "https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest",
)

# GitHub rate-limits unauthenticated callers to sixty an hour per address.
# One check every six hours leaves that alone even with several installs
# behind one connection.
_CACHE_SECONDS = 6 * 3600
_TIMEOUT_SECONDS = 8

_cache: dict = {"checked_at": 0.0, "payload": None}


def _parse_version(text: str) -> tuple:
    """Turn '2.8.2' or 'v2.8.2-beta' into something comparable.

    Non-numeric suffixes are dropped rather than guessed at: a build labelled
    2.8.2-beta is treated as 2.8.2, which is close enough to decide whether a
    newer release exists and avoids inventing an ordering for release names.
    """
    numbers = re.findall(r"\d+", (text or "").split("+")[0])
    return tuple(int(n) for n in numbers[:4]) or (0,)


def _is_newer(candidate: str, current: str) -> bool:
    a, b = _parse_version(candidate), _parse_version(current)
    length = max(len(a), len(b))
    a = a + (0,) * (length - len(a))
    b = b + (0,) * (length - len(b))
    return a > b


def _fetch_latest() -> Optional[dict]:
    request = urllib.request.Request(
        RELEASES_API,
        headers={
            "Accept": "application/vnd.github+json",
            # GitHub asks for one, and refuses some requests without it.
            "User-Agent": "SMARAN.AI-update-check",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, TimeoutError, ValueError) as exc:
        # Being offline is the normal case for a local-first app, so this is
        # not an error worth showing anyone.
        logger.debug("Update check did not complete: %s", exc)
        return None


def check(force: bool = False) -> dict:
    """Return what the interface needs to decide whether to say anything."""
    now = time.time()
    if not force and _cache["payload"] and now - _cache["checked_at"] < _CACHE_SECONDS:
        return _cache["payload"]

    release = _fetch_latest()
    if release is None:
        payload = {
            "current_version": APP_VERSION,
            "latest_version": None,
            "update_available": False,
            "checked": False,
            "reason": "Could not reach the update server.",
        }
        # Not cached: a failed check should be retried, not remembered.
        return payload

    tag = str(release.get("tag_name") or "").lstrip("vV")
    assets = {a.get("name"): a for a in (release.get("assets") or [])}

    def asset_url(name: str) -> Optional[str]:
        entry = assets.get(name)
        return entry.get("browser_download_url") if entry else None

    payload = {
        "current_version": APP_VERSION,
        "latest_version": tag or None,
        "update_available": bool(tag) and _is_newer(tag, APP_VERSION),
        "checked": True,
        "published_at": release.get("published_at"),
        "notes": (release.get("body") or "").strip()[:4000],
        "release_page": release.get("html_url") or RELEASES_PAGE,
        "windows_url": asset_url("SMARAN.AI-Setup.exe"),
        "android_url": asset_url("SMARAN.AI.apk"),
        "vsix_url": asset_url("smaran-ai-codex.vsix"),
    }

    _cache["checked_at"] = now
    _cache["payload"] = payload
    return payload
