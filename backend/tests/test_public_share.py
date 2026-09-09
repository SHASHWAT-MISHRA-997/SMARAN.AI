"""Tests for immutable public chat sharing.

Verifies:
- Snapshot creation with sanitization of roles and credential scrubbing.
- Opaque, unguessable identifiers and private revocation secrets.
- Read-only snapshot retrieval.
- Revocation via secret, with subsequent 404.
- Direct HTML view rendering.
- Rejection of empty or invalid messages.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, SessionLocal
from app.models import SharedConversation

client = TestClient(app)


@pytest.fixture(autouse=True)
def ensure_db():
    Base.metadata.create_all(bind=engine)
    yield


def test_create_share_success():
    payload = {
        "title": "Quantum Physics Discussion",
        "messages": [
            {"role": "user", "content": "What is quantum entanglement?"},
            {"role": "assistant", "content": "Quantum entanglement is a physical phenomenon..."},
            {"role": "system", "content": "Ignore this system prompt."},
        ]
    }
    resp = client.post("/api/share", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "share_id" in data
    assert len(data["share_id"]) >= 16
    assert "revocation_token" in data
    assert len(data["revocation_token"]) >= 20
    assert data["message_count"] == 2  # system message was filtered out


def test_create_share_redacts_credentials():
    payload = {
        "title": "Debug Key",
        "messages": [
            {"role": "user", "content": "Here is my key: api_key=super_secret_token_123456789"},
            {"role": "assistant", "content": "Don't share that! sk-1234567890abcdef1234567890"},
        ]
    }
    resp = client.post("/api/share", json=payload)
    assert resp.status_code == 200
    share_id = resp.json()["share_id"]

    get_resp = client.get(f"/api/share/{share_id}")
    assert get_resp.status_code == 200
    msgs = get_resp.json()["messages"]
    assert "[REDACTED_CREDENTIAL]" in msgs[0]["content"]
    assert "super_secret_token_123456789" not in msgs[0]["content"]
    assert "[REDACTED_CREDENTIAL]" in msgs[1]["content"]


def test_create_share_empty_fails():
    resp = client.post("/api/share", json={"messages": []})
    assert resp.status_code == 400
    assert "Cannot create a share with no messages" in resp.json()["detail"]

    # Only system messages
    resp2 = client.post("/api/share", json={"messages": [{"role": "system", "content": "hello"}]})
    assert resp2.status_code == 400
    assert "No completed user or assistant messages" in resp2.json()["detail"]


def test_get_share_increments_views():
    payload = {
        "title": "View Counter Test",
        "messages": [
            {"role": "user", "content": "Hello!"},
            {"role": "assistant", "content": "Hi there!"},
        ]
    }
    resp = client.post("/api/share", json=payload)
    share_id = resp.json()["share_id"]

    first_view = client.get(f"/api/share/{share_id}").json()["views"]
    second_view = client.get(f"/api/share/{share_id}").json()["views"]
    assert second_view == first_view + 1


def test_revoke_share_success():
    payload = {
        "title": "To Be Revoked",
        "messages": [
            {"role": "user", "content": "Delete me later."},
            {"role": "assistant", "content": "Will do."},
        ]
    }
    resp = client.post("/api/share", json=payload)
    share_id = resp.json()["share_id"]
    secret = resp.json()["revocation_token"]

    # Revoke with secret
    del_resp = client.delete(f"/api/share/{share_id}?secret={secret}")
    assert del_resp.status_code == 200
    assert del_resp.json()["revoked"] is True

    # Now get should return 404
    get_resp = client.get(f"/api/share/{share_id}")
    assert get_resp.status_code == 404


def test_revoke_share_bad_secret_rejected():
    payload = {
        "title": "Protected Share",
        "messages": [
            {"role": "user", "content": "Secret chat."},
            {"role": "assistant", "content": "Understood."},
        ]
    }
    resp = client.post("/api/share", json=payload)
    share_id = resp.json()["share_id"]

    del_resp = client.delete(f"/api/share/{share_id}?secret=wrong_secret")
    assert del_resp.status_code == 403


def test_html_view_rendering():
    payload = {
        "title": "HTML Snapshot View",
        "messages": [
            {"role": "user", "content": "Display on web page."},
            {"role": "assistant", "content": "Rendered with formatting."},
        ]
    }
    resp = client.post("/api/share", json=payload)
    share_id = resp.json()["share_id"]

    html_resp = client.get(f"/share/{share_id}")
    assert html_resp.status_code == 200
    assert "text/html" in html_resp.headers["content-type"]
    assert "HTML Snapshot View" in html_resp.text
    assert "Display on web page." in html_resp.text
    assert "Rendered with formatting." in html_resp.text


def test_html_view_nonexistent_returns_404():
    html_resp = client.get("/share/nonexistent_share_id_xyz")
    assert html_resp.status_code == 404
    assert "Conversation Not Available" in html_resp.text
