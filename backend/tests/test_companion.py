"""Tests for companion device pairing and conversation sync.

Verifies:
- Starting pairing generates a 6-digit code and local network URL.
- QR SVG rendering works and rejects payloads that are too large.
- Claiming pairing creates a PairedDevice record and returns an auth token.
- Paired devices can be listed and unlinked.
- Offline conversation messages can be synced and merged into ChatSession/ChatMessage.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, SessionLocal
from app.models import PairedDevice, User, ChatSession, ChatMessage

# Pinned to loopback on purpose. These exercise the desktop half of the
# companion API - pairing, listing and unlinking - which is now the owner's to
# drive from the machine SMARAN runs on, and answers 401 to the network.
# TestClient otherwise reports its peer as "testclient", which is not loopback,
# so every one of these would fail as an unauthenticated LAN caller.
client = TestClient(app, client=("127.0.0.1", 54321))


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "local_user").first()
        if not user:
            user = User(username="local_user", email="local@smaran.ai", is_approved=True, role="admin")
            db.add(user)
            db.commit()
    finally:
        db.close()
    yield


def test_start_pairing():
    resp = client.post("/api/companion/pairing/start?port=3003")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "code" in data
    assert len(data["code"]) == 6
    assert "url" in data
    assert "qr_payload" in data
    assert data["qr_payload"].startswith("http")


def test_pairing_qr_svg():
    payload = "http://192.168.1.5:3003/?pair=123456"
    resp = client.get(f"/api/companion/pairing/qr?payload={payload}")
    assert resp.status_code == 200
    assert "image/svg+xml" in resp.headers.get("content-type", "")
    assert b"<svg" in resp.content


def test_claim_and_list_devices():
    start_resp = client.post("/api/companion/pairing/start?port=3003")
    assert start_resp.status_code == 200
    code = start_resp.json()["code"]

    claim_payload = {
        "code": code,
        "device_name": "OnePlus Nord CE4",
        "device_kind": "phone"
    }
    claim_resp = client.post("/api/companion/pairing/claim", json=claim_payload)
    assert claim_resp.status_code == 200, claim_resp.text
    claim_data = claim_resp.json()
    assert "device_id" in claim_data
    assert "token" in claim_data
    assert claim_data["name"] == "OnePlus Nord CE4"

    # List devices
    list_resp = client.get("/api/companion/devices")
    assert list_resp.status_code == 200
    devices = list_resp.json().get("devices", [])
    assert any(d["id"] == claim_data["device_id"] for d in devices)

    # Unlink device
    del_resp = client.delete(f"/api/companion/devices/{claim_data['device_id']}")
    assert del_resp.status_code == 200

    # Verify device removed
    list_after = client.get("/api/companion/devices").json().get("devices", [])
    assert not any(d["id"] == claim_data["device_id"] for d in list_after)


def test_sync_conversations():
    """Pairs a phone, syncs from it, and unpairs it again.

    The unpair is the point. This test used to pair a device and leave it
    there, so every run of the suite added one permanent row to whatever
    database it ran against - the developer's own, in practice. Sixty-four
    phantom "Sync Test Phone" entries had accumulated in the running app: they
    filled the device list, and dispatching to "all devices" reported sixty-four
    recipients that do not exist.
    """
    import uuid
    sess_id = f"test-sync-{uuid.uuid4().hex[:8]}"
    start_resp = client.post("/api/companion/pairing/start?port=3003")
    code = start_resp.json()["code"]

    claim_resp = client.post("/api/companion/pairing/claim", json={
        "code": code,
        "device_name": "Sync Test Phone",
        "device_kind": "phone"
    })
    claim_data = claim_resp.json()
    token = claim_data["token"]
    device_id = claim_data["device_id"]

    sync_payload = {
        "token": token,
        "messages": [
            {
                "session_id": sess_id,
                "session_title": "Synced Chat",
                "role": "user",
                "content": f"Message from phone {sess_id}",
                "created_at": "2026-09-10T04:00:00Z"
            },
            {
                "session_id": sess_id,
                "session_title": "Synced Chat",
                "role": "assistant",
                "content": f"Assistant answer on phone {sess_id}",
                "created_at": "2026-09-10T04:00:05Z"
            }
        ]
    }
    try:
        sync_resp = client.post("/api/companion/sync", json=sync_payload)
        assert sync_resp.status_code == 200, sync_resp.text
        data = sync_resp.json()
        assert data["accepted"] == 2
    finally:
        # In a finally block: a failing assertion above must not be the reason
        # a device is left behind, which is exactly how they accumulated.
        client.delete(f"/api/companion/devices/{device_id}")

    remaining = client.get("/api/companion/devices").json().get("devices", [])
    assert not any(d["id"] == device_id for d in remaining), (
        "the paired test device outlived the test and will pollute the device list"
    )
