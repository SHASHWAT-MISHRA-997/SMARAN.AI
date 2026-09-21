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
import secrets
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

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


@pytest.fixture
def signed_in(monkeypatch):
    """Mint a session token as though someone had signed in N minutes ago.

    Against a throwaway sqlite file, never the owner's database: these cases
    write user rows, and a test has no business doing that to real data.

    Only `session_expires` is stored against a session, so the age of a
    sign-in is expressed the way the endpoint reads it - a full term minus
    however long ago it was issued.
    """
    from app import database, models

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", Session)

    def mint(minutes_ago):
        token = f"token-{minutes_ago}-{secrets.token_hex(4)}"
        db = Session()
        try:
            db.add(models.User(
                username=f"google_{secrets.token_hex(6)}",
                email=f"{secrets.token_hex(6)}@example.invalid",
                role="user", is_approved=True, email_verified=True,
                session_token=token,
                session_expires=datetime.now()
                + timedelta(days=app_lock.SESSION_DAYS)
                - timedelta(minutes=minutes_ago),
            ))
            db.commit()
        finally:
            db.close()
        return token

    return mint


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

def test_reset_without_any_proof_does_nothing(locked):
    res = locked.post("/api/lock/reset", json={"new_pin": "111111"})
    assert res.status_code == 401
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 200


def test_reset_refuses_a_token_that_was_never_issued(locked, signed_in):
    res = locked.post("/api/lock/reset",
                      json={"new_pin": "111111", "session_token": "made-up-token"})
    assert res.status_code == 401
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 200


def test_a_sign_in_that_just_happened_sets_the_new_pin(locked, signed_in):
    """The whole point: forgetting the PIN must not shut the app for good.

    Reset once took an email and an account password, and for a while there
    were no passwords - sign-in was providers only, no user row kept a hash,
    and the branch could not be satisfied by anybody. What it takes now is a
    sign-in completed just now, by either route, which is why this is checked
    on the token rather than on how the token was obtained.
    """
    token = signed_in(minutes_ago=0)
    res = locked.post("/api/lock/reset",
                      json={"new_pin": "111111", "session_token": token})
    assert res.status_code == 200, res.text
    assert locked.post("/api/lock/verify", json={"pin": "111111"}).status_code == 200
    # And the old PIN is genuinely gone, not merely shadowed.
    app_lock._attempts.clear()
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 401


def test_a_session_saved_on_this_machine_is_not_proof(locked, signed_in):
    """Whoever is sitting at the PIN screen already has the saved session.

    If an old token were accepted, the lock would protect nothing from the
    one person it is meant to stop - the passer-by at an unattended machine.
    """
    stale = signed_in(minutes_ago=int(app_lock.RECENT_SIGN_IN.total_seconds() // 60) + 5)
    res = locked.post("/api/lock/reset",
                      json={"new_pin": "111111", "session_token": stale})
    assert res.status_code == 401
    assert locked.post("/api/lock/verify", json={"pin": PIN}).status_code == 200


def test_an_expired_session_is_not_proof_either(locked, signed_in):
    res = locked.post("/api/lock/reset",
                      json={"new_pin": "111111", "session_token": signed_in(minutes_ago=60 * 24 * 40)})
    assert res.status_code == 401


def test_the_cookie_counts_as_well_as_the_body(locked, signed_in):
    """The packaged app has the httpOnly cookie; a bare fetch has the token."""
    locked.cookies.set("session_token", signed_in(minutes_ago=1))
    res = locked.post("/api/lock/reset", json={"new_pin": "222222"})
    locked.cookies.clear()
    assert res.status_code == 200, res.text
    assert locked.post("/api/lock/verify", json={"pin": "222222"}).status_code == 200


def test_reset_says_the_same_thing_however_the_proof_falls_short(locked, signed_in):
    """So it cannot be used to find out whether a token is real."""
    missing = locked.post("/api/lock/reset",
                          json={"new_pin": "111111", "session_token": "not-a-token"})
    app_lock._attempts.clear()
    stale = locked.post("/api/lock/reset",
                        json={"new_pin": "111111", "session_token": signed_in(minutes_ago=60)})
    assert missing.status_code == stale.status_code
    assert missing.json() == stale.json()


def test_reset_is_throttled_on_the_same_counter_as_guesses(locked):
    """So it cannot be used to brute-force tokens instead of the PIN."""
    for _ in range(app_lock._MAX_ATTEMPTS):
        locked.post("/api/lock/reset", json={"new_pin": "111111", "session_token": "wrong"})
    res = locked.post("/api/lock/reset", json={"new_pin": "111111", "session_token": "wrong"})
    assert res.status_code == 429


def test_reset_requires_a_digit_pin_like_every_other_route(locked, signed_in):
    assert locked.post("/api/lock/reset", json={
        "new_pin": "abcdef", "session_token": signed_in(minutes_ago=0)
    }).status_code == 400
