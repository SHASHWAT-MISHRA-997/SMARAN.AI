"""Scoped control of the machine, and a way to stop it.

Desktop actions had no session and no stop. Once a multi-step task started
running, "stop" meant closing the app or killing the process, and a task that
was part-way through opening and typing into things would keep going while the
person who asked for it was trying to make it stop. That is the wrong shape for
software that clicks and types on somebody's computer.

A session is the unit that can be stopped. Actions taken inside one check
whether it is still running *immediately before* acting, so a stop lands between
steps rather than after the whole plan has run. It cannot interrupt a step
already in flight - nothing in-process can - so the guarantee this makes is the
honest one: no *further* step will be taken.

Deliberately not a security boundary. It stops work this application started; it
does not restrain anything already launched, and it is not a sandbox.
"""

from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Dict, List, Optional

# Sessions live in one process and are touched from request handlers and worker
# threads, so every read and write is under this lock. The critical sections are
# a few dictionary operations; contention is not a concern, and correctness
# under a stop arriving mid-task is the whole point.
_lock = threading.Lock()
_sessions: Dict[str, Dict[str, Any]] = {}

# Sessions are forgotten after this long, so a client that starts one and never
# stops it cannot make "is anything running" untrue for ever.
_MAX_AGE_SECONDS = 60 * 60


def _expire_locked(now: float) -> None:
    stale = [token for token, entry in _sessions.items()
             if now - entry["started"] > _MAX_AGE_SECONDS]
    for token in stale:
        _sessions.pop(token, None)


def begin(reason: str = "", *, actor: str = "user") -> str:
    """Open a control session and return its token.

    The token is generated with `secrets`, not a counter or a timestamp,
    because it is the thing that authorises further control of the machine and
    a guessable one would let anything that can reach the API drive it.
    """
    token = secrets.token_urlsafe(24)
    now = time.time()
    with _lock:
        _expire_locked(now)
        _sessions[token] = {
            "started": now,
            "reason": str(reason or "")[:200],
            "actor": str(actor or "user")[:60],
            "stopped": False,
            "stopped_at": None,
            "steps": 0,
        }
    return token


def is_running(token: Optional[str]) -> bool:
    """Whether work may proceed under this token.

    An empty token means "not part of a session" and is allowed, so ordinary
    single actions keep working exactly as before - this is a scope for
    multi-step control, not a new gate on everything.

    An *unknown* token is refused rather than allowed. A token that has expired
    or was never issued is not evidence of permission, and treating it as
    permission would make the stop control bypassable by inventing a token.
    """
    if not token:
        return True
    with _lock:
        entry = _sessions.get(token)
        if entry is None:
            return False
        return not entry["stopped"]


def note_step(token: Optional[str]) -> None:
    """Count a step taken, so a session can say what it has done."""
    if not token:
        return
    with _lock:
        entry = _sessions.get(token)
        if entry is not None:
            entry["steps"] += 1


def stop(token: Optional[str] = None) -> Dict[str, Any]:
    """Stop one session, or every session when given no token.

    Stopping something already stopped is not an error. A person pressing stop
    twice, or a client retrying, means the same thing both times, and reporting
    a failure for it would be noise at exactly the moment somebody wants to be
    sure it worked.
    """
    now = time.time()
    with _lock:
        if token:
            entry = _sessions.get(token)
            if entry is None:
                return {"stopped": 0, "known": False}
            if not entry["stopped"]:
                entry["stopped"] = True
                entry["stopped_at"] = now
            return {"stopped": 1, "known": True}

        count = 0
        for entry in _sessions.values():
            if not entry["stopped"]:
                entry["stopped"] = True
                entry["stopped_at"] = now
                count += 1
        return {"stopped": count, "known": True}


def active() -> List[Dict[str, Any]]:
    """Sessions still running, oldest first, without leaking their tokens.

    The token authorises control, so it is not included: this is for showing a
    person what is running, and a status panel is not a place to hand one out.
    """
    now = time.time()
    with _lock:
        _expire_locked(now)
        running = [
            {
                "reason": entry["reason"],
                "actor": entry["actor"],
                "started": entry["started"],
                "age_seconds": round(now - entry["started"], 1),
                "steps": entry["steps"],
            }
            for entry in _sessions.values()
            if not entry["stopped"]
        ]
    return sorted(running, key=lambda item: item["started"])


def reset_for_tests() -> None:
    """Clear every session. Test support only."""
    with _lock:
        _sessions.clear()
