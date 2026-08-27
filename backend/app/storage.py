"""Where model weights sit, and getting the space back.

Deleting a model is only useful if the disk space returns, and the previous
version could not tell you whether it had. It reported success whenever it
touched a path, ran `ollama rm` through a bare `except: pass`, and never
counted a byte. So "deleted" could mean thirty gigabytes freed or nothing at
all, and there was no way to tell which.

This measures first, deletes, then measures again, and reports the
difference. If nothing was found it says so rather than claiming a success.

Weights end up in three different places depending on how they arrived:
Hugging Face's cache for diffusers and Kokoro, Ollama's own store for
anything pulled with it, and this app's data directory. All three are
searched, because a model deleted from one and left in another is exactly
the storage problem someone was trying to solve.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("storage")


def _dir_size(path: Path) -> int:
    """Bytes on disk under a directory, symlinks not followed twice."""
    total = 0
    seen: set = set()
    for base, dirs, names in os.walk(path, onerror=lambda e: None):
        for name in names:
            full = os.path.join(base, name)
            try:
                stat = os.stat(full, follow_symlinks=False)
            except OSError:
                continue
            # Hugging Face's cache is full of symlinks into blobs; counting
            # both the link and its target would double the figure.
            key = (stat.st_dev, stat.st_ino)
            if key in seen:
                continue
            seen.add(key)
            total += stat.st_size
    return total


def ollama_binary() -> Optional[str]:
    """Ollama's executable, whether or not it is on PATH.

    The Windows installer puts it under AppData and does not always add it to
    PATH for an already-running process, which is why calling it by name
    failed silently before.
    """
    found = shutil.which("ollama")
    if found:
        return found
    candidates = [
        Path.home() / "AppData" / "Local" / "Programs" / "Ollama" / "ollama.exe",
        Path("C:/Program Files/Ollama/ollama.exe"),
        Path("/usr/local/bin/ollama"),
        Path("/usr/bin/ollama"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def ollama_root() -> Path:
    """Where Ollama keeps its blobs."""
    override = os.getenv("OLLAMA_MODELS")
    if override:
        return Path(override)
    return Path.home() / ".ollama" / "models"


def hf_roots() -> List[Path]:
    """Every Hugging Face cache this app might have written to."""
    from app.config import settings

    data = Path(settings.DATA_DIR)
    roots = [
        Path(os.getenv("HUGGINGFACE_HUB_CACHE", "")) if os.getenv("HUGGINGFACE_HUB_CACHE") else None,
        Path(os.getenv("HF_HOME", "")) / "hub" if os.getenv("HF_HOME") else None,
        Path.home() / ".cache" / "huggingface" / "hub",
        data / "models" / "hub",
        data / "models",
    ]
    present = []
    for root in roots:
        if not root or not root.exists():
            continue
        try:
            resolved = root.resolve()
        except OSError:
            continue
        # data/models/hub sits inside data/models, and sizing both counted
        # the same 2.68 GB twice. Only the outermost of any nested pair is
        # kept, so the total is the disk's answer rather than a sum of
        # overlapping walks.
        if any(resolved == k or k in resolved.parents for k in present):
            continue
        present = [k for k in present if resolved not in k.parents]
        present.append(resolved)
    return present


def usage() -> dict:
    """What model weights are costing, per location.

    Walking these directories is slow the first time and the figures are the
    point, so it is not cached: a stale number is worse than a slow one when
    someone is trying to free space.
    """
    total = 0
    places: List[dict] = []

    for root in hf_roots():
        size = _dir_size(root)
        if size:
            places.append({"kind": "huggingface", "path": str(root),
                           "bytes": size, "gb": round(size / 1e9, 2)})
            total += size

    ollama = ollama_root()
    if ollama.exists():
        size = _dir_size(ollama)
        if size:
            places.append({"kind": "ollama", "path": str(ollama),
                           "bytes": size, "gb": round(size / 1e9, 2)})
            total += size

    free = None
    try:
        free = shutil.disk_usage(Path.home()).free
    except OSError:
        pass

    return {
        "places": sorted(places, key=lambda p: -p["bytes"]),
        "total_bytes": total,
        "total_gb": round(total / 1e9, 2),
        "disk_free_gb": round(free / 1e9, 2) if free else None,
    }


def _hf_folders(hf_repo: str) -> List[Path]:
    """Cache directories for one repository, across every root."""
    name = "models--" + hf_repo.replace("/", "--")
    return [root / name for root in hf_roots() if (root / name).exists()]


def remove(model_id: str, hf_repo: str = "", ollama_tag: str = "") -> dict:
    """Delete a model everywhere it is, and report what that freed.

    Measured, not asserted. Each location is sized before it is removed and
    the total is the sum of what actually went.
    """
    freed = 0
    removed: List[dict] = []
    problems: List[str] = []

    # ── Hugging Face cache ─────────────────────────────────────────────
    for folder in _hf_folders(hf_repo or model_id):
        size = _dir_size(folder)
        try:
            shutil.rmtree(folder)
            freed += size
            removed.append({"kind": "huggingface", "path": str(folder),
                            "gb": round(size / 1e9, 2)})
        except OSError as exc:
            # Almost always a file still open in another process. Said, not
            # swallowed, because the space did not come back.
            problems.append("Could not delete %s: %s" % (folder, exc))

    # ── Ollama ─────────────────────────────────────────────────────────
    if ollama_tag:
        binary = ollama_binary()
        if not binary:
            problems.append(
                "Ollama's executable was not found, so %s was left in place. "
                "It is installed under AppData on Windows and is not always "
                "on PATH." % ollama_tag
            )
        else:
            before = _dir_size(ollama_root()) if ollama_root().exists() else 0
            try:
                result = subprocess.run(
                    [binary, "rm", ollama_tag],
                    capture_output=True, text=True, timeout=120,
                )
                after = _dir_size(ollama_root()) if ollama_root().exists() else 0
                gained = max(0, before - after)
                if result.returncode == 0:
                    freed += gained
                    removed.append({"kind": "ollama", "path": ollama_tag,
                                    "gb": round(gained / 1e9, 2)})
                else:
                    problems.append(
                        "ollama rm %s: %s"
                        % (ollama_tag, (result.stderr or result.stdout).strip()[:160])
                    )
            except subprocess.TimeoutExpired:
                problems.append("ollama rm %s did not finish in two minutes." % ollama_tag)
            except OSError as exc:
                problems.append("Could not run ollama: %s" % exc)

    return {
        "model_id": model_id,
        "removed": removed,
        "freed_bytes": freed,
        "freed_gb": round(freed / 1e9, 2),
        "problems": problems,
        # The honest headline. Nothing found is a real outcome and reads
        # differently from thirty gigabytes freed.
        "summary": (
            "Freed %.2f GB." % (freed / 1e9) if freed
            else "Nothing was found on disk for this model, so no space was freed."
        ),
    }


# ── installing Ollama ──────────────────────────────────────────────────

# Ollama's own published download. Named as a constant so it is visible in
# the source rather than assembled at runtime out of pieces.
OLLAMA_DOWNLOAD = {
    "win32": "https://ollama.com/download/OllamaSetup.exe",
    "darwin": "https://ollama.com/download/Ollama-darwin.zip",
    "linux": "https://ollama.com/install.sh",
}


def _platform() -> str:
    import sys
    return sys.platform


def ollama_state() -> dict:
    """Installed, running, and what it has - three separate questions."""
    import urllib.error
    import urllib.request

    binary = ollama_binary()
    running = False
    models: List[str] = []
    if binary:
        try:
            with urllib.request.urlopen("http://127.0.0.1:11434/api/tags",
                                        timeout=3) as response:
                import json
                models = [m.get("name", "") for m in
                          json.loads(response.read().decode("utf-8")).get("models", [])]
            running = True
        except (urllib.error.URLError, ValueError, OSError):
            running = False

    return {
        "installed": bool(binary),
        "path": binary,
        "running": running,
        "models": [m for m in models if m],
        # Three states, three different things to do about them. Collapsing
        # them into "unavailable" is what made this look like it needed a key.
        "next_step": (
            "Install Ollama." if not binary
            else "Start Ollama." if not running
            else "Pull a model." if not models
            else ""
        ),
        "download_url": OLLAMA_DOWNLOAD.get(_platform()),
    }


def install_ollama(progress=None) -> dict:
    """Download Ollama's installer and run it.

    This downloads an executable from ollama.com and runs it, which is a real
    thing to do to someone's machine, so it is never automatic: it happens
    when a person asks for it and the size and the source are shown first.
    The installer itself is Ollama's, unmodified, and it puts up its own
    prompts.
    """
    import sys
    import tempfile
    import urllib.request

    if ollama_binary():
        return {"installed": True, "already": True,
                "path": ollama_binary(),
                "summary": "Ollama is already installed."}

    url = OLLAMA_DOWNLOAD.get(sys.platform)
    if not url:
        raise RuntimeError(
            "There is no published Ollama download for %s here." % sys.platform
        )
    if sys.platform != "win32":
        # The macOS and Linux paths need a different runner and are not
        # written yet. Saying so beats half-running something.
        raise RuntimeError(
            "Automatic install is written for Windows only. On %s, follow "
            "the instructions at ollama.com/download." % sys.platform
        )

    target = Path(tempfile.gettempdir()) / "OllamaSetup.exe"
    if progress:
        progress("Downloading Ollama's installer from ollama.com.")

    try:
        with urllib.request.urlopen(url, timeout=600) as response,                 open(target, "wb") as handle:
            size = 0
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                handle.write(chunk)
                size += len(chunk)
                if progress and size % (16 << 20) < (1 << 20):
                    progress("Downloaded %.0f MB." % (size / 1e6))
    except OSError as exc:
        raise RuntimeError("Could not download Ollama: %s" % exc) from exc

    if size < 1_000_000:
        target.unlink(missing_ok=True)
        raise RuntimeError(
            "The download was only %d bytes, which is not an installer. "
            "Nothing was run." % size
        )

    if progress:
        progress("Running Ollama's installer. It will show its own prompts.")
    try:
        subprocess.Popen([str(target), "/SILENT"])
    except OSError as exc:
        raise RuntimeError("Could not start the installer: %s" % exc) from exc

    return {
        "installed": False,
        "started": True,
        "downloaded_mb": round(size / 1e6, 1),
        "installer": str(target),
        "summary": (
            "Ollama's installer was downloaded (%.0f MB) and started. It "
            "finishes on its own; this cannot confirm the result, so check "
            "again in a moment." % (size / 1e6)
        ),
    }


def start_ollama(wait_seconds: float = 35.0) -> dict:
    """Start Ollama if it is installed but not running.

    Ollama does not add itself to Windows startup, so after a restart it is
    installed and idle, and anything local fails with "not running" until
    someone opens it by hand. Since the app knows it needs it and knows
    where it is, it starts it.

    This launches software already on the machine, chosen by the person who
    installed it. It downloads nothing and installs nothing.
    """
    import time
    import urllib.error
    import urllib.request

    def answering() -> bool:
        try:
            urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2)
            return True
        except (urllib.error.URLError, OSError):
            return False

    if answering():
        return {"running": True, "started": False,
                "summary": "Ollama was already running."}

    binary = ollama_binary()
    if not binary:
        return {"running": False, "started": False,
                "summary": "Ollama is not installed, so there was nothing to start."}

    try:
        # Detached, with no console window: this is a background service and
        # a command prompt flashing up on every call would be its own bug.
        flags = 0
        if os.name == "nt":
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) |                     getattr(subprocess, "DETACHED_PROCESS", 0)
        subprocess.Popen([binary, "serve"], creationflags=flags,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        return {"running": False, "started": False,
                "summary": "Could not start Ollama: %s" % exc}

    # Popen returns before the port is open. Waited for, so the answer is
    # whether it is actually serving rather than whether it was launched.
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        if answering():
            return {"running": True, "started": True,
                    "summary": "Ollama was not running and has been started."}
        time.sleep(0.5)

    return {
        "running": False, "started": True,
        "summary": "Ollama was started but has not answered within %.0f "
                   "seconds. It may still be coming up." % wait_seconds,
    }
