"""Asking to reset a password must not be a way to take the account.

Found by driving /api/auth against a running backend rather than reading it.

There is no SMTP server, so forgot-password handed the reset token straight
back in the HTTP response. For someone resetting their own password at their
own keyboard that is the right design. But this backend also answers on the
LAN - that is how the paired phone reaches it - and the endpoint needs no
authentication. So the whole chain was:

    POST /api/auth/forgot-password {"email": "<victim>"}   -> reset_token
    POST /api/auth/reset-password  {"token": ..., ...}     -> password changed
    POST /api/auth/login                                   -> in

Knowing an email address was the only requirement. And the addresses were
discoverable from the same endpoint, which answered 404 for an unknown address
and 200 for a real one.

The token now goes only to a caller on the machine SMARAN is running on, and
the reply is identical whether or not the account exists.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app, auth_limiter  # noqa: E402
from app.models import User  # noqa: E402

# TestClient reports its peer as "testclient", which is not loopback and would
# quietly skip the branch under test.
owner = TestClient(app, client=("127.0.0.1", 54321))
network = TestClient(app, client=("192.168.1.50", 54321))

VICTIM = "reset_victim@smaran.ai"
PASSWORD = "V1ctim!-Str0ng-Pass"


@pytest.fixture(autouse=True)
def victim_account():
    # forgot-password allows 3 per hour per address. Without clearing it the
    # budget leaks between tests and a later test reads 429 instead of the
    # answer it is checking - which looks like a pass for the wrong reason on
    # the enumeration test, since 429 == 429.
    auth_limiter.reset()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(User).filter(User.email == VICTIM).delete()
        db.commit()
    finally:
        db.close()

    res = owner.post("/api/auth/register", json={
        "username": "reset_victim", "email": VICTIM, "password": PASSWORD})
    assert res.status_code == 200, res.text
    yield

    db = SessionLocal()
    try:
        db.query(User).filter(User.email == VICTIM).delete()
        db.commit()
    finally:
        db.close()


def forgot(client, email):
    return client.post("/api/auth/forgot-password", json={"email": email})


# ---------------------------------------------------------------------------
# The takeover
# ---------------------------------------------------------------------------

def test_the_network_cannot_get_a_reset_token():
    """The first link in the chain. Break this and the rest cannot happen."""
    res = forgot(network, VICTIM)
    assert res.status_code == 200, res.text
    assert "reset_token" not in res.json(), (
        "a caller from the LAN was handed a working password reset token for "
        "an account it does not own"
    )


def test_the_network_cannot_complete_the_takeover():
    """The full chain, driven end to end, from off the machine."""
    handed = forgot(network, VICTIM).json().get("reset_token")
    assert handed is None

    # Without a token there is nothing to present, and a guess must not work.
    # The email goes with it so this exercises the token check rather than
    # stopping at schema validation: reset-password scopes the lookup to an
    # address, because a six-digit code is not unique across accounts.
    res = network.post("/api/auth/reset-password", json={
        "email": VICTIM, "token": "123456", "new_password": "Attack3r!-Own3d-99"})
    assert res.status_code >= 400

    res = network.post("/api/auth/login", json={
        "email": VICTIM, "password": "Attack3r!-Own3d-99"})
    assert res.status_code != 200, "the account was taken over"

    # And the real password still works, so nothing was disturbed.
    res = owner.post("/api/auth/login", json={"email": VICTIM, "password": PASSWORD})
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# Account enumeration
# ---------------------------------------------------------------------------

def test_an_unknown_address_looks_exactly_like_a_known_one():
    """It answered 404 for unknown and 200 for real, which is a directory."""
    real = forgot(network, VICTIM)
    fake = forgot(network, "definitely-nobody-here@smaran.ai")
    assert real.status_code == fake.status_code, (
        "the status code reveals which email addresses have accounts"
    )
    assert real.json() == fake.json(), (
        "the response body reveals which email addresses have accounts"
    )


def test_enumeration_is_closed_on_the_local_path_too():
    """The owner's own path must not become a lookup service either."""
    fake = forgot(owner, "definitely-nobody-here@smaran.ai")
    assert fake.status_code == 200
    assert "reset_token" not in fake.json()


# ---------------------------------------------------------------------------
# The owner keeps the behaviour the design intended
# ---------------------------------------------------------------------------

def test_the_owner_can_still_reset_their_own_password():
    """There is no mail server; taking this away would strand the owner."""
    body = forgot(owner, VICTIM).json()
    token = body.get("reset_token")
    assert token, "the owner can no longer reset a password on their own machine"

    res = owner.post("/api/auth/reset-password", json={
        "email": VICTIM, "token": token, "new_password": "N3w!-Owner-Pass-77"})
    assert res.status_code == 200, res.text

    res = owner.post("/api/auth/login", json={
        "email": VICTIM, "password": "N3w!-Owner-Pass-77"})
    assert res.status_code == 200, res.text
