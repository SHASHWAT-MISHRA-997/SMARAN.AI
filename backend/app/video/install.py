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

Nothing here reports progress it has not seen. The size below was measured by
watching the download, not estimated.
"""

from __future__ import annotations

import logging
import os
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

_state = {
    "status": "idle",       # idle | running | done | failed
    "messages": [],
    "error": None,
}
_lock = threading.Lock()


def packages_dir() -> str:
    from app.config import settings

    return os.path.join(settings.DATA_DIR, "video-packages")


def ensure_on_path() -> bool:
    """Put the fetched packages where imports can find them.

    Called at startup. Returns whether the directory existed, so a caller can
    tell "nothing installed" from "installed and now importable".
    """
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


def status() -> dict:
    with _lock:
        installed = ensure_on_path()
        try:
            import torch  # noqa: F401
            have_torch = True
        except ImportError:
            have_torch = False

        interpreter = _python_that_can_install()
        return {
            "status": _state["status"],
            "messages": list(_state["messages"])[-40:],
            "error": _state["error"],
            "installed": have_torch,
            "directory": packages_dir() if installed else None,
            "approx_download_gb": APPROX_DOWNLOAD_GB,
            "can_install": interpreter is not None,
            "blocker": None if interpreter else (
                "No Python with pip was found on this machine, and the packaged "
                "app does not carry one. Install Python from python.org and "
                "reopen this, or run SMARAN.AI from source where the packages "
                "can be installed directly."
            ),
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
            _state["error"] = status()["blocker"]
        return

    target = packages_dir()
    os.makedirs(target, exist_ok=True)
    note("Installing into %s" % target)
    note("About %.1f GB will be downloaded. This takes a while." % APPROX_DOWNLOAD_GB)

    command = [
        interpreter, "-m", "pip", "install",
        "--target", target,
        "--upgrade",
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

    for line in process.stdout or []:
        text = line.rstrip()
        # pip is verbose. Only the lines that mark progress are kept, so the
        # panel shows movement without becoming a log dump.
        if text.startswith(("Collecting", "Downloading", "Installing", "Successfully", "ERROR")):
            note(text[:180])

    process.wait()

    if process.returncode != 0:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = (
                "pip exited with code %s. The last lines above say why."
                % process.returncode
            )
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
        _state.update(status="running", messages=[], error=None)

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True, "detail": "Installing. Watch /api/video/install for progress."}
