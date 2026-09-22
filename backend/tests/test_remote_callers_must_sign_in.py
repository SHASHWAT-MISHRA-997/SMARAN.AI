"""A caller on the network is nobody until it proves otherwise.

The desktop app listens on 0.0.0.0 so a paired phone can reach it over Wi-Fi.
That also puts it in reach of everything else on the same network - a cafe,
a hostel, an office. get_current_user used to answer a remote caller that
sent no session token by inventing an account for it (`guest_<hash of IP>`,
approved, role "user") and letting it in. Every route that "required
sign-in" was therefore open to the whole network - including
/api/terminal/run, which runs any shell command with source "user".

A remote caller now needs a real session token: the paired phone has its
pairing token, and a browser on another device signs in. Loopback - the app
on this computer - is still the owner, as before.

No socket is opened: the test client plays the caller's address in-process.
"""

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture(scope="module")
def app():
    from app.main import app as fastapi_app
    return fastapi_app


def caller(app, address):
    return TestClient(app, client=(address, 50123), raise_server_exceptions=False)


REMOTE = "192.168.1.50"


def test_a_remote_caller_with_no_token_cannot_run_a_command(app):
    res = caller(app, REMOTE).post("/api/terminal/run",
                                   json={"command": "echo should-not-run", "source": "user"})
    assert res.status_code == 401
    assert b"should-not-run" not in res.content


@pytest.mark.parametrize("method,path", [
    ("get", "/api/chat/sessions"),
    ("post", "/api/desktop/execute"),
    ("post", "/api/desktop/screenshot"),
    ("get", "/api/terminal/context"),
])
def test_protected_routes_refuse_an_anonymous_remote_caller(app, method, path):
    client = caller(app, REMOTE)
    res = client.post(path, json={}) if method == "post" else client.get(path)
    assert res.status_code == 401, "%s %s answered %s" % (method.upper(), path, res.status_code)


def test_a_made_up_device_id_from_the_network_is_not_an_account(app):
    res = caller(app, REMOTE).get("/api/chat/sessions",
                                  headers={"X-Device-ID": "attacker-device-0001"})
    assert res.status_code == 401


def test_this_computer_is_still_the_owner(app):
    res = caller(app, "127.0.0.1").get("/api/chat/sessions")
    assert res.status_code == 200


@pytest.mark.parametrize("method,path", [
    ("post", "/api/updates/install"),
    ("post", "/api/updates/download"),
    ("post", "/api/speech/gpu/install"),
    ("post", "/api/auth/google/config"),
    ("post", "/api/usage-reporting"),
    ("post", "/api/control/session"),
    ("get", "/api/telemetry"),
])
def test_state_changing_and_hardware_routes_need_a_signed_in_caller(app, method, path):
    """These had no check at all - not even the old guest one."""
    client = caller(app, REMOTE)
    res = client.post(path, json={}) if method == "post" else client.get(path)
    assert res.status_code == 401, "%s %s answered %s" % (method.upper(), path, res.status_code)


def test_a_paired_phone_is_let_in_as_its_owner(app):
    """The fix must not lock out the phone the owner paired."""
    import secrets
    from app.database import SessionLocal
    from app.models import PairedDevice, User
    db = SessionLocal()
    try:
        owner = db.query(User).filter(User.username == "pairing-test-owner").first()
        if not owner:
            owner = User(username="pairing-test-owner", role="user", is_approved=True)
            db.add(owner)
            db.commit()
            db.refresh(owner)
        token = secrets.token_urlsafe(24)
        db.add(PairedDevice(id=secrets.token_urlsafe(8), user_id=owner.id, name="Test phone",
                            kind="phone", token=token))
        db.commit()
    finally:
        db.close()
    me = caller(app, REMOTE).get("/api/auth/me", headers={"X-Companion-Token": token})
    assert me.status_code == 200
    assert me.json()["username"] == "pairing-test-owner"
    stale = caller(app, REMOTE).get("/api/auth/me", headers={"X-Companion-Token": "not-a-token"})
    assert stale.status_code == 401


@pytest.mark.parametrize("path", ["/ws/voice/live", "/ws/voice/local", "/ws/telemetry"])
def test_websockets_refuse_a_stranger_on_the_network(app, path):
    """A voice call through the owner's Gemini key was open to anyone on the Wi-Fi."""
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with caller(app, REMOTE).websocket_connect(path) as ws:
            ws.receive_text()


def test_this_computer_can_still_open_the_telemetry_socket(app):
    with caller(app, "127.0.0.1").websocket_connect("/ws/telemetry") as ws:
        assert ws.receive_text()
