"""Using the graphics card for speech, when it can actually be used.

Transcription on the processor costs about three seconds a go on this machine.
On a graphics card it is a fraction of that, and the card is usually sitting
idle. So the card should be used - but only when it really can be, and the
difference between "there is a card" and "the card can be driven" is the whole
of this module.

WHAT WENT WRONG BEFORE

    ctranslate2.get_cuda_device_count()  ->  1

That looks like a yes. It is not. It reports the hardware, not whether the
libraries needed to run on it are installed. Asking for a model on the card
then fails with

    RuntimeError: Library cublas64_12.dll is not found or cannot be loaded

CTranslate2 loads its CUDA libraries at run time rather than linking them, so
the card is reachable only if cuBLAS and cuDNN are present. They are a few
hundred megabytes and this app does not ship them.

WHY BOTH PATH AND add_dll_directory

Since Python 3.8, Windows no longer searches PATH for the dependencies of an
extension module, so a directory has to be registered with os.add_dll_directory.
This module did only that, and it was not enough: with all three directories
registered, before any import, CTranslate2 still answered

    RuntimeError: Library cublas64_12.dll is not found or cannot be loaded

with the file sitting in one of them. add_dll_directory only affects loads that
ask for user directories. CTranslate2 does not link cuBLAS - it loads it at run
time by name, an ordinary load, and an ordinary load searches PATH. Adding the
same directories to PATH as well turned that error into a working transcription
on the first try.

Both, then: add_dll_directory for anything resolved at load time, PATH for the
ones CTranslate2 asks for itself. And before ctranslate2 is imported either way -
after that the loader has already looked and failed, which is why installing the
libraries and restarting the app is not optional.

HOW THIS DECIDES

By trying. Loading the smallest model on the card either works or raises, and
that answer is kept. Nothing here reports a capability it has not exercised.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

#: Where the CUDA wheels are installed to, beside the app's own data. Kept out
#: of the program folder so an update cannot delete them and so no
#: administrator rights are needed to put them there.
def cuda_root() -> str:
    from app.config import settings

    return os.path.join(settings.DATA_DIR, "cuda")


#: The two wheels that carry the libraries CTranslate2 asks for. cuDNN 9,
#: because ctranslate2 4.5 and newer want 9 rather than 8.
CUDA_PACKAGES = ("nvidia-cublas-cu12", "nvidia-cudnn-cu12")

#: Roughly what will be downloaded, so the interface can say so before
#: starting. Measured rather than guessed: cuDNN is a 732 MB wheel, nvrtc
#: another 76 MB, and cuBLAS the rest.
APPROX_DOWNLOAD_MB = 820

#: And what it costs on disk, which is not the same number and is the one
#: somebody with a full drive needs. The wheels unpack to roughly two and a
#: half times their download size.
APPROX_DISK_MB = 2000

_registered = False
#: Whether an NVIDIA card was seen at all - which is not the same question
#: as whether it can be used, and needs its own answer. Without it the
#: interface offered an 820 MB download to machines with no NVIDIA card,
#: where it could not have helped.
_has_card: Optional[bool] = None
_verdict: Optional[Tuple[bool, str]] = None


def register_libraries() -> bool:
    """Make the installed CUDA libraries findable. True if any were added.

    Must run before anything imports ctranslate2. Calling it twice is
    harmless; the directories are only added once.
    """
    global _registered
    if _registered:
        return True
    if sys.platform != "win32":
        # Linux resolves these through the loader's own search path, and the
        # wheels put their .so files where it looks.
        _registered = True
        return True

    added = False
    folders = []
    for base in (cuda_root(), os.path.join(sys.prefix, "Lib", "site-packages")):
        nvidia = os.path.join(base, "nvidia")
        if not os.path.isdir(nvidia):
            continue
        for library in os.listdir(nvidia):
            folder = os.path.join(nvidia, library, "bin")
            if os.path.isdir(folder):
                folders.append(folder)
                try:
                    os.add_dll_directory(folder)
                    added = True
                except OSError as exc:  # noqa: PERF203 - one bad folder is not fatal
                    logger.info("Could not register %s: %s", folder, exc)

    # PATH as well. See the note at the top: this is the half that
    # CTranslate2 actually reads, and without it the card stayed
    # unreachable with every directory correctly registered.
    if folders:
        existing = os.environ.get("PATH", "")
        missing = [f for f in folders if f not in existing.split(os.pathsep)]
        if missing:
            os.environ["PATH"] = os.pathsep.join(missing + [existing])
        added = True

    _registered = True
    return added


def installed() -> bool:
    """Whether the CUDA libraries are on this machine at all."""
    for base in (cuda_root(), os.path.join(sys.prefix, "Lib", "site-packages")):
        if os.path.isdir(os.path.join(base, "nvidia", "cublas")):
            return True
    return False


def usable(force: bool = False) -> Tuple[bool, str]:
    """Can a model actually run on the card? Answered by trying it.

    Returns (yes, why). The reason is written to be shown to somebody, so it
    says what to do rather than quoting a linker.
    """
    global _verdict
    if _verdict is not None and not force:
        return _verdict

    register_libraries()
    try:
        import ctranslate2
    except Exception as exc:  # noqa: BLE001
        _verdict = (False, "The speech engine could not be loaded: %s" % exc)
        return _verdict

    global _has_card
    try:
        _has_card = ctranslate2.get_cuda_device_count() >= 1
        if not _has_card:
            _verdict = (False, "No NVIDIA graphics card was found, so speech runs "
                               "on the processor.")
            return _verdict
    except Exception as exc:  # noqa: BLE001
        _has_card = False
        _verdict = (False, "The graphics card could not be checked: %s" % exc)
        return _verdict

    # The only honest test, and it has to go all the way to a transcription.
    #
    # Constructing the model on the card succeeds even when cuBLAS is missing -
    # that only allocates. The library is not touched until something is
    # actually decoded, and that is where it fails:
    #
    #     constructing the model on the card : WORKED
    #     actually transcribing on the card  : FAILED, cublas64_12.dll not found
    #
    # An earlier version of this stopped at the constructor and reported the
    # card as usable on a machine where every transcription would then have
    # failed. So a second of silence is decoded here, which costs little and
    # answers the real question.
    try:
        import numpy
        from faster_whisper import WhisperModel

        from app.config import settings

        probe = WhisperModel(
            "tiny.en",
            device="cuda",
            compute_type="float16",
            download_root=os.path.join(settings.DATA_DIR, "models", "faster-whisper"),
        )
        segments, _info = probe.transcribe(
            numpy.zeros(16000, dtype=numpy.float32), language="en", beam_size=1)
        list(segments)
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "cublas" in message.lower() or "cudnn" in message.lower():
            _verdict = (False,
                        "The graphics card is here but its CUDA libraries are not, "
                        "so speech runs on the processor. Installing them downloads "
                        "about %d MB and uses about %.1f GB on disk."
                        % (APPROX_DOWNLOAD_MB, APPROX_DISK_MB / 1000))
        else:
            _verdict = (False, "The graphics card could not be used: %s" % message[:200])
        return _verdict

    _verdict = (True, "Speech runs on the graphics card.")
    return _verdict


def device_and_compute() -> Tuple[str, str]:
    """What to hand WhisperModel, decided once and remembered."""
    yes, _why = usable()
    if yes:
        # float16 on the card. int8 would be smaller but the card has the room
        # and float16 is both faster and more accurate here.
        return "cuda", "float16"
    return "cpu", "int8"


# ---------------------------------------------------------------------------
# Installing the libraries
#
# Same shape as the video-package installer: a thread that outlives the
# request, progress the page can ask about, and pip's own words kept when it
# fails rather than a code and a shrug.
# ---------------------------------------------------------------------------

import subprocess
import threading

_lock = threading.Lock()
_state = {"status": "idle", "lines": [], "error": None}


def status() -> dict:
    # Ask, rather than report whatever happened to have been asked before.
    # Without this the first call says "not checked" and the interface has
    # nothing to show until something else happens to load a model.
    yes, why = usable()
    with _lock:
        return {
            "status": _state["status"],
            "lines": list(_state["lines"])[-12:],
            "error": _state["error"],
            "installed": installed(),
            # Said separately, because "there is a card" and "the card can
            # be driven" are different questions and only the first one
            # decides whether offering the download makes any sense.
            "has_card": bool(_has_card),
            "in_use": bool(yes),
            "detail": why,
            "approx_mb": APPROX_DOWNLOAD_MB,
            "approx_disk_mb": APPROX_DISK_MB,
        }


def _note(line: str) -> None:
    with _lock:
        _state["lines"].append(line)


def _install() -> None:
    global _verdict

    with _lock:
        _state.update({"status": "installing", "lines": [], "error": None})

    target = cuda_root()
    os.makedirs(target, exist_ok=True)
    _note("Installing into %s" % target)
    _note("About %d MB will be downloaded, using about %.1f GB on disk."
          % (APPROX_DOWNLOAD_MB, APPROX_DISK_MB / 1000))

    command = [sys.executable, "-m", "pip", "install", "--target", target,
               "--upgrade", *CUDA_PACKAGES]
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, bufsize=1)
    except OSError as exc:
        with _lock:
            _state.update({"status": "failed", "error": "Could not start pip: %s" % exc})
        return

    tail = []
    for line in process.stdout or []:
        text = line.rstrip()
        if not text:
            continue
        tail.append(text)
        if len(tail) > 60:
            del tail[0]
        if text.startswith(("Collecting", "Downloading", "Installing", "Successfully", "ERROR")):
            _note(text[:180])
    process.wait()

    if process.returncode != 0:
        blamed = [t for t in tail if any(m in t.lower() for m in
                  ("error", "could not", "no matching", "failed", "denied"))]
        reason = chr(10).join((blamed or tail)[-6:])[:900]
        with _lock:
            _state.update({"status": "failed",
                           "error": "pip exited with code %s.%s"
                                    % (process.returncode,
                                       (chr(10) * 2 + reason) if reason else "")})
        return

    # The libraries are here, but this process imported ctranslate2 long ago
    # and the loader has already looked. Saying so is the honest end of this:
    # a restart is not a suggestion, it is the requirement.
    _verdict = None
    with _lock:
        _state.update({"status": "done", "error": None})
    _note("Installed. Restart SMARAN.AI to use the graphics card - Windows "
          "decides where to look for these libraries when the program starts, "
          "so a running one cannot pick them up.")


def start_install() -> dict:
    with _lock:
        if _state["status"] == "installing":
            return {"started": False, "detail": "It is already installing."}
    threading.Thread(target=_install, name="cuda-install", daemon=True).start()
    return {"started": True}
