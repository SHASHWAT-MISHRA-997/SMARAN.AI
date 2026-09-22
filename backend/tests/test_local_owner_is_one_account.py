"""The desktop app is one person, however often its localStorage is cleared.

The app names itself with Date.now() plus Math.random(), kept only in
localStorage, and sent as X-Device-ID. The backend used to trust that name and
create an account per value. Every reinstall, port change or cleared app data
therefore produced a new account that owned nothing, while the previous
conversations, memories and audit rows stayed with an account nobody was any
more.

It is not hypothetical. The installed app had accumulated 107 user rows, 95 of
them sharing one hardware fingerprint - one Windows machine, one person - with
the data scattered across them. Analytics scope every count to the logged-in
user, so the dashboard reported zero requests, zero words and zero memories
while the database held 40 audit rows, 76 sessions and 10 memories.

What these tests hold down is that a loopback caller resolves to one account no
matter what id it presents, and that a caller from off-machine still does not.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import LOCAL_OWNER_DEVICE_ID, app  # noqa: E402
from app.models import User  # noqa: E402

# TestClient reports its peer as "testclient" unless told otherwise, which is
# not a loopback address and would quietly skip the branch under test.
client = TestClient(app, client=("127.0.0.1", 54321))
remote = TestClient(app, client=("192.168.1.50", 54321))


@pytest.fixture(autouse=True)
def schema():
    Base.metadata.create_all(bind=engine)
    yield


def accounts_named(prefix):
    db = SessionLocal()
    try:
        return db.query(User).filter(User.username.like(prefix + "%")).count()
    finally:
        db.close()


def whoami(device_id=None, fingerprint=None):
    """The account a request resolves to, as the app's own endpoints see it."""
    headers = {}
    if device_id:
        headers["X-Device-ID"] = device_id
    if fingerprint:
        headers["X-Device-Fingerprint"] = fingerprint
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------------------
# One machine, one account
# ---------------------------------------------------------------------------

def test_a_cleared_localstorage_does_not_strand_the_history():
    """The exact sequence that produced 95 accounts."""
    first = whoami("device_mtzj3t30_90868flm", "windows-fingerprint")

    # The app is reinstalled, or its data is cleared: a brand-new random id.
    second = whoami("device_mu0yrvio_ieq24sd1", "windows-fingerprint")

    assert second["id"] == first["id"], (
        "a new random device id created a new account, so the owner's "
        "conversations and memories became invisible to them"
    )


def test_many_fresh_ids_from_this_machine_make_no_new_accounts():
    before = accounts_named("device_")
    for n in range(12):
        whoami("device_run%d_%s" % (n, "x" * 8), "windows-fingerprint")
    assert accounts_named("device_") == before, (
        "each visit minted an account; this is how the database reached 107"
    )


def test_the_owner_is_the_same_account_with_or_without_a_device_header():
    """The app sends a header; a plain browser on the same machine may not."""
    assert whoami("device_abcdefgh_12345678")["id"] == whoami()["id"]


def test_the_owner_account_keeps_its_stable_name():
    assert whoami("device_zzzzzzzz_99999999")["username"] == (
        "device_" + LOCAL_OWNER_DEVICE_ID
    )


def test_device_login_does_not_mint_an_account_per_call():
    """The startup call that created them: /api/auth/device-login."""
    before = accounts_named("device_")
    for n in range(8):
        res = client.post("/api/auth/device-login", json={
            "device_id": "device_login%d_aaaa" % n,
            "device_fingerprint": "windows-fingerprint",
        })
        assert res.status_code == 200, res.text
    assert accounts_named("device_") == before


def test_the_fingerprint_the_app_sends_is_actually_stored():
    """It was declared nowhere on the request model, so Pydantic dropped it."""
    res = client.post("/api/auth/device-login", json={
        "device_id": "device_fptest_12345678",
        "device_fingerprint": "a-recorded-fingerprint",
    })
    assert res.status_code == 200, res.text
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == res.json()["id"]).first()
        assert user.device_fingerprint, (
            "the app sends a fingerprint on every call and it was not saved"
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Off-machine callers are not swept into the owner's account
# ---------------------------------------------------------------------------

def remote_whoami(device_id=None):
    headers = {"X-Device-ID": device_id} if device_id else {}
    return remote.get("/api/auth/me", headers=headers)


def test_a_caller_from_the_network_is_not_the_owner():
    """Collapsing to one account must stop at the edge of this machine.

    The phone reaches the app over the LAN. It must not inherit the desktop
    owner's conversations because it happened to omit a header - and, since
    anonymous remote callers stopped being given accounts of their own at all,
    it is refused outright (tests/test_remote_callers_must_sign_in.py).
    """
    whoami("device_owner01_12345678")
    assert remote_whoami("device_phone01_12345678").status_code == 401
    assert remote_whoami().status_code == 401


def test_no_account_is_invented_for_a_caller_on_the_network():
    """Two strangers on the Wi-Fi used to get an account each. Now neither does."""
    assert remote_whoami("device_phoneaa_12345678").status_code == 401
    assert remote_whoami("device_phonebb_12345678").status_code == 401
