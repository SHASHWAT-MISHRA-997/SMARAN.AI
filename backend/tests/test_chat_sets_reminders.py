"""'Remind me' sent straight to /api/chat sets a real reminder.

The app's page sets reminders before it calls /api/chat, but the VS Code
extension, the CLI and anything else that talks to /api/chat directly got a
model replying "Sure, I'll remind you in 1 minute" - and no reminder.
"""
import json
import uuid

from fastapi.testclient import TestClient


def test_remind_me_through_chat_is_a_real_reminder(monkeypatch, tmp_path):
    import app.main as main
    from app import everyday

    added = []

    class Store:
        def add(self, text, due):
            added.append((text, due))
            return {"id": "r1", "text": text, "due": due.isoformat(), "fired": False}

    monkeypatch.setattr(everyday, "reminders", lambda: Store())

    async def no_model(*a, **k):
        raise AssertionError("a model was asked to pretend")
    monkeypatch.setattr(main, "_auto_cloud_candidates", no_model)

    client = TestClient(main.app, client=("127.0.0.1", 50123))
    response = client.post("/api/chat", json={"session_id": uuid.uuid4().hex,
                                              "prompt": "remind me in 10 minutes to stretch", "model": "auto"})
    assert response.status_code == 200
    text = "".join(json.loads(line).get("token", "") for line in response.text.splitlines() if line.strip())
    assert added and added[0][0] == "stretch"
    assert "remind you" in text and "stretch" in text
