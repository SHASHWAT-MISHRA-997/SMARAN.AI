"""Why local models are or are not usable, said plainly.

"unavailable" covered three different situations that need three different
actions: Ollama not installed, installed but not running, and running with
nothing pulled. Collapsing them into one word is why the app appeared to
require an API key — it quietly fell through to a cloud provider and never
mentioned that the local engine was one command away from working.
"""

from __future__ import annotations

import json
import logging
import shutil
import urllib.error
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

OLLAMA_URLS = (
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://host.docker.internal:11434",
    "http://ollama:11434",
)


def _tags(base: str, timeout: float = 2.5) -> Optional[dict]:
    try:
        with urllib.request.urlopen(base + "/api/tags", timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def _openai_served(timeout: float = 1.5) -> tuple[list, Optional[str]]:
    """Models being served right now by an OpenAI-compatible local server.

    Returns what was actually reported and the address it came from, or an
    empty list. Imported lazily because main imports this module.
    """
    try:
        from app.main import _openai_compatible_bases
    except Exception:
        return [], None

    for base in _openai_compatible_bases():
        try:
            with urllib.request.urlopen(base + "/models", timeout=timeout) as res:
                data = json.loads(res.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, OSError, ValueError):
            continue
        names = [m.get("id") for m in data.get("data", []) if m.get("id")]
        if names:
            return names, base
    return [], None


def status() -> dict:
    """The state of local inference, with the next step named.

    `state` is for code to branch on; `detail` and `fix` are written to be
    shown to a person. Nothing here guesses: each branch is reached only by
    having actually reached, or failed to reach, the service.
    """
    installed = shutil.which("ollama") is not None

    reachable, models = None, []
    for base in OLLAMA_URLS:
        data = _tags(base)
        if data is not None:
            reachable = base
            models = data.get("models") or []
            break

    # Ollama is not the only thing that runs models on this machine. LM Studio
    # and vLLM serve an OpenAI-compatible API, and someone using one of them
    # was told local inference was unavailable and to go and install Ollama -
    # while a model sat loaded and answering a few ports away. Asked only when
    # Ollama has nothing to offer, so nothing about the Ollama path changes.
    if not models:
        served, where = _openai_served()
        if served:
            return {
                "state": "ready",
                "url": where,
                "models": served,
                "detail": "%d local model%s available, served on %s."
                          % (len(served), "" if len(served) == 1 else "s", where),
                "fix": None,
            }

    if reachable and models:
        return {
            "state": "ready",
            "url": reachable,
            "models": [m.get("name") for m in models],
            "detail": "%d local model%s available."
                      % (len(models), "" if len(models) == 1 else "s"),
            "fix": None,
        }

    if reachable and not models:
        return {
            "state": "no_models",
            "url": reachable,
            "models": [],
            "detail": (
                "Ollama is running but no model has been downloaded, so there "
                "is nothing local to answer with."
            ),
            "fix": "Download one, for example: ollama pull qwen2.5-coder:3b",
        }

    if installed:
        return {
            "state": "not_running",
            "url": None,
            "models": [],
            "detail": (
                "Ollama is installed but is not running, so local models cannot "
                "be reached."
            ),
            "fix": "Start it: ollama serve",
        }

    return {
        "state": "not_installed",
        "url": None,
        "models": [],
        "detail": (
            "Ollama is not installed. It is what runs models on this machine; "
            "without it only cloud providers, which need your own key, can "
            "answer."
        ),
        "fix": "Install it from https://ollama.com/download",
    }
