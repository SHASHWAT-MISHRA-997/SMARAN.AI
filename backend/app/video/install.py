"""Fetching the video packages on demand.

The installer is about 770 MB. PyTorch with CUDA is another three gigabytes,
and most people never generate a video, so shipping it to everyone to serve a
few is the wrong trade. It is fetched when it is first wanted instead — the
same way models already are.

The awkward part is that a frozen build has no pip: PyInstaller bundles a
Python but not the tooling that installs into it. So the packages go into a
directory of their own and that directory is put on sys.path, which is also
why VIDEO_PACKAGES pins the CUDA index — the default wheel is CPU-only and
would install quietly and then be useless.

Installing a second time used to fail outright, and the reason is Windows
rather than pip. This directory goes on sys.path at startup, so by the time
anyone presses Install again the process has already imported things from it -
protobuf's `google/_upb/_message.pyd` among them. A loaded DLL cannot be
overwritten, so `pip --upgrade` reached that one file and stopped with
"[WinError 5] Access is denied", four gigabytes into the work.

So the install goes to a staging directory that is never on sys.path and
therefore never holds a loaded DLL. The finished directory takes the live one's
place - now if nothing is loaded from it yet, at the next startup otherwise,
before a single import has had the chance to lock anything.

Nothing here reports progress it has not seen. Bytes come from pip's own
`--progress-bar raw` counter, so the current file's percentage is exact; the
figure for the whole install is measured against the size below and is marked
as the estimate it is.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)

# Measured: the pip cache grew to 3.2 GB installing these on this machine.
APPROX_DOWNLOAD_GB = 3.2

CUDA_INDEX = "https://download.pytorch.org/whl/cu126"

VIDEO_PACKAGES: List[str] = [
    "torch",
    "torchvision",
    "diffusers",
    "transformers",
    "accelerate",
    "imageio",
    "imageio-ffmpeg",
    "sentencepiece",
    "protobuf",
]

#: Written last, so a staging directory left behind by a crashed or cancelled
#: install is never mistaken for a finished one.
COMPLETE_MARKER = ".install-complete"

_state = {
    "status": "idle",       # idle | running | done | failed
    "messages": [],
    "error": None,
    # Bytes pip reported, not bytes guessed from elapsed time.
    "downloaded_bytes": 0,
    "current_name": None,
    "current_bytes": 0,
    "current_total": 0,
    "restart_required": False,
}
_lock = threading.Lock()

_PROGRESS = re.compile(r"^Progress (\d+) of (\d+)\s*$")
_DOWNLOADING = re.compile(r"^\s*Downloading (\S+)")


def packages_dir() -> str:
    from app.config import settings

    return os.path.join(settings.DATA_DIR, "video-packages")


def staging_dir() -> str:
    """Where an install is assembled. Deliberately never on sys.path."""
    return packages_dir() + ".incoming"


def _discard_later(path: str) -> None:
    """Delete a directory off the startup path.

    The old copy is four gigabytes and more, and removing it inline would add
    the better part of a minute to a launch that has nothing else to wait for.
    Renaming it is instant; the deletion can take as long as it likes.
    """
    def _remove() -> None:
        shutil.rmtree(path, ignore_errors=True)

    threading.Thread(target=_remove, daemon=True,
                     name="smaran-video-packages-discard").start()


def promote_staged() -> bool:
    """Move a finished staging directory into place. True if one moved.

    Called before the live directory is put on sys.path, which is the only
    moment it is certainly not holding a loaded DLL. Every step is allowed to
    fail: a directory that cannot be replaced this time is still there to be
    replaced at the next start, and the copy already installed keeps working
    until then.
    """
    staging = staging_dir()
    if not os.path.isfile(os.path.join(staging, COMPLETE_MARKER)):
        return False

    live = packages_dir()
    retired = live + ".old"
    try:
        if os.path.isdir(live):
            shutil.rmtree(retired, ignore_errors=True)
            os.rename(live, retired)
        os.rename(staging, live)
    except OSError as exc:
        logger.info("The staged video packages could not be moved in yet: %s", exc)
        return False

    if os.path.isdir(retired):
        _discard_later(retired)
    logger.info("Staged video packages are now live at %s", live)
    return True


def ensure_on_path() -> bool:
    """Put the fetched packages where imports can find them.

    Called at startup. Returns whether the directory existed, so a caller can
    tell "nothing installed" from "installed and now importable".
    """
    # First, and before sys.path is touched: nothing has been imported from
    # the live directory yet, so this is the one point where it can be
    # replaced without fighting a DLL that Windows has already loaded.
    promote_staged()

    directory = packages_dir()
    if not os.path.isdir(directory):
        return False

    if directory not in sys.path:
        # First, so a package here wins over anything of the same name baked
        # into the bundle.
        sys.path.insert(0, directory)

    # Compiled extensions load DLLs from beside themselves, and on Windows
    # that lookup does not follow sys.path. Without this torch imports and
    # then fails on its first CUDA call.
    if os.name == "nt" and hasattr(os, "add_dll_directory"):
        for candidate in ("torch/lib", "nvidia"):
            path = os.path.join(directory, *candidate.split("/"))
            if os.path.isdir(path):
                try:
                    os.add_dll_directory(path)
                except OSError:
                    pass
    return True


def _python_that_can_install() -> Optional[str]:
    """An interpreter able to run pip, or None.

    The frozen executable is not one: it is this application, and passing it
    -m pip runs the application again. A separate Python has to be found, and
    when there is none that is a fact worth stating rather than working around.
    """
    if not getattr(sys, "frozen", False):
        return sys.executable

    for name in ("python", "python3", "py"):
        found = shutil.which(name)
        if not found:
            continue
        try:
            probe = subprocess.run(
                [found, "-c", "import pip, sys; print(sys.version_info[:2])"],
                capture_output=True, timeout=25, text=True,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0:
            return found
    return None


#: Held apart from status() because _run() needs it while it already holds the
#: lock. Reading it through status() there was a deadlock: the lock is not
#: reentrant, so the install thread waited on itself and the panel sat on
#: "running" forever - only ever reachable on a machine with no usable Python,
#: which is why it went unnoticed.
_NO_INTERPRETER = (
    "No Python with pip was found on this machine, and the packaged app does "
    "not carry one. Install Python from python.org and reopen this, or run "
    "SMARAN.AI from source where the packages can be installed directly."
)


def status() -> dict:
    with _lock:
        installed = ensure_on_path()
        try:
            import torch  # noqa: F401
            have_torch = True
        except ImportError:
            have_torch = False

        interpreter = _python_that_can_install()
        approx_total = int(APPROX_DOWNLOAD_GB * 1000 ** 3)
        downloaded = _state["downloaded_bytes"] + _state["current_bytes"]
        current_total = _state["current_total"]
        return {
            "status": _state["status"],
            "messages": list(_state["messages"])[-40:],
            "error": _state["error"],
            "installed": have_torch,
            "directory": packages_dir() if installed else None,
            "approx_download_gb": APPROX_DOWNLOAD_GB,
            "can_install": interpreter is not None,
            "blocker": None if interpreter else _NO_INTERPRETER,
            # What pip actually counted. The file figures are exact; the one
            # for the whole install is measured against a size that was right
            # on one machine, so it is named an estimate and never shown at
            # 100% while work is still going on.
            "downloaded_bytes": downloaded,
            "approx_total_bytes": approx_total,
            "approx_percent": (
                min(99, int(downloaded * 100 / approx_total))
                if approx_total and _state["status"] == "running" else
                (100 if _state["status"] == "done" else 0)
            ),
            "current_name": _state["current_name"],
            "current_bytes": _state["current_bytes"],
            "current_total": current_total,
            "current_percent": (
                int(_state["current_bytes"] * 100 / current_total)
                if current_total else None
            ),
            "restart_required": _state["restart_required"],
        }


def _run(on_message: Optional[Callable[[str], None]] = None) -> None:
    def note(text: str) -> None:
        with _lock:
            _state["messages"].append(text)
        logger.info("video install: %s", text)
        if on_message:
            on_message(text)

    interpreter = _python_that_can_install()
    if not interpreter:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = _NO_INTERPRETER
        return

    # A directory of its own, and an empty one. Installing over the live copy
    # is what produced "[WinError 5] Access is denied" on every retry: the
    # running app has DLLs open in there and Windows will not let pip replace
    # a file that is loaded. Nothing has ever imported from here, so there is
    # nothing to be denied.
    target = staging_dir()
    shutil.rmtree(target, ignore_errors=True)
    try:
        os.makedirs(target, exist_ok=True)
    except OSError as exc:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = "Could not prepare %s: %s" % (target, exc)
        return

    note("Installing into %s" % target)
    note("About %.1f GB will be downloaded. This takes a while." % APPROX_DOWNLOAD_GB)

    command = [
        interpreter, "-m", "pip", "install",
        "--target", target,
        "--upgrade",
        # Machine-readable byte counts instead of a bar drawn for a terminal
        # that is not attached. pip prints "Progress <n> of <total>" per file,
        # which is where every number the panel shows comes from.
        "--progress-bar", "raw",
        "--index-url", CUDA_INDEX,
        # The CUDA index carries torch; everything else comes from PyPI.
        "--extra-index-url", "https://pypi.org/simple",
        *VIDEO_PACKAGES,
    ]

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as exc:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = "Could not start pip: %s" % exc
        return

    # Every line is kept here, briefly, whatever it looks like.
    #
    # The panel only ever showed lines starting with Collecting, Downloading,
    # Installing, Successfully or ERROR - and pip does not announce most
    # failures that way. A resolver conflict, a missing wheel for this Python,
    # a proxy refusal: all of those arrive as lowercase "error:", as "note:",
    # or inside a box drawn with "x" and "|__". Every one of them was filtered
    # out, and the failure then read "pip exited with code 2. The last lines
    # above say why" above nothing at all.
    tail: list[str] = []

    for line in process.stdout or []:
        text = line.rstrip()
        if not text:
            continue

        # Byte counts are state, not conversation: they update the numbers the
        # panel reads and are kept out of the message list, which would
        # otherwise be thousands of lines of "Progress ... of ...".
        counted = _PROGRESS.match(text)
        if counted:
            with _lock:
                _state["current_bytes"] = int(counted.group(1))
                _state["current_total"] = int(counted.group(2))
            continue

        tail.append(text)
        if len(tail) > 60:
            del tail[0]

        started = _DOWNLOADING.match(text)
        if started:
            # The file that just finished is banked before the next one
            # starts, so the running total is the sum of whole files plus
            # however far the current one has come.
            with _lock:
                _state["downloaded_bytes"] += _state["current_total"]
                _state["current_name"] = started.group(1)
                _state["current_bytes"] = 0
                _state["current_total"] = 0

        # The panel still shows only progress, so it does not become a log
        # dump while things are going well.
        if text.startswith(("Collecting", "Downloading", "Installing", "Successfully", "ERROR")):
            note(text[:180])

    process.wait()

    with _lock:
        # Whatever the last file reached is part of the total now that there
        # is no next Downloading line to bank it.
        _state["downloaded_bytes"] += _state["current_bytes"]
        _state["current_name"] = None
        _state["current_bytes"] = 0
        _state["current_total"] = 0

    if process.returncode != 0:
        # The lines that actually explain it, preferred over the ones that
        # merely came last.
        blamed = [t for t in tail if any(
            mark in t.lower() for mark in
            ("error", "could not find", "no matching distribution",
             "conflict", "not supported", "failed", "denied", "unable to")
        )]
        reason = chr(10).join((blamed or tail)[-6:])[:900]
        for line in (blamed or tail)[-6:]:
            note(line[:180])
        with _lock:
            _state["status"] = "failed"
            _state["error"] = (
                "pip exited with code %s.%s"
                % (process.returncode, (chr(10) * 2 + reason) if reason else
                   " It printed nothing that explains why.")
            )
        return

    # Last, so that a directory left behind by a crash or a cancelled install
    # is never promoted as though it were finished.
    try:
        with open(os.path.join(target, COMPLETE_MARKER), "w", encoding="utf-8") as marker:
            marker.write("pip exited 0\n")
    except OSError as exc:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = "The download finished but could not be marked complete: %s" % exc
        return

    if not promote_staged():
        # Expected whenever this is a second install: the live directory holds
        # DLLs this process loaded at startup and Windows will not let them go
        # until it exits. The work is done and waiting, and it is claimed as
        # done rather than failed, because it is.
        note("Installed. The running copy is still in use, so restart "
             "SMARAN.AI to switch to it.")
        with _lock:
            _state["status"] = "done"
            _state["restart_required"] = True
            _state["error"] = None
        return

    ensure_on_path()
    try:
        import torch  # noqa: F401
    except ImportError as exc:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = (
                "The packages installed but torch still will not import: %s. "
                "This usually means the wheel does not match this Python." % exc
            )
        return

    note("Done. Video generation is available.")
    with _lock:
        _state["status"] = "done"
        _state["error"] = None


def start() -> dict:
    """Begin an install, unless one is already running."""
    with _lock:
        if _state["status"] == "running":
            return {"started": False, "detail": "An install is already running."}
        _state.update(status="running", messages=[], error=None,
                      downloaded_bytes=0, current_name=None, current_bytes=0,
                      current_total=0, restart_required=False)

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True, "detail": "Installing. Watch /api/video/install for progress."}
