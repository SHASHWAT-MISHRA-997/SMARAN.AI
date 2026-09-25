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
import importlib
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
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

#: Room needed before starting. The packages are about 3.2 GB downloaded, and
#: pip stages a wheel in its cache and again in the target, so the peak is
#: roughly twice the download. Refusing up front beats running out four
#: gigabytes in and leaving a half-written directory behind.
REQUIRED_FREE_GB = 8.0

_state = {
    "status": "idle",       # idle | running | done | failed | cancelled
    #: Which part of the work this is. The packages are what this module
    #: installs; the model weights are a separate, later download and are not
    #: counted here, so the two are never added into one misleading bar.
    "phase": None,          # None | "packages"
    "messages": [],
    "error": None,
    # Bytes pip reported, not bytes guessed from elapsed time.
    "downloaded_bytes": 0,
    "current_name": None,
    "current_bytes": 0,
    "current_total": 0,
    "restart_required": False,
    #: Bytes that came from pip's cache rather than the network. Counted
    #: towards progress, because they are progress, but kept apart from
    #: downloaded_bytes so neither number claims to be the other.
    "cached_bytes": 0,
    "started_at": None,
    #: Rolling samples of (time, bytes) used for speed. A rate taken over the
    #: whole run reads far too low after one slow patch and never recovers.
    "samples": [],
}
_lock = threading.Lock()
#: The running pip, so a cancel can actually stop it rather than setting a
#: flag and letting four gigabytes continue to arrive.
_process: Optional[subprocess.Popen] = None
_cancelled = threading.Event()

#: How far back the speed is measured. Long enough not to jump about, short
#: enough to notice that the connection has changed.
SPEED_WINDOW_SECONDS = 20.0
_activation_lock = threading.RLock()
_activated_directory: Optional[str] = None
_activation_error: Optional[str] = None
_dll_handles: list = []
#: Why the packages could not be loaded, once they could not. Kept for the
#: life of the process: a native extension that failed half way through its
#: import cannot be imported again until restart, so asking again only
#: repeats the failure (see _register_dll_directories_once for what each
#: repeat used to cost).
_package_failure: Optional[str] = None
_dll_directories: dict = {}
_dll_register_lock = threading.Lock()

_PROGRESS = re.compile(r"^Progress (\d+) of (\d+)\s*$")
_DOWNLOADING = re.compile(r"^\s*Downloading (\S+)")
#: A wheel pip already had. It prints no byte progress for these, because
#: nothing is transferred - so an install served entirely from the cache
#: showed 0 MB and 0% from beginning to end while 4.76 GB was put in place.
#: The size is in the line, so it can be counted as the progress it is.
_CACHED = re.compile(r"^\s*Using cached (\S+)\s+\(([\d.]+)\s*([kKMG]?B)\)")

_UNIT_BYTES = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3}


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
    with _activation_lock:
        return _promote_staged()


def _promote_staged() -> bool:
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
    # Even on platforms that allow renaming loaded libraries, changing the
    # import tree underneath this process can mix incompatible package versions.
    if _activated_directory == os.path.abspath(live):
        return False
    retired = live + ".old-" + uuid.uuid4().hex
    moved_live = False
    try:
        if os.path.isdir(live):
            os.rename(live, retired)
            moved_live = True
        os.rename(staging, live)
    except OSError as exc:
        if moved_live:
            try:
                os.rename(retired, live)
            except OSError:
                logger.exception("Could not restore video packages from %s", retired)
        logger.info("The staged video packages could not be moved in yet: %s", exc)
        return False

    if os.path.isdir(retired):
        _discard_later(retired)
    logger.info("Staged video packages are now live at %s", live)
    return True


class _AlreadyRegistered:
    """What a repeat registration returns: the folder is on the list already."""

    def __init__(self, path):
        self.path = path

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass


def _register_dll_directories_once() -> None:
    """Make os.add_dll_directory register a folder once per process.

    Windows keeps every registration, duplicates included, and refuses more
    at about 32K characters in total with WinError 206, "The filename or
    extension is too long". torch registers torch\lib on every import
    attempt, and a failed import was retried by every status poll - so after
    a few hundred polls torch could not load at all, and the error that had
    started it was long out of sight.
    """
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return
    if getattr(os.add_dll_directory, "_registers_once", False):
        return
    original = os.add_dll_directory

    def add_once(path):
        key = os.path.normcase(os.path.abspath(os.fspath(path)))
        with _dll_register_lock:
            if key in _dll_directories:
                return _AlreadyRegistered(path)
            handle = original(path)
            _dll_directories[key] = handle
        real_close = handle.close

        def close() -> None:
            with _dll_register_lock:
                _dll_directories.pop(key, None)
            real_close()

        handle.close = close
        return handle

    add_once._registers_once = True
    os.add_dll_directory = add_once


def ensure_on_path() -> bool:
    with _activation_lock:
        return _ensure_on_path()


def _compatibility_error(directory: str) -> Optional[str]:
    """Reject foreign wheels before they can shadow bundled speech packages."""
    from email.parser import Parser
    from packaging.tags import parse_tag, sys_tags
    from packaging.version import Version

    supported = set(sys_tags())
    for metadata in sorted(Path(directory).glob("*.dist-info/WHEEL")):
        try:
            tags = set()
            for line in metadata.read_text(encoding="utf-8").splitlines():
                if line.startswith("Tag: "):
                    tags.update(parse_tag(line[5:].strip()))
        except (OSError, ValueError) as exc:
            return f"Cannot validate video package {metadata.parent.name}: {exc}"
        if tags and tags.isdisjoint(supported):
            return (f"Video package {metadata.parent.name} is incompatible with this "
                    "operating system or Python version. Reinstall video packages "
                    "for this runtime; the existing files have been preserved.")
    # importlib.metadata finds dist-info even when an interrupted install left
    # no METADATA behind. Its None version then crashes Transformers before
    # the otherwise working system Torch can be used.
    for info in sorted(Path(directory).glob("*.dist-info")):
        try:
            metadata = Parser().parsestr((info / "METADATA").read_text(encoding="utf-8"))
            if not metadata.get("Name") or not metadata.get("Version"):
                raise ValueError("missing Name or Version")
            Version(metadata["Version"])
        except (OSError, ValueError, UnicodeError) as exc:
            return (f"Video package {info.name} has incomplete or invalid metadata: {exc}. "
                    "Reinstall video packages for this runtime; the existing files "
                    "have been preserved.")
    return None


def _ensure_on_path() -> bool:
    """Put the fetched packages where imports can find them.

    Called at startup. Returns whether the directory existed, so a caller can
    tell "nothing installed" from "installed and now importable".
    """
    # First, and before sys.path is touched: nothing has been imported from
    # the live directory yet, so this is the one point where it can be
    # replaced without fighting a DLL that Windows has already loaded.
    global _activated_directory, _activation_error
    _register_dll_directories_once()
    directory = packages_dir()
    if _activated_directory == os.path.abspath(directory):
        return os.path.isdir(directory)
    promote_staged()

    directory = packages_dir()
    if not os.path.isdir(directory):
        _activation_error = None
        return False

    _activation_error = _compatibility_error(directory)
    if _activation_error:
        logger.warning("%s", _activation_error)
        return False

    if directory not in sys.path:
        # First, so a package here wins over anything of the same name baked
        # into the bundle.
        sys.path.insert(0, directory)
    _activated_directory = os.path.abspath(directory)
    _reach_into(directory)

    # Compiled extensions load DLLs from beside themselves, and on Windows
    # that lookup does not follow sys.path. Without this torch imports and
    # then fails on its first CUDA call.
    if os.name == "nt" and hasattr(os, "add_dll_directory"):
        for candidate in ("torch/lib", "nvidia"):
            path = os.path.join(directory, *candidate.split("/"))
            if os.path.isdir(path):
                try:
                    _dll_handles.append(os.add_dll_directory(path))
                except OSError:
                    pass
    return True


def _reach_into(directory: str) -> None:
    """Let packages the app already imported find their missing parts here.

    Being first on sys.path only helps what is imported from now on. A
    package the app has already loaded from the bundle (Pillow, numpy,
    huggingface_hub, packaging...) stays the bundled copy, and PyInstaller
    bundled only the submodules the app itself uses - so torchvision's
    `from PIL import ImageEnhance` failed with the full Pillow sitting here.
    Adding this directory's copy to each such package's search path lets a
    missing submodule come from here instead of failing.
    """
    root = os.path.abspath(directory)
    for name, module in list(sys.modules.items()):
        search = getattr(module, "__path__", None)
        if search is None:
            continue
        origin = getattr(module, "__file__", None) or ""
        if origin and os.path.abspath(origin).startswith(root + os.sep):
            continue
        extra = os.path.join(root, *name.split("."))
        if not os.path.isdir(extra) or extra in list(search):
            continue
        try:
            search.append(extra)
        except (AttributeError, TypeError):  # a __path__ that cannot grow
            pass


def _python_that_can_install() -> Optional[str]:
    """An interpreter able to run pip, or None.

    The frozen executable is not one: it is this application, and passing it
    -m pip runs the application again. A separate Python has to be found, and
    when there is none that is a fact worth stating rather than working around.
    """
    if not getattr(sys, "frozen", False):
        return sys.executable

    candidates = [shutil.which(name) for name in ("python", "python3")]
    launcher = shutil.which("py")
    if launcher:
        try:
            selected = subprocess.run(
                [launcher, f"-{sys.version_info.major}.{sys.version_info.minor}",
                 "-c", "import sys; print(sys.executable)"],
                capture_output=True, timeout=25, text=True,
            )
            if selected.returncode == 0:
                candidates.insert(0, selected.stdout.strip())
        except (OSError, subprocess.TimeoutExpired):
            pass
    for found in candidates:
        if not found:
            continue
        try:
            probe = subprocess.run(
                [found, "-c", "import pip, sys; print(sys.version_info[:2])"],
                capture_output=True, timeout=25, text=True,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0 and probe.stdout.strip() == str(sys.version_info[:2]):
            return found
    return None


#: Held apart from status() because _run() needs it while it already holds the
#: lock. Reading it through status() there was a deadlock: the lock is not
#: reentrant, so the install thread waited on itself and the panel sat on
#: "running" forever - only ever reachable on a machine with no usable Python,
#: which is why it went unnoticed.
_NO_INTERPRETER = (
    "No compatible Python with pip was found on this machine (Python "
    f"{sys.version_info.major}.{sys.version_info.minor} is required), and the packaged app does "
    "not carry one. Install Python from python.org and reopen this, or run "
    "SMARAN.AI from source where the packages can be installed directly."
)


def free_space_gb(path: str) -> Optional[float]:
    """Free gigabytes on the volume that will hold the install, or None.

    The staging directory does not exist yet when this is asked, so the
    nearest parent that does is measured.
    """
    probe = path
    for _ in range(6):
        if os.path.isdir(probe):
            try:
                return shutil.disk_usage(probe).free / (1000 ** 3)
            except OSError:
                return None
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        probe = parent
    return None


def _speed_bytes_per_second() -> Optional[float]:
    """Bytes per second over the recent window, or None with too little data.

    None rather than zero: a rate of zero reads as a stalled download, and at
    the start of a run the honest answer is that it is not known yet.
    """
    samples = _state["samples"]
    if len(samples) < 2:
        return None
    first_at, first_bytes = samples[0]
    last_at, last_bytes = samples[-1]
    seconds = last_at - first_at
    if seconds < 1.0:
        return None
    moved = last_bytes - first_bytes
    return max(0.0, moved / seconds)


def _record_progress(total_bytes: int) -> None:
    """Add a sample and drop the ones that have aged out. Caller holds _lock."""
    now = time.time()
    samples = _state["samples"]
    samples.append((now, total_bytes))
    cutoff = now - SPEED_WINDOW_SECONDS
    while len(samples) > 2 and samples[0][0] < cutoff:
        samples.pop(0)


def load_failure() -> Optional[str]:
    """Why the installed packages would not load, or None."""
    return _package_failure


def remember_failure(name: str, exc: BaseException) -> str:
    """Record a package that is present and would not load; returns the text.

    Logged once with its traceback. It used to be dropped: the status said
    "not installed" while the packages sat on disk, and nothing said why.
    """
    global _package_failure
    if _package_failure is None:
        _package_failure = f"{name}: {type(exc).__name__}: {exc}"
        logger.error("The image and video packages would not load (%s)", name, exc_info=exc)
    return _package_failure


def _package_error() -> Optional[str]:
    if _package_failure:
        return _package_failure
    if "torch" not in sys.modules and _activated_directory:
        # Whatever the app has imported since activation, reachable too.
        _reach_into(_activated_directory)
    for name in ("torch", "torchvision", "diffusers", "transformers", "accelerate",
                 "imageio", "imageio_ffmpeg", "sentencepiece", "google.protobuf"):
        try:
            importlib.import_module(name)
        except ModuleNotFoundError as exc:
            if exc.name in (name, name.split(".")[0]):
                # Simply not there (yet): cheap to ask again, and an install
                # can still put it there.
                return f"{name}: {exc}"
            return remember_failure(name, exc)
        except Exception as exc:
            return remember_failure(name, exc)
    return None


def status() -> dict:
    installed = ensure_on_path()
    package_error = _activation_error or _package_error()
    interpreter = _python_that_can_install()
    with _lock:
        approx_total = int(APPROX_DOWNLOAD_GB * 1000 ** 3)
        downloaded = _state["downloaded_bytes"] + _state["current_bytes"]
        # What has actually been obtained, from wherever. An install served
        # from pip's cache transfers nothing and is still making progress; a
        # bar that reads 0% throughout is the reason this is separate.
        obtained = downloaded + _state["cached_bytes"]
        current_total = _state["current_total"]
        speed = _speed_bytes_per_second()
        return {
            "status": _state["status"],
            "messages": list(_state["messages"])[-40:],
            # A package that is present and will not load is an error worth
            # showing; a directory with nothing in it yet is not.
            "error": _state["error"] or _activation_error or (package_error if installed else None),
            "installed": package_error is None,
            "directory": packages_dir() if installed else None,
            "approx_download_gb": APPROX_DOWNLOAD_GB,
            "can_install": interpreter is not None,
            "blocker": None if interpreter else _NO_INTERPRETER,
            # What pip actually counted. The file figures are exact; the one
            # for the whole install is measured against a size that was right
            # on one machine, so it is named an estimate and never shown at
            # 100% while work is still going on.
            "downloaded_bytes": downloaded,
            #: Counted towards progress but never called a download.
            "cached_bytes": _state["cached_bytes"],
            "obtained_bytes": obtained,
            "approx_total_bytes": approx_total,
            "approx_percent": (
                min(99, int(obtained * 100 / approx_total))
                if approx_total and _state["status"] == "running" else
                (100 if _state["status"] == "done" else 0)
            ),
            "current_name": (
                "Installing the downloaded packages - %dm %02ds so far. This step has no "
                "percentage and can take 10-20 minutes; it is still working."
                % divmod(int(time.time() - _state["installing_since"]), 60)
                if _state.get("installing_since") and _state["status"] == "running"
                else _state["current_name"]
            ),
            "current_bytes": _state["current_bytes"],
            "current_total": current_total,
            "current_percent": (
                int(_state["current_bytes"] * 100 / current_total)
                if current_total else None
            ),
            # None, not 0. The panel shows "measuring" rather than a speed of
            # zero, which reads as a download that has stopped.
            "bytes_per_second": speed,
            # Only against the current file, whose size pip actually reported.
            # An ETA for the whole install would be measured against
            # APPROX_DOWNLOAD_GB, which is one machine's figure, and a wrong
            # number of minutes is worse than none.
            "current_eta_seconds": (
                int((current_total - _state["current_bytes"]) / speed)
                if speed and current_total and current_total > _state["current_bytes"]
                else None
            ),
            # Which part of the work this is. Model weights download later and
            # separately, and are deliberately not folded into these numbers.
            "phase": _state["phase"],
            "restart_required": _state["restart_required"],
            "cancellable": _state["status"] == "running",
            "free_space_gb": (
                round(free, 1) if (free := free_space_gb(packages_dir())) is not None else None
            ),
            "required_free_gb": REQUIRED_FREE_GB,
        }


def _run(on_message: Optional[Callable[[str], None]] = None) -> None:
    try:
        _install(on_message)
    except Exception as exc:
        logger.exception("Video package installation failed")
        with _lock:
            _state.update(status="failed", error=str(exc))


def _install(on_message: Optional[Callable[[str], None]] = None) -> None:
    def note(text: str) -> None:
        with _lock:
            _state["messages"].append(text)
            # After the downloads pip unpacks everything - PyTorch alone is
            # thousands of files - and prints nothing until it is done. The
            # bar sat at 85% for many minutes and read as a hang; the step is
            # now named, with the time it has been running (status()).
            if text.startswith("Installing collected packages"):
                _state["installing_since"] = time.time()
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
    # Noted before anything changes: which of these packages this process has
    # already imported. A module in sys.modules stays there, so after the
    # install these names still refer to the old copy however sys.path is
    # arranged, and any check that imports them is testing the wrong thing.
    already_loaded = sorted(
        name for name in ("torch", "torchvision", "diffusers", "transformers",
                          "accelerate", "sentencepiece")
        if name in sys.modules
    )
    if already_loaded:
        logger.info("Already imported here, so a restart will be needed: %s",
                    ", ".join(already_loaded))

    target = staging_dir()

    # Asked before anything is downloaded. Running out of room four gigabytes
    # in leaves a half-written directory and an error from deep inside pip
    # that says nothing about disk space.
    free = free_space_gb(target)
    if free is not None and free < REQUIRED_FREE_GB:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = (
                "Not enough disk space. About %.0f GB is needed to download and "
                "unpack these packages, and %.1f GB is free on this drive. "
                "Free some space and try again." % (REQUIRED_FREE_GB, free)
            )
        return

    try:
        if os.path.exists(target):
            shutil.rmtree(target)
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

    # Published so cancel() can stop the download itself. Without a handle the
    # best a cancel could do was set a flag while pip carried on to the end.
    global _process
    with _lock:
        _process = process
        _state["phase"] = "packages"

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
                # Sampled here rather than on a timer, because this is the
                # only place a real byte count arrives.
                _record_progress(_state["downloaded_bytes"] + _state["current_bytes"])
            continue

        cached = _CACHED.match(text)
        if cached:
            try:
                size = float(cached.group(2)) * _UNIT_BYTES.get(cached.group(3), 1)
            except ValueError:
                size = 0
            with _lock:
                _state["cached_bytes"] += int(size)
            note("Using cached %s" % cached.group(1)[:120])
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
                _state["downloaded_bytes"] += _state["current_bytes"]
                _state["current_name"] = started.group(1)
                _state["current_bytes"] = 0
                _state["current_total"] = 0

        # The panel still shows only progress, so it does not become a log
        # dump while things are going well.
        if text.startswith(("Collecting", "Downloading", "Installing", "Successfully", "ERROR")):
            note(text[:180])

    process.wait()

    with _lock:
        _process = None

    # A cancelled install is not a failed one, and its half-written staging
    # directory is not a finished one. It is removed here rather than left to
    # confuse the next run, which checks only for the completion marker.
    if _cancelled.is_set():
        note("Cancelled. Nothing was changed.")
        _discard_later(target)
        with _lock:
            _state["status"] = "cancelled"
            _state["error"] = None
            _state["phase"] = None
            _state["current_name"] = None
        return

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

    # The import check below can only speak for this process, and this process
    # may already hold an older copy of these packages from somewhere else.
    # Putting the new directory on sys.path does not dislodge a module that is
    # already in sys.modules, so the check would import the freshly installed
    # torchvision against the torch that was loaded at startup and report the
    # mismatch as a failed install.
    #
    # That is exactly what happened on a real 4.76 GB install: pip finished,
    # every file was in place, and the panel said "could not be loaded:
    # torchvision: operator torchvision::nms does not exist". The install had
    # worked. The verification had not.
    #
    # So when a copy was already loaded, the answer is that it is installed and
    # needs a restart - which is true, and which the user can act on.
    if already_loaded:
        note("Installed. An older copy is loaded in this session, so restart "
             "SMARAN.AI to use the new one.")
        with _lock:
            _state["status"] = "done"
            _state["restart_required"] = True
            _state["error"] = None
            _state["phase"] = None
        return

    package_error = _package_error()
    if package_error:
        with _lock:
            _state["status"] = "failed"
            _state["error"] = (
                "The packages installed but could not be loaded: %s. "
                "Restart SMARAN.AI before trying again." % package_error
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
        if os.path.isfile(os.path.join(staging_dir(), COMPLETE_MARKER)):
            _state.update(status="done", restart_required=True, error=None)
            return {"started": False, "detail": "Packages are ready. Restart SMARAN.AI to activate them."}
        _cancelled.clear()
        _state.update(status="running", messages=[], error=None,
                      downloaded_bytes=0, current_name=None, current_bytes=0,
                      current_total=0, restart_required=False, cached_bytes=0,
                      phase="packages", started_at=time.time(), samples=[],
                      installing_since=None)

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True, "detail": "Installing. Watch /api/video/install for progress."}


def cancel() -> dict:
    """Stop a running install and leave nothing behind.

    Stopping the pip process is the point: setting a flag and waiting would
    let the remaining gigabytes arrive anyway, which is not what anyone who
    presses cancel is asking for. Nothing that was already installed is
    touched - the work happens in a staging directory, and cancelling removes
    that directory rather than the copy in use.
    """
    with _lock:
        if _state["status"] != "running":
            return {"cancelled": False, "detail": "No install is running."}
        process = _process
        _cancelled.set()

    if process is not None:
        try:
            process.terminate()
        except Exception:                                # noqa: BLE001
            pass
        try:
            process.wait(timeout=10)
        except Exception:                                # noqa: BLE001
            # It did not go quietly. pip spawns children for its own
            # downloads, and a terminate that is ignored has to be followed.
            try:
                process.kill()
            except Exception:                            # noqa: BLE001
                pass

    return {"cancelled": True, "detail": "Stopping. Nothing already installed is affected."}
