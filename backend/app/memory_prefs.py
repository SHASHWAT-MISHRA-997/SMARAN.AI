"""Settings -> Memory: the three switches, stored and enforced on the backend.

They used to be written to the browser's storage and read by nothing: chat
sent a different, single flag, so "Search and reference chats" off still
searched past chats, "Generate memory" off still saved facts, and sensitive
facts were saved whatever the switch said.

  search_chats     past conversations are searched for context
  generate         new facts are saved from what you say
  sensitive        facts about health, religion, sexuality, politics and
                   the like may be saved (off: they are skipped)
"""
from __future__ import annotations

import json
import os
import re
import threading
from typing import Dict

from app.config import settings

DEFAULTS = {"search_chats": True, "generate": True, "sensitive": False}
_lock = threading.Lock()

_SENSITIVE = re.compile(
    r"\b(diabet\w*|cancer|hiv|aids|depress\w*|anxiety|disorder|disease|illness|diagnos\w*|medicat\w*|therap\w*|"
    r"pregnan\w*|surgery|disabilit\w*|mental health|health condition|blood pressure|"
    r"religio\w*|hindu|muslim|islam|christian|sikh|jain|buddhis\w*|atheis\w*|caste|"
    r"gay|lesbian|bisexual|transgender|sexual\w*|"
    r"politic\w*|bjp|congress party|aap party|vote[sd]?|"
    r"salary|debt|loan|bank balance|income|"
    r"ethnic\w*|race|criminal record|arrest\w*)\b", re.I)


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "memory_prefs.json")


def load() -> Dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        saved = {}
    prefs = dict(DEFAULTS)
    prefs.update({k: bool(v) for k, v in saved.items() if k in DEFAULTS})
    return prefs


def save(update: Dict) -> Dict:
    prefs = load()
    prefs.update({k: bool(v) for k, v in update.items() if k in DEFAULTS and v is not None})
    with _lock:
        os.makedirs(os.path.dirname(_path()), exist_ok=True)
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(prefs, fh, indent=2)
        os.replace(tmp, _path())
    return prefs


def is_sensitive(fact: str) -> bool:
    return bool(_SENSITIVE.search(fact or ""))


def may_save(fact: str) -> bool:
    """Whether a new fact may be stored, under the owner's switches."""
    prefs = load()
    if not prefs["generate"]:
        return False
    return prefs["sensitive"] or not is_sensitive(fact)
