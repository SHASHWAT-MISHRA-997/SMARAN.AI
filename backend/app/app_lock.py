"""
Screen lock for the app.

A short PIN asked at launch, the way a phone asks before it shows you anything.
It is a privacy screen, not a vault: the point is that someone who walks up to
an unlocked machine cannot read the conversations.

Two properties matter and are enforced here:

* The PIN is never stored. Only a bcrypt hash is written, so reading the
  database does not reveal it.
* Guessing is rate limited. Without that, a four-digit PIN falls in seconds.

Be honest about the boundary: the chat database itself is not encrypted, so
this stops a person at the keyboard, not someone who copies the data file. That
is the same guarantee a phone lock screen gives on an unencrypted backup, and
it is what was asked for.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/lock", tags=["lock"])

# Attempt throttling. Five tries, then a cooling-off period that grows.
_MAX_ATTEMPTS = 5
_LOCKOUT_SECONDS = 60
_attempts: Dict[str, Dict[str, Any]] = {}

PIN_MIN = 4
PIN_MAX = 12


def _state_path() -> str:
    """Where the lock settings live: beside the database, not in the bundle."""
    data_dir = os.getenv("DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "data")
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, "app_lock.json")


def _load() -> Dict[str, Any]:
    try:
        with open(_state_path(), "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def _save(state: Dict[str, Any]) -> None:
    with open(_state_path(), "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)


def _hash(pin: str) -> str:
    from app.main import hash_password

    return hash_password(pin)


def _verify(pin: str, hashed: str) -> bool:
    from app.main import verify_password

    return verify_password(pin, hashed)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "local"


def _throttle(key: str) -> Optional[int]:
    """Seconds the caller must wait, or None when they may try."""
    entry = _attempts.get(key)
    if not entry:
        return None
    if entry["count"] < _MAX_ATTEMPTS:
        return None
    waited = time.time() - entry["last"]
    # Each further failed round doubles the wait, up to fifteen minutes.
    penalty = min(_LOCKOUT_SECONDS * (2 ** (entry["count"] - _MAX_ATTEMPTS)), 900)
    if waited >= penalty:
        return None
    return int(penalty - waited)


def _record_failure(key: str) -> None:
    entry = _attempts.setdefault(key, {"count": 0, "last": 0.0})
    entry["count"] += 1
    entry["last"] = time.time()


def _clear_failures(key: str) -> None:
    _attempts.pop(key, None)


class PinSet(BaseModel):
    pin: str = Field(..., min_length=PIN_MIN, max_length=PIN_MAX)
    # Required once a PIN exists, so an unlocked screen cannot be used to
    # silently change the lock.
    current_pin: Optional[str] = None


class PinCheck(BaseModel):
    pin: str = Field(..., min_length=1, max_length=PIN_MAX)


class PinReset(BaseModel):
    """Proving it is the account holder, not just whoever is sitting here."""
    email: str
    password: str
    new_pin: str = Field(..., min_length=PIN_MIN, max_length=PIN_MAX)


@router.get("/status")
def lock_status(request: Request):
    """Whether a PIN is set, and whether guessing is currently blocked."""
    state = _load()
    wait = _throttle(_client_key(request))
    return {
        "enabled": bool(state.get("pin_hash")),
        "configured_at": state.get("configured_at"),
        "locked_out_for": wait,
        "min_length": PIN_MIN,
        "max_length": PIN_MAX,
    }


@router.post("/set")
def set_pin(payload: PinSet, request: Request):
    """Create or change the PIN."""
    if not payload.pin.isdigit():
        raise HTTPException(status_code=400, detail="The PIN must be digits only.")

    state = _load()
    existing = state.get("pin_hash")
    if existing:
        if not payload.current_pin:
            raise HTTPException(status_code=400, detail="Enter your current PIN to change it.")
        wait = _throttle(_client_key(request))
        if wait:
            raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait} seconds.")
        if not _verify(payload.current_pin, existing):
            _record_failure(_client_key(request))
            raise HTTPException(status_code=401, detail="That is not your current PIN.")
        _clear_failures(_client_key(request))

    state["pin_hash"] = _hash(payload.pin)
    state["configured_at"] = datetime.now().isoformat(timespec="seconds")
    _save(state)
    return {"enabled": True, "message": "The app will ask for this PIN when it starts."}


@router.post("/verify")
def verify_pin(payload: PinCheck, request: Request):
    """Unlock the app."""
    state = _load()
    stored = state.get("pin_hash")
    if not stored:
        return {"unlocked": True, "message": "No PIN is set."}

    key = _client_key(request)
    wait = _throttle(key)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait} seconds.")

    if not _verify(payload.pin, stored):
        _record_failure(key)
        entry = _attempts.get(key, {})
        left = max(0, _MAX_ATTEMPTS - entry.get("count", 0))
        raise HTTPException(
            status_code=401,
            detail=f"Incorrect PIN. {left} attempt{'s' if left != 1 else ''} left before a pause."
            if left else "Incorrect PIN.",
        )

    _clear_failures(key)
    return {"unlocked": True}


@router.post("/disable")
def disable_pin(payload: PinCheck, request: Request):
    """Turn the lock off. The current PIN is required."""
    state = _load()
    stored = state.get("pin_hash")
    if not stored:
        return {"enabled": False, "message": "No PIN was set."}

    key = _client_key(request)
    wait = _throttle(key)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait} seconds.")
    if not _verify(payload.pin, stored):
        _record_failure(key)
        raise HTTPException(status_code=401, detail="That PIN is not correct.")

    _clear_failures(key)
    state.pop("pin_hash", None)
    state.pop("configured_at", None)
    _save(state)
    return {"enabled": False, "message": "The PIN lock is off."}


@router.post("/reset")
def reset_pin(payload: PinReset, request: Request):
    """Set a new PIN after proving the account password.

    Deliberately not a back door: without the account password this does
    nothing, so someone who finds the machine unlocked-but-PIN-locked
    cannot clear the lock. Equally deliberately, it involves nobody else -
    no email, no support address, no recovery service. The person who owns
    the account is the only one who can do this, and they can do it offline.

    Throttled on the same counter as PIN guesses, so it cannot be used to
    brute-force the password either.
    """
    if not payload.new_pin.isdigit():
        raise HTTPException(status_code=400, detail="The PIN must be digits only.")

    key = _client_key(request)
    wait = _throttle(key)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {wait} seconds.")

    # Imported here rather than at module load: app_lock is imported by
    # main during startup, and importing main back would be circular.
    from app.database import SessionLocal
    from app.main import verify_password
    from app.models import User

    identifier = (payload.email or '').strip().lower()
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(
            (User.email == identifier) | (User.username == identifier)
        ).first()

        # One message for a missing account and a wrong password, so this
        # cannot be used to find out which addresses have accounts.
        if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
            _record_failure(key)
            raise HTTPException(status_code=401, detail="That email and password do not match an account.")
    finally:
        db.close()

    _clear_failures(key)
    state = _load()
    state["pin_hash"] = _hash(payload.new_pin)
    state["configured_at"] = datetime.now().isoformat(timespec="seconds")
    _save(state)
    return {"enabled": True, "message": "Your PIN has been changed."}
