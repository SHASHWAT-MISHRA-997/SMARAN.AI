"""A cloud model picked by hand is sent with the key saved on this computer.

The screen sends `cloud_api_key: null` when the key lives on the backend. The
route turned that into the text "None" and sent it as the key, so every
hand-picked cloud model answered "Wrong API Key" and the reply silently came
from some other model.
"""
import json
import uuid

import httpx
from fastapi.testclient import TestClient


class _Stream:
    def __init__(self, headers):
        self.status_code = 200
        self.sent_headers = headers

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def aiter_lines(self):
        yield 'data: ' + json.dumps({"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]})
        yield 'data: ' + json.dumps({"choices": [], "usage": {"completion_tokens": 1}})
        yield 'data: [DONE]'

    async def aread(self):
        return b"{}"


def test_a_pinned_cloud_model_sends_the_saved_key_not_none(monkeypatch):
    import app.main as main
    from app import model_router

    seen = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, headers=None, json=None, **kwargs):
            seen.append((url, (headers or {}).get("Authorization", "")))
            return _Stream(headers)

    monkeypatch.setenv("CEREBRAS_API_KEY", "saved-test-key")
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)

    async def no_auto(task=""):
        return []

    monkeypatch.setattr(main, "_auto_cloud_candidates", no_auto)
    monkeypatch.setattr(model_router, "blocked", lambda provider, model: None)

    client = TestClient(main.app, client=("127.0.0.1", 50123))
    response = client.post("/api/chat", json={
        "session_id": uuid.uuid4().hex, "prompt": "Write a Python function that adds two numbers.",
        "model": "gpt-oss-120b", "cloud_provider": "cerebras", "cloud_model": "gpt-oss-120b",
        "cloud_api_key": None,
    })
    assert response.status_code == 200
    cerebras = [auth for url, auth in seen if "cerebras" in url]
    assert cerebras and cerebras[0] == "Bearer saved-test-key"
