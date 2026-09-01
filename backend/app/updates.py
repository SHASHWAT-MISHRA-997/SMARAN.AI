"""Tells the app when a newer build has been published.

The app ships as a downloaded installer, so nothing pushes a new version at
it. It has to look. This asks the public downloads repository what the latest
release is, compares that to the version it was built as, and hands the
answer to the interface, which shows a notice the way an operating system
would rather than leaving people on an old build indefinitely.

Finding an update starts fetching it, on a background thread, the way an
operating system does. Nothing is *installed* automatically: the installer
replaces the files the app is running from, so the window has to close, and
that is a moment somebody agrees to rather than one that happens to them.

The check itself reads a public endpoint and sends no identifying information.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
from typing import Optional

logger = logging.getLogger("updates")

APP_VERSION = os.getenv("SMARAN_APP_VERSION", "2.9.8")

# The repository that holds the released builds. Separate from the source
# repository - which is public, MIT, and carries no binaries - because a
# 267 MB installer per release does not belong in a git history.
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

    def asset_size(name: str) -> Optional[int]:
        entry = assets.get(name)
        return entry.get("size") if entry else None

    payload = {
        "current_version": APP_VERSION,
        "latest_version": tag or None,
        "update_available": bool(tag) and _is_newer(tag, APP_VERSION),
        "checked": True,
        "published_at": release.get("published_at"),
        "notes": (release.get("body") or "").strip()[:4000],
        "release_page": release.get("html_url") or RELEASES_PAGE,
        "windows_url": asset_url("SMARAN.AI-Setup.exe"),
        # What the release says the installer weighs, so a part-finished file
        # on disk can be told apart from a complete one.
        "windows_size": asset_size("SMARAN.AI-Setup.exe"),
        "android_url": asset_url("SMARAN.AI.apk"),
        "vsix_url": asset_url("smaran-ai-codex.vsix"),
    }

    # Whether the installer for this exact version is already sitting on disk
    # waiting to be run. Without this the notice went on asking you to
    # download something you had already downloaded, which is how a notice
    # becomes a thing people learn to close without reading.
    payload["downloaded_path"] = _already_downloaded(payload)

    _cache["checked_at"] = now
    _cache["payload"] = payload
    return payload


def _already_downloaded(payload: dict) -> Optional[str]:
    """The path to a complete installer for the offered version, if there is one.

    Matched by size against what the release says the asset weighs. A file of
    the right name that is half the length is a download that was interrupted,
    and offering to install it would be offering a broken install.
    """
    if not payload.get("update_available"):
        return None
    url = payload.get("windows_url")
    if not url:
        return None

    name = os.path.basename(url.split("?")[0])
    path = os.path.join(_download_dir(payload.get("latest_version")), name)
    if not os.path.isfile(path):
        return None

    expected = payload.get("windows_size")
    if expected and os.path.getsize(path) != expected:
        # The right name at the wrong length is an interrupted download.
        # Offering to install it would be offering a broken install.
        return None
    if os.path.getsize(path) == 0:
        return None
    return path


# ---------------------------------------------------------------------------
# Fetching the installer
#
# Checking told you a new version existed and then left you to find it. That
# is not an update; that is a notice. What follows downloads the installer the
# check already found and hands it to Windows to run.
#
# The install itself is still a decision made by a person clicking Install,
# and the installer's own window still appears. Nothing is replaced silently:
# the app is running from the files being upgraded, so it has to close, and it
# should be the owner who agrees to that rather than a background task.
# ---------------------------------------------------------------------------

def _download_root() -> str:
    """Where downloaded installers live.

    Beside the app's own data rather than in Downloads: this is a file the app
    fetched for itself, and a 267 MB installer appearing unannounced among
    someone's own downloads is the app making a mess in a folder that is not
    its own.
    """
    from app.config import settings

    path = os.path.join(settings.DATA_DIR, "updates")
    os.makedirs(path, exist_ok=True)
    return path


def _download_dir(version: Optional[str] = None) -> str:
    """The folder for one version's installer.

    Kept per-version so "is the update already downloaded" can be answered by
    looking, rather than by trusting a file name. A stray installer from an
    older release cannot be mistaken for the current one.
    """
    path = os.path.join(_download_root(), str(version or "unknown"))
    os.makedirs(path, exist_ok=True)
    return path


def download(url: str, version: Optional[str] = None, expected_name: Optional[str] = None):
    """Stream the installer to disk, reporting progress as it goes.

    Yields dicts. Progress is real: bytes actually written over the length the
    server declared. Where the server declares no length - which happens on a
    redirect chain - total is None and the interface is told the size is
    unknown rather than shown a bar moving against a number nobody has.

    The file is written to a .part and renamed only once the download has
    finished and its size matches. A truncated installer that was named as
    though it were complete would fail halfway through installing, and it
    would look like the update was broken rather than the download.
    """
    if not url or not url.startswith("https://"):
        yield {"type": "error", "message": "That is not a download address."}
        return

    name = expected_name or os.path.basename(url.split("?")[0]) or "SMARAN.AI-Setup.exe"
    folder = _download_dir(version)
    final = os.path.join(folder, name)
    part = final + ".part"

    # Already here and complete. Re-fetching 267 MB because a settings tab was
    # opened twice is not something to do to someone's connection.
    if os.path.isfile(final) and os.path.getsize(final) > 0:
        size = os.path.getsize(final)
        yield {"type": "start", "name": name, "total": size, "path": final}
        yield {"type": "done", "path": final, "name": name, "bytes": size,
               "reused": True}
        return

    # A quarter of a gigabyte over a home connection takes minutes, and a
    # single dropped connection in those minutes used to throw away everything
    # already written. Testing this against the real release hit exactly that:
    # one attempt failed the TLS handshake outright while the same URL fetched
    # fine a second later.
    #
    # So a broken transfer is resumed rather than restarted. What is already
    # in the .part is kept and the rest asked for with a Range header. If the
    # server ignores Range - it answers 200 instead of 206 - the file is
    # started again from nothing, because appending to a part-file a full
    # response would corrupt it.
    written = 0
    total: Optional[int] = None
    last_reported = 0.0
    started = False
    attempt = 0
    ATTEMPTS = 4

    while attempt < ATTEMPTS:
        attempt += 1
        have = os.path.getsize(part) if os.path.isfile(part) else 0

        headers = {"User-Agent": "SMARAN.AI-update-download"}
        if have:
            headers["Range"] = "bytes=%d-" % have
        request = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                resuming = response.status == 206 and have > 0
                if have and not resuming:
                    # Range was refused; this is a whole file, so start over.
                    have = 0

                declared = response.headers.get("Content-Length")
                length = int(declared) if declared and declared.isdigit() else None
                total = (have + length) if length is not None else None
                written = have

                if not started:
                    started = True
                    yield {"type": "start", "name": name, "total": total,
                           "path": final}
                else:
                    yield {"type": "progress", "written": written, "total": total,
                           "resumed": True}

                with open(part, "ab" if resuming else "wb") as handle:
                    while True:
                        chunk = response.read(262144)
                        if not chunk:
                            break
                        handle.write(chunk)
                        written += len(chunk)

                        # Roughly four times a second. A message per 256 KB
                        # chunk on a 267 MB file is a thousand updates the
                        # interface cannot draw and does not need.
                        now_ts = time.time()
                        if now_ts - last_reported >= 0.25:
                            last_reported = now_ts
                            yield {"type": "progress", "written": written,
                                   "total": total}

            if total is None or written >= total:
                break

            # The connection closed early without raising. Another pass picks
            # up from what is on disk.
            logger.info("Update download ended at %d of %d; resuming.", written, total)
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            if attempt >= ATTEMPTS:
                try:
                    os.remove(part)
                except OSError:
                    pass
                yield {"type": "error",
                       "message": ("The download did not finish after %d attempts: %s"
                                   % (ATTEMPTS, str(exc)[:140]))}
                return
            logger.info("Update download attempt %d failed (%s); retrying.",
                        attempt, str(exc)[:100])
            time.sleep(2 * attempt)

    if total is not None and written != total:
        try:
            os.remove(part)
        except OSError:
            pass
        yield {"type": "error",
               "message": ("The download stopped early - %d of %d bytes. "
                           "Nothing was kept." % (written, total))}
        return

    try:
        # Windows will not rename onto an existing file.
        if os.path.exists(final):
            os.remove(final)
        os.replace(part, final)
    except OSError as exc:
        yield {"type": "error",
               "message": "The file could not be saved: %s" % str(exc)[:160]}
        return

    # Installers for versions that have been superseded are dead weight - a
    # few hundred megabytes each - and there is no reason to keep one once a
    # newer one has arrived.
    root = _download_root()
    for stale in os.listdir(root):
        stale_path = os.path.join(root, stale)
        if os.path.abspath(stale_path) == os.path.abspath(folder):
            continue
        try:
            shutil.rmtree(stale_path, ignore_errors=True)
        except OSError:
            pass

    yield {"type": "done", "path": final, "name": name, "bytes": written}


# ---------------------------------------------------------------------------
# Downloading in the background, for real
#
# The first version of this streamed progress down the same request the page
# opened, which meant closing the Settings window cancelled the request and
# killed the download - while the interface said "you can keep working; it
# downloads in the background". It did not.
#
# So the work happens on a thread that outlives any request, and the page asks
# how it is going. Closing Settings, or the whole tab, now leaves it running.
# ---------------------------------------------------------------------------

_progress: dict = {"state": "idle", "written": 0, "total": None,
                   "path": None, "error": None, "version": None}
_progress_lock = threading.Lock()


def download_status() -> dict:
    with _progress_lock:
        return dict(_progress)


def start_download(url: str, version: Optional[str] = None) -> dict:
    """Begin fetching in the background, or report the one already running.

    Asking twice does not start two downloads of the same quarter-gigabyte
    file; the second caller is simply told the state of the first.
    """
    with _progress_lock:
        if _progress["state"] == "running":
            return dict(_progress)
        _progress.update({"state": "running", "written": 0, "total": None,
                          "path": None, "error": None, "version": version})

    def _run() -> None:
        for event in download(url, version=version):
            with _progress_lock:
                if event["type"] == "start":
                    _progress["total"] = event.get("total")
                    _progress["path"] = event.get("path")
                elif event["type"] == "progress":
                    _progress["written"] = event.get("written", 0)
                    _progress["total"] = event.get("total")
                elif event["type"] == "done":
                    _progress.update({"state": "done",
                                      "written": event.get("bytes", 0),
                                      "total": event.get("bytes", 0),
                                      "path": event.get("path")})
                elif event["type"] == "error":
                    _progress.update({"state": "error",
                                      "error": event.get("message")})

        with _progress_lock:
            if _progress["state"] == "running":
                # The generator ended without a final word. Saying "finished"
                # here would be inventing an outcome nobody reported.
                _progress.update({"state": "error",
                                  "error": "The download ended without finishing."})

    threading.Thread(target=_run, daemon=True, name="smaran-update-download").start()
    return download_status()


def install(path: str) -> dict:
    """Hand the downloaded installer to Windows and let it take over.

    This does not install anything itself and does not pass a silent flag: the
    installer's own window opens, with its own choices, exactly as it would if
    the file were double-clicked. The app is then closed by the caller,
    because the installer replaces the files it is running from.
    """
    if not path or not os.path.isfile(path):
        return {"started": False,
                "error": "There is no downloaded installer at that path."}

    # Only ever a file this module downloaded. An arbitrary path arriving on
    # this endpoint - from a model, or from anything else that can reach the
    # local API - would otherwise be a way to run any program on the machine.
    root = os.path.abspath(_download_root())
    resolved = os.path.abspath(path)
    if os.path.commonpath([root, resolved]) != root:
        return {"started": False,
                "error": "That file is not one this app downloaded."}
    if not resolved.lower().endswith(".exe"):
        return {"started": False,
                "error": "That is not an installer."}

    try:
        os.startfile(path)  # noqa: S606 - Windows' own "open this file"
    except (OSError, AttributeError) as exc:
        return {"started": False,
                "error": "Windows would not open the installer: %s" % str(exc)[:160]}

    return {"started": True, "path": path,
            "detail": "The installer is opening. Close SMARAN.AI to let it "
                      "replace the running version."}
