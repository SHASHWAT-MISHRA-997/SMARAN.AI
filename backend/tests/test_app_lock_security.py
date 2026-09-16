"""The screen lock, exercised without touching the owner's real PIN.

These five routes are the one group that must not be driven against the running
backend. /verify records a failed attempt keyed by the caller, and the caller
is loopback - the same key the owner's own app uses. Five wrong guesses from an
audit run would lock the owner out of their own application, which is not a
thing to do to someone while checking whether their lock works.

So the state file is redirected to a temporary path and the attempt counter is
cleared between cases. Only GET /api/lock/status is read live, which changes
nothing.

What is checked here is the security behaviour the module claims for itself:
the PIN is never stored, guessing is throttled, changing or removing the lock
needs the current PIN, and the password reset is not a back door.
"""

import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import app_lock  # noqa: E402

PIN = "482915"
WRONG = "000000"


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A lock whose state lives in tmp_path and whose counter starts empty."""
    state_file = tmp_path / "app_lock.json"
    monkeypatch.setattr(app_lock, "_state_path", lambda: str(state_file))
    monkeypatch.setattr(app_lock, "_attempts", {})

    app = FastAPI()
    app.include_router(app_lock.router)
    return TestClient(app)


@pytest.fixture
def locked(client):
    """A lock with PIN already set."""
    res = client.post("/api/lock/set", json={"pin": PIN})
    assert res.status_code == 200, res.text
    return client


# ---------------------------------------------------------------------------
# The PIN itself
# ---------------------------------------------------------------------------

def test_the_pin_is_never_written_down(locked, tmp_path):
    """The module's first stated property. Reading the file must not reveal it."""
    written = (tmp_path / "app_lock.json").read_text(encoding="utf-8")
    assert PIN not in written, "the PIN was stored in the clear"
    state = json.loads(written)
    assert state.get("pin_hash"), "no hash was stored at all"
    assert PIN not in state["pin_hash"]


def test_a_pin_must_be_digits(client):
    res = client.post("/api/lock/set", json={"pin": "abcd12"})
    assert res.status_code == 400


@pytest.mark.parametrize("pin", ["123", "1" * 13])
def test_a_pin_outside_the_stated_length_is_refused(client, pin):
    assert client.post("/api/lock/set", json={"pin": pin}).status_code == 422


def test_status_is_honest_before_and_after(client):
    assert client.get("/api/lock/status").json()["enabled"] is False
    client.post("/api/lock/set", json={"pin": PIN})
    body = client.get("/api/lock/status").json()
    assert body["enabled"] is True
    assert body["min_length"] == app_lock.PIN_MIN
    assert body["max_length"] == app_lock.PIN_MAX


# ---------------------------------------------------------------------------
# Unlocking
# ---------------------------------------------------------------------------

def test_the_right_pin_unlocks(locked):
    res = locked.post("/api/lock/verify", json={"pin": PIN})
    assert res.status_code == 200 and res.json()["unlocked"] is True


def test_the_wrong_pin_does_not(locked):
    res = locked.post("/api/lock/verify", json={"pin": WRONG})
    assert res.status_code == 401
    assert "unlocked" not in res.json()


def test_no_pin_set_means_no_lock(client):
    """Not a refusal: with nothing configured there is nothing to ask for."""
    res = client.post("/api/lock/verify", json={"pin": "anything"})
    assert res.status_code == 200 and res.json()["unlocked"] is True


# ---------------------------------------------------------------------------
# Throttling, which is what makes a short PIN survivable
# ---------------------------------------------------------------------------

def test_guessing_is_blocked_after_the_stated_number_of_attempts(locked):
    """A four-digit PIN falls in seconds without this."""
    for _ in range(app_lock._MAX_ATTEMPTS):
        assert locked.post("/api/lock/verify", json={"pin": WRONG}).status_code == 401

    res = locked.post("/api/lock/verify", json={"pin": WRONG})
    assert res.status_code == 429, "guessing was never throttled"
    assert "Try again" in res.json()["detail"]


def test_the_lockout_also_blocks_the_correct_pin(locked):
    """Otherwise the throttle is only an inconvenience to the wrong guesser."""
    for _ in range(app_lock._MAX_ATTEMPTS):
        locked.post("/api/lock/verify", json={"pin": WRONG})
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 429


def test_the_lockout_is_visible_in_status(locked):
    for _ in range(app_lock._MAX_ATTEMPTS):
        locked.post("/api/lock/verify", json={"pin": WRONG})
    assert locked.get("/api/lock/status").json()["locked_out_for"] > 0


def test_a_correct_pin_clears_the_count(locked):
    """Two wrong tries then a right one must not leave the owner near a lockout."""
    for _ in range(app_lock._MAX_ATTEMPTS - 1):
        locked.post("/api/lock/verify", json={"pin": WRONG})
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 200

    for _ in range(app_lock._MAX_ATTEMPTS - 1):
        assert locked.post("/api/lock/verify", json={"pin": WRONG}).status_code == 401


# ---------------------------------------------------------------------------
# Changing and removing the lock
# ---------------------------------------------------------------------------

def test_changing_the_pin_needs_the_current_one(locked):
    """An unlocked screen must not be usable to silently change the lock."""
    res = locked.post("/api/lock/set", json={"pin": "999999"})
    assert res.status_code == 400

    res = locked.post("/api/lock/set", json={"pin": "999999", "current_pin": WRONG})
    assert res.status_code == 401

    res = locked.post("/api/lock/set", json={"pin": "999999", "current_pin": PIN})
    assert res.status_code == 200
    assert locked.post("/api/lock/verify", json={"pin": "999999"}).status_code == 200
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 401


def test_turning_the_lock_off_needs_the_pin(locked):
    assert locked.post("/api/lock/disable", json={"pin": WRONG}).status_code == 401
    assert locked.get("/api/lock/status").json()["enabled"] is True

    assert locked.post("/api/lock/disable", json={"pin": PIN}).status_code == 200
    assert locked.get("/api/lock/status").json()["enabled"] is False


def test_a_wrong_pin_at_disable_counts_toward_the_lockout(locked):
    """Otherwise disable is an unthrottled oracle for guessing the PIN."""
    for _ in range(app_lock._MAX_ATTEMPTS):
        locked.post("/api/lock/disable", json={"pin": WRONG})
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 429


# ---------------------------------------------------------------------------
# Reset is deliberately not a back door
# ---------------------------------------------------------------------------

def test_reset_without_the_account_password_does_nothing(locked):
    res = locked.post("/api/lock/reset", json={
        "email": "nobody@smaran.ai", "password": "not-the-password",
        "new_pin": "111111"})
    assert res.status_code == 401
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 200


def test_reset_does_not_reveal_which_accounts_exist(locked):
    """The same failure this project already had on forgot-password."""
    missing = locked.post("/api/lock/reset", json={
        "email": "definitely-nobody@smaran.ai", "password": "x" * 12,
        "new_pin": "111111"})
    app_lock._attempts.clear()
    real = locked.post("/api/lock/reset", json={
        "email": "local@smaran.ai", "password": "x" * 12, "new_pin": "111111"})
    assert missing.status_code == real.status_code
    assert missing.json() == real.json()


def test_reset_is_throttled_on_the_same_counter_as_guesses(locked):
    """So it cannot be used to brute-force the password instead of the PIN."""
    for _ in range(app_lock._MAX_ATTEMPTS):
        locked.post("/api/lock/reset", json={
            "email": "nobody@smaran.ai", "password": "wrong",
            "new_pin": "111111"})
    res = locked.post("/api/lock/reset", json={
        "email": "nobody@smaran.ai", "password": "wrong", "new_pin": "111111"})
    assert res.status_code == 429


def test_reset_requires_a_digit_pin_like_every_other_route(locked):
    assert locked.post("/api/lock/reset", json={
        "email": "nobody@smaran.ai", "password": "x", "new_pin": "abcdef"
    }).status_code == 400
