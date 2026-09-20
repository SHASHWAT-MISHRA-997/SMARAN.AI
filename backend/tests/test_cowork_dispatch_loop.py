"""The whole Cowork loop, with a simulated handset instead of a real one.

A paired phone talks to this backend over the LAN with a pairing token. Every
leg of that conversation is exercised here except the physical device: pairing,
the desktop dispatching an action, the phone collecting it, the phone asking
the desktop to do something, and the desktop collecting that in turn.

What a real handset would add is the radio and the app's own UI. What it would
not add is any of the behaviour below, and these are the parts that can go
quietly wrong: a command delivered twice, a queue that grows without limit, a
dispatch that reports success with nobody to receive it, or one account
reaching another account's phone.

Every device paired here is unpaired again in a finally block. A test that
leaves devices behind is how sixty-four phantom "Sync Test Phone" entries once
accumulated in the running app.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import companion  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402

owner = TestClient(app, client=("127.0.0.1", 54321))


@pytest.fixture(autouse=True)
def schema():
    Base.metadata.create_all(bind=engine)
    companion._command_queues.clear()
    yield
    companion._command_queues.clear()


def pair(client=owner, name="Loop Test Phone"):
    """Pair a device and hand back its id and token."""
    code = client.post("/api/companion/pairing/start?port=3003").json()["code"]
    body = client.post("/api/companion/pairing/claim", json={
        "code": code, "device_name": name, "device_kind": "phone"}).json()
    return body["device_id"], body["token"]


@pytest.fixture
def phone():
    device_id, token = pair()
    try:
        yield device_id, token
    finally:
        owner.delete("/api/companion/devices/%s" % device_id)


# ---------------------------------------------------------------------------
# Desktop -> phone
# ---------------------------------------------------------------------------

def test_a_dispatched_action_reaches_the_phone(phone):
    device_id, token = phone
    res = owner.post("/api/companion/dispatch", json={
        "device_id": device_id, "action": "notify",
        "data": {"text": "tea is ready"}})
    assert res.status_code == 200, res.text
    assert res.json()["dispatched"] is True

    waiting = owner.get("/api/companion/commands", params={"token": token}).json()
    assert len(waiting["commands"]) == 1
    delivered = waiting["commands"][0]
    assert delivered["action"] == "notify"
    assert delivered["params"]["text"] == "tea is ready"


def test_a_command_is_delivered_once_and_not_again(phone):
    """The queue is cleared by the poll. A phone that polls twice on a flaky
    connection must not act on the same instruction twice."""
    device_id, token = phone
    owner.post("/api/companion/dispatch", json={
        "device_id": device_id, "action": "speak", "data": {"text": "hello"}})

    first = owner.get("/api/companion/commands", params={"token": token}).json()
    second = owner.get("/api/companion/commands", params={"token": token}).json()
    assert len(first["commands"]) == 1
    assert second["commands"] == []


def test_the_queue_does_not_grow_without_limit(phone):
    """A phone that is off for a week must not come back to thousands."""
    device_id, token = phone
    for n in range(companion._MAX_QUEUED_COMMANDS + 20):
        owner.post("/api/companion/dispatch", json={
            "device_id": device_id, "action": "ping", "data": {"n": n}})

    waiting = owner.get("/api/companion/commands", params={"token": token}).json()
    assert len(waiting["commands"]) == companion._MAX_QUEUED_COMMANDS

    # And it keeps the newest, not the oldest.
    assert waiting["commands"][-1]["params"]["n"] == \
        companion._MAX_QUEUED_COMMANDS + 19


def test_an_action_that_is_not_permitted_is_refused(phone):
    device_id, _ = phone
    res = owner.post("/api/companion/dispatch", json={
        "device_id": device_id, "action": "format_disk", "data": {}})
    assert res.status_code == 400
    assert "not a permitted remote action" in res.json()["detail"]


def test_dispatching_to_nobody_is_not_reported_as_success():
    """With no phone paired, "all" must fail rather than claim delivery."""
    db = SessionLocal()
    try:
        from app.models import PairedDevice
        user = db.query(User).filter(
            User.username == "device_local_default_user").first()
        if user:
            db.query(PairedDevice).filter(
                PairedDevice.user_id == user.id).delete()
            db.commit()
    finally:
        db.close()

    res = owner.post("/api/companion/dispatch", json={
        "device_id": "all", "action": "ping", "data": {}})
    assert res.status_code == 404
    assert "No paired devices" in res.json()["detail"]


def test_an_unknown_device_is_not_redirected_to_some_other_phone(phone):
    res = owner.post("/api/companion/dispatch", json={
        "device_id": "no-such-device", "action": "ping", "data": {}})
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Phone -> desktop
# ---------------------------------------------------------------------------

def test_the_phone_can_ask_the_desktop_to_do_something(phone):
    _, token = phone
    res = owner.post("/api/companion/from-device", json={
        "token": token, "action": "notify", "params": {"text": "from the phone"}})
    assert res.status_code == 200, res.text

    waiting = owner.get("/api/companion/desktop-commands").json()
    assert any(c["action"] == "notify" for c in waiting["commands"])


def test_a_vetted_desktop_action_really_runs_from_the_phone(phone):
    """get_time is chosen because it reads a clock and changes nothing."""
    _, token = phone
    res = owner.post("/api/companion/from-device", json={
        "token": token, "action": "desktop_action",
        "params": {"action": "get_time", "confirmed": True}})
    assert res.status_code == 200, res.text
    assert res.json().get("success") is True
    assert res.json().get("iso"), "the action answered without doing anything"


def test_the_phone_cannot_name_an_action_outside_the_permitted_set(phone):
    _, token = phone
    res = owner.post("/api/companion/from-device", json={
        "token": token, "action": "run_anything", "params": {}})
    assert res.status_code == 400


def test_desktop_action_without_naming_one_is_refused(phone):
    _, token = phone
    res = owner.post("/api/companion/from-device", json={
        "token": token, "action": "desktop_action", "params": {}})
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# The token is the whole of the phone's authority
# ---------------------------------------------------------------------------

def test_a_made_up_token_collects_nothing(phone):
    device_id, token = phone
    owner.post("/api/companion/dispatch", json={
        "device_id": device_id, "action": "ping", "data": {}})

    res = owner.get("/api/companion/commands",
                    params={"token": "not-a-real-token"})
    assert res.status_code >= 400, (
        "an invented token was served a queue belonging to a paired device"
    )

    # And the real command is still waiting for the device it was meant for.
    waiting = owner.get("/api/companion/commands", params={"token": token}).json()
    assert len(waiting["commands"]) == 1


def test_a_made_up_token_cannot_drive_the_desktop():
    res = owner.post("/api/companion/from-device", json={
        "token": "not-a-real-token", "action": "desktop_action",
        "params": {"action": "get_time", "confirmed": True}})
    assert res.status_code >= 400


def test_an_unpaired_device_loses_its_authority():
    """Unlinking has to actually revoke, not just hide the row from a list."""
    device_id, token = pair(name="Revoked Phone")
    owner.delete("/api/companion/devices/%s" % device_id)

    res = owner.get("/api/companion/commands", params={"token": token})
    assert res.status_code >= 400, "a removed device could still collect commands"


# ---------------------------------------------------------------------------
# One account must not reach another account's phone
# ---------------------------------------------------------------------------

network = TestClient(app, client=("192.168.1.50", 54321))


def test_the_network_cannot_drive_the_desktop_controls(phone):
    """These routes answer on the LAN - that is how the phone finds this
    machine - and they used to accept everybody, with no credential at all."""
    device_id, _ = phone

    assert network.get("/api/companion/devices").status_code == 401, (
        "anyone on the same wifi could list the paired devices"
    )
    assert network.post("/api/companion/dispatch", json={
        "device_id": device_id, "action": "notify",
        "data": {"text": "hello"}}).status_code == 401, (
        "anyone on the same wifi could send commands to the owner's phone"
    )
    assert network.delete(
        "/api/companion/devices/%s" % device_id).status_code == 401, (
        "anyone on the same wifi could unpair the owner's phone"
    )
    assert network.get("/api/companion/desktop-commands").status_code == 401
    assert network.post(
        "/api/companion/pairing/start?port=3003").status_code == 401

    # And the device is still paired, and the command was never queued.
    devices = owner.get("/api/companion/devices").json()["devices"]
    assert any(d["id"] == device_id for d in devices)


def test_another_account_cannot_dispatch_to_this_phone(phone):
    device_id, _ = phone

    import secrets as _secrets
    from datetime import datetime, timedelta

    # Built directly rather than through /api/auth/register, which no longer
    # exists: sign-in is Supabase and an identity provider now. What this test
    # actually needs is a second account holding a valid session, and that is
    # what a session token is, however it was obtained.
    mark = "cowork_other_%s" % _secrets.token_hex(3)
    other_token = _secrets.token_urlsafe(32)
    db = SessionLocal()
    try:
        db.add(User(
            username=mark,
            email="%s@smaran.ai" % mark,
            role="user",
            is_approved=True,
            email_verified=True,
            session_token=other_token,
            session_expires=datetime.now() + timedelta(days=1),
        ))
        db.commit()
    finally:
        db.close()

    try:
        # A real session, but a different account's - and from off the machine,
        # because on the machine the owner is the owner by definition.
        res = network.post(
            "/api/companion/dispatch",
            json={"device_id": device_id, "action": "ping", "data": {}},
            headers={"Authorization": "Bearer " + other_token})
        assert res.status_code == 404, (
            "a different account reached a phone it does not own"
        )

        res = network.post(
            "/api/companion/dispatch",
            json={"device_id": "all", "action": "ping", "data": {}},
            headers={"Authorization": "Bearer " + other_token})
        assert res.status_code == 404, (
            "dispatching to 'all' crossed into another account's devices"
        )
    finally:
        db = SessionLocal()
        try:
            db.query(User).filter(User.username == mark).delete()
            db.commit()
        finally:
            db.close()


def test_a_paired_device_can_still_drive_its_own_screens(phone):
    """The phone loads the same device screens, and they talk to the desktop
    over the LAN. Pairing is the owner saying this device may act for them, so
    the token it was issued has to be enough - otherwise tightening these
    routes locks the handset out of the very screens it is there to show."""
    device_id, token = phone
    headers = {"X-Companion-Token": token}

    res = network.get("/api/companion/devices", headers=headers)
    assert res.status_code == 200, res.text
    assert any(d["id"] == device_id for d in res.json()["devices"])

    res = network.post("/api/companion/dispatch",
                       json={"device_id": device_id, "action": "notify",
                             "data": {"text": "from the phone's own screen"}},
                       headers=headers)
    assert res.status_code == 200, res.text


def test_a_revoked_device_token_stops_working_on_those_screens():
    device_id, token = pair(name="Revoked Screen Phone")
    owner.delete("/api/companion/devices/%s" % device_id)
    res = network.get("/api/companion/devices",
                      headers={"X-Companion-Token": token})
    assert res.status_code == 401


def test_the_phone_itself_is_unaffected(phone):
    """The device-facing half authenticates with the pairing token and must
    keep working from the network, which is the only place a phone is."""
    device_id, token = phone
    owner.post("/api/companion/dispatch", json={
        "device_id": device_id, "action": "ping", "data": {}})

    res = network.get("/api/companion/commands", params={"token": token})
    assert res.status_code == 200, res.text
    assert len(res.json()["commands"]) == 1

    res = network.post("/api/companion/from-device", json={
        "token": token, "action": "notify", "params": {"text": "still works"}})
    assert res.status_code == 200, res.text
