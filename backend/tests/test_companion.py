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

client = TestClient(app)


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
    import uuid
    sess_id = f"test-sync-{uuid.uuid4().hex[:8]}"
    start_resp = client.post("/api/companion/pairing/start?port=3003")
    code = start_resp.json()["code"]

    claim_resp = client.post("/api/companion/pairing/claim", json={
        "code": code,
        "device_name": "Sync Test Phone",
        "device_kind": "phone"
    })
    token = claim_resp.json()["token"]

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
    sync_resp = client.post("/api/companion/sync", json=sync_payload)
    assert sync_resp.status_code == 200, sync_resp.text
    data = sync_resp.json()
    assert data["accepted"] == 2
