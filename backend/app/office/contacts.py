"""Names to numbers, so a name is enough.

Saying "message Riya" only works if something knows who Riya is. WhatsApp
does not hand its contact list to other applications — no third-party app can
read it — so this keeps its own small book: a name, a number, and nothing
else. It lives in a JSON file beside the rest of the app's data and never
leaves the machine.

The rule that matters is that a name resolves to exactly one person or to
nobody. A message meant for one person going to a list is the failure this
whole design exists to prevent, so an ambiguous name is refused with the
candidates rather than resolved to a best guess.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from typing import Dict, List, Optional

logger = logging.getLogger("contacts")

_lock = threading.Lock()


class ContactError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def _path() -> str:
    from app.config import settings

    os.makedirs(settings.DATA_DIR, exist_ok=True)
    return os.path.join(settings.DATA_DIR, "contacts.json")


def _load() -> Dict[str, dict]:
    try:
        with open(_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def _save(book: Dict[str, dict]) -> None:
    # Written whole then moved, so an interrupted save cannot leave the book
    # truncated - losing someone's number silently is worse than not saving.
    target = _path()
    temp = target + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(book, handle, indent=2, ensure_ascii=False)
    os.replace(temp, target)


def _key(name: str) -> str:
    """Names are matched case- and space-insensitively."""
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _clean_number(number: str) -> str:
    digits = re.sub(r"\D", "", number or "")
    if len(digits) < 8:
        raise ContactError(
            "%r is not a full number. Include the country code, for example "
            "919876543210." % number
        )
    return digits


def add(name: str, number: str, is_self: bool = False) -> dict:
    """Remember one person. Replaces an existing entry with the same name."""
    clean = (name or "").strip()
    if not clean:
        raise ContactError("A name is needed.")
    digits = _clean_number(number)

    with _lock:
        book = _load()
        if is_self:
            # Only one person can be "you", or "message me" is ambiguous.
            for entry in book.values():
                entry["is_self"] = False
        book[_key(clean)] = {
            "name": clean, "number": digits, "is_self": bool(is_self),
        }
        _save(book)
    return {"name": clean, "number": digits, "is_self": bool(is_self)}


def remove(name: str) -> dict:
    with _lock:
        book = _load()
        entry = book.pop(_key(name), None)
        if not entry:
            raise ContactError("There is nobody called %r in the book." % name)
        _save(book)
    return {"removed": entry["name"]}


def everyone() -> List[dict]:
    return sorted(_load().values(), key=lambda e: e["name"].lower())


def myself() -> Optional[dict]:
    return next((e for e in _load().values() if e.get("is_self")), None)


def resolve(name: str) -> dict:
    """One person, or an error naming the alternatives.

    Exact match first, then a prefix or word match. Never a fuzzy guess:
    "Riya" resolving to "Priyanka" because the letters overlap is how a
    message reaches the wrong person.
    """
    query = _key(name)
    if not query:
        raise ContactError("No name was given.")

    book = _load()
    if not book:
        raise ContactError(
            "The contact book is empty. Add someone first, with their name "
            "and their number including the country code."
        )

    if query in book:
        return book[query]

    # "me", "myself" and "mujhe" all mean the entry marked as you.
    if query in ("me", "myself", "mujhe", "mujhko", "khud"):
        mine = myself()
        if mine:
            return mine
        raise ContactError(
            "No contact is marked as you. Add your own number and mark it as "
            "yourself, then 'message me' will work."
        )

    matches = [
        entry for key, entry in book.items()
        if key.startswith(query) or query in key.split()
    ]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ContactError(
            "Nobody in the book is called %r. Known: %s."
            % (name, ", ".join(e["name"] for e in everyone()) or "nobody yet")
        )
    raise ContactError(
        "%r matches %d people: %s. Say which one - a message goes to one "
        "person or to nobody."
        % (name, len(matches), ", ".join(e["name"] for e in matches))
    )
