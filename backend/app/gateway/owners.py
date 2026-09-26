"""Who may command SMARAN through a chat bot.

A Telegram or Discord bot can be messaged by anyone who finds it, and each
message runs the agent on this computer. So a bot answers only its owners.
Owners are added by pairing: SMARAN shows a six-digit code in Settings ->
Gateway & Bots, and whoever sends "/pair <code>" to the bot becomes an owner.
Wrong codes are limited (five per person, twenty in all, then a new code),
so the code cannot be guessed. Owners are kept in DATA_DIR/gateway_owners.json.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
from typing import Dict, List

_lock = threading.Lock()
PER_USER_TRIES = 5
TOTAL_TRIES = 20


def _path() -> str:
    from app.config import settings
    return os.path.join(settings.DATA_DIR, "gateway_owners.json")


def _load() -> Dict[str, List[str]]:
    try:
        with open(_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return {k: [str(x) for x in v] for k, v in data.items() if isinstance(v, list)}
    except (OSError, ValueError, AttributeError):
        return {}


def _save(data: Dict[str, List[str]]) -> None:
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    os.replace(tmp, _path())


class Pairing:
    def __init__(self, platform: str) -> None:
        self.platform = platform
        self.code = ""
        self._tries: Dict[str, int] = {}
        self._total = 0
        self.new_code()

    def new_code(self) -> str:
        self.code = f"{secrets.randbelow(10**6):06d}"
        self._tries.clear()
        self._total = 0
        return self.code

    def owners(self) -> List[str]:
        return _load().get(self.platform, [])

    def is_owner(self, user_id) -> bool:
        return str(user_id) in self.owners()

    def forget(self) -> None:
        with _lock:
            data = _load()
            data.pop(self.platform, None)
            _save(data)

    def try_pair(self, user_id, attempt: str) -> str:
        """'paired', 'wrong', or 'locked' (this person has used up their tries)."""
        user = str(user_id)
        if self._tries.get(user, 0) >= PER_USER_TRIES:
            return "locked"
        if secrets.compare_digest((attempt or "").strip(), self.code):
            with _lock:
                data = _load()
                data.setdefault(self.platform, [])
                if user not in data[self.platform]:
                    data[self.platform].append(user)
                _save(data)
            self.new_code()   # a code works once
            return "paired"
        self._tries[user] = self._tries.get(user, 0) + 1
        self._total += 1
        if self._total >= TOTAL_TRIES:
            self.new_code()   # too many guesses overall: the old code is dead
        return "wrong"


PRIVATE = ("This SMARAN bot is private. If it is yours, open SMARAN on your computer -> "
           "Settings -> Gateway & Bots, and send me: /pair <the 6-digit code shown there>")
