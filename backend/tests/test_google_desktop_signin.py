"""Google sign-in on the desktop: Google needs the desktop client's secret.

Without it Google's token endpoint answers "client_secret is missing" - after
the person has already chosen an account - and the page said "Sign-in could
not finish". These tests pin: no secret, no start; with one, the token
request carries it; and it never appears in anything sent back.
No request reaches Google: httpx is replaced.
"""
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app

FAKE_SECRET = "test-only-not-a-real-secret"


def client():
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50200))


def test_without_the_secret_sign_in_does_not_start(monkeypatch):
    monkeypatch.delenv("SMARAN_GOOGLE_DESKTOP_CLIENT_SECRET", raising=False)
    monkeypatch.setattr("app.oauth_config.GOOGLE_DESKTOP_CLIENT_SECRET", "", raising=False)
    reply = client().post("/api/auth/direct/google/start")
    assert reply.status_code == 503
    assert "not set up" in reply.json()["detail"]


def test_with_the_secret_the_token_request_carries_it(monkeypatch):
    monkeypatch.setenv("SMARAN_GOOGLE_DESKTOP_CLIENT_SECRET", FAKE_SECRET)
    seen = {}

    async def fake_request(self, method, url, **kwargs):
        if url.endswith("/token"):
            seen["token_form"] = kwargs.get("data", {})
            return httpx.Response(400, json={"error": "invalid_grant"})
        raise AssertionError("unexpected call " + url)

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)
    c = client()
    start = c.post("/api/auth/direct/google/start")
    assert start.status_code == 200
    body = start.text
    assert FAKE_SECRET not in body
    state = parse_qs(urlparse(start.json()["url"]).query)["state"][0]

    page = c.get("/api/auth/direct/google/callback", params={"state": state, "code": "abc"})
    assert page.status_code == 200
    assert seen["token_form"]["client_secret"] == FAKE_SECRET
    assert FAKE_SECRET not in page.text


@pytest.mark.parametrize("host", ["192.168.1.9"])
def test_sign_in_starts_only_from_this_computer(monkeypatch, host):
    monkeypatch.setenv("SMARAN_GOOGLE_DESKTOP_CLIENT_SECRET", FAKE_SECRET)
    stranger = TestClient(app, base_url="http://127.0.0.1", client=(host, 50201))
    assert stranger.post("/api/auth/direct/google/start").status_code == 400
