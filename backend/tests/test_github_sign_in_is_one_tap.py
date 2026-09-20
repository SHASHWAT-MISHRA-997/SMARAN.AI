"""GitHub sign-in on a desktop build, which is now a browser and not a code.

GitHub OAuth Apps have no PKCE. The token exchange needs a client secret, and
a desktop build installed on someone else's machine cannot hold one, so this
used to be the device-code flow: show eight characters, send the person to
github.com/login/device, have them type it in.

The site holds the secret instead. This process opens the browser at the site,
the site finishes the exchange and hands back an identity sealed against a
challenge, and only the verifier kept here opens it.

Three things are worth holding in place:

* The device-code flow is still there when the site has no secret, so a
  deployment that has not been configured yet keeps a working sign-in rather
  than gaining a broken one.
* Polling a browser-flow ticket must not fall over. The poll loop read
  `next_poll`, which only the device flow sets.
* The seal must be opened with the verifier this process kept, and a state
  nobody issued must not be accepted.
"""

import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import direct_oauth  # noqa: E402


class FakeSite:
    """The Netlify function, as far as this module can tell."""

    def __init__(self, configured=True):
        self.configured = configured
        self.seen = []

    async def request(self, method, url, **kwargs):
        url = str(url)
        self.seen.append((method, url, kwargs))
        if url.endswith("/api/github/config"):
            return httpx.Response(200, json={"configured": self.configured})
        if url.endswith("/api/github/exchange"):
            body = kwargs.get("json") or {}
            if body.get("verifier") and body.get("sealed") == f"sealed-for-{body['verifier']}":
                return httpx.Response(200, json={"user": {
                    "id": "github_4242", "email": "Dev@Example.COM",
                    "username": "Octo Cat", "avatar": "https://x/y.png", "provider": "github"}})
            return httpx.Response(401, json={"error": "no"})
        raise AssertionError(f"unexpected call to {url}")

    async def get(self, url, **kwargs):
        return await self.request("GET", url, **kwargs)


@pytest.fixture
def site(monkeypatch):
    fake = FakeSite()

    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return fake
        async def __aexit__(self, *exc): return False

    monkeypatch.setattr(direct_oauth.httpx, "AsyncClient", Client)
    monkeypatch.setattr(direct_oauth, "_site_github", {})
    return fake


@pytest.fixture
def client(site):
    """The sign-in router, with logins recorded rather than performed."""
    finished = []

    def finish_login(claims, response, request, db):
        finished.append(claims)
        return {"access_token": "session-token", "user": {"email": claims["email"]}}

    router = direct_oauth.make_router(lambda: None, finish_login, lambda: "")
    app = FastAPI()
    app.include_router(router)
    # The router refuses to start this flow for anything but loopback, so the
    # test has to arrive as loopback rather than as TestClient's default peer.
    test_client = TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 51000))
    test_client.finished = finished
    test_client.router = router
    return test_client


def start(client):
    res = client.post("/api/auth/direct/github/start")
    assert res.status_code == 200, res.text
    return res.json()


def test_the_browser_goes_to_the_site_and_not_to_a_code_page(client):
    flow = start(client)
    assert "/api/github/start?" in flow["url"]
    assert "login/device" not in flow["url"]
    # Nothing for anyone to read out or retype.
    assert "user_code" not in flow


def test_the_challenge_travels_and_the_verifier_does_not(client):
    flow = start(client)
    assert "challenge=" in flow["url"]
    assert "verifier" not in flow["url"]


def test_the_site_is_told_to_come_back_to_this_machine_only(client):
    from urllib.parse import parse_qs, urlsplit
    redirect = parse_qs(urlsplit(start(client)["url"]).query)["redirect"][0]
    assert redirect.startswith("http://127.0.0.1:8000/api/auth/direct/github/callback")
    assert "state=" in redirect


def test_polling_a_browser_flow_does_not_fall_over(client):
    """It read next_poll, which only the device flow sets: a 500 on tap one."""
    flow = start(client)
    res = client.post("/api/auth/direct/poll", json={"ticket": flow["ticket"]})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending"


def test_a_completed_sign_in_becomes_a_session(client, site):
    from urllib.parse import parse_qs, urlsplit
    flow = start(client)
    redirect = parse_qs(urlsplit(flow["url"]).query)["redirect"][0]
    state = parse_qs(urlsplit(redirect).query)["state"][0]

    pending = [f for f in _flows(client) if f.get("state") == state][0]
    sealed = f"sealed-for-{pending['verifier']}"

    page = client.get(f"/api/auth/direct/github/callback?state={state}&result={sealed}")
    assert page.status_code == 200
    assert "Sign-in completed" in page.text

    res = client.post("/api/auth/direct/poll", json={"ticket": flow["ticket"]})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "complete"
    assert client.finished[0]["email"] == "dev@example.com"
    assert client.finished[0]["provider"] == "github"


def test_a_state_nobody_issued_is_refused(client):
    start(client)
    res = client.get("/api/auth/direct/github/callback?state=invented&result=whatever")
    assert res.status_code == 400


def test_a_seal_this_machine_cannot_open_is_not_a_sign_in(client):
    from urllib.parse import parse_qs, urlsplit
    flow = start(client)
    redirect = parse_qs(urlsplit(flow["url"]).query)["redirect"][0]
    state = parse_qs(urlsplit(redirect).query)["state"][0]

    # A blob from somewhere else: the site refuses to open it without the
    # matching verifier, and this must surface as a failed sign-in.
    client.get(f"/api/auth/direct/github/callback?state={state}&result=sealed-for-someone-else")
    res = client.post("/api/auth/direct/poll", json={"ticket": flow["ticket"]})
    assert res.status_code == 401
    assert client.finished == []


def test_the_callback_cannot_be_replayed(client):
    from urllib.parse import parse_qs, urlsplit
    flow = start(client)
    redirect = parse_qs(urlsplit(flow["url"]).query)["redirect"][0]
    state = parse_qs(urlsplit(redirect).query)["state"][0]
    pending = [f for f in _flows(client) if f.get("state") == state][0]
    sealed = f"sealed-for-{pending['verifier']}"

    assert client.get(f"/api/auth/direct/github/callback?state={state}&result={sealed}").status_code == 200
    again = client.get(f"/api/auth/direct/github/callback?state={state}&result={sealed}")
    assert again.status_code == 400


def test_a_cancelled_sign_in_says_so(client):
    from urllib.parse import parse_qs, urlsplit
    flow = start(client)
    redirect = parse_qs(urlsplit(flow["url"]).query)["redirect"][0]
    state = parse_qs(urlsplit(redirect).query)["state"][0]

    page = client.get(f"/api/auth/direct/github/callback?state={state}&error=denied")
    assert "could not finish" in page.text
    assert client.post("/api/auth/direct/poll", json={"ticket": flow["ticket"]}).status_code == 401


def test_without_a_secret_on_the_site_the_code_flow_is_still_there(client, site, monkeypatch):
    """An unconfigured deployment keeps a sign-in that works."""
    site.configured = False
    monkeypatch.setattr(direct_oauth, "_site_github", {})
    monkeypatch.setattr(direct_oauth, "github_client_id", lambda: "")
    # No site secret and no GitHub client id is the honest 503, not a crash.
    assert client.post("/api/auth/direct/github/start").status_code == 503


def test_the_site_is_asked_only_once_in_a_while(client, site):
    start(client)
    asked = len([call for call in site.seen if call[1].endswith("/config")])
    start(client)
    assert len([call for call in site.seen if call[1].endswith("/config")]) == asked


def _flows(client):
    """The sign-ins the router currently has in flight."""
    return list(client.router.pending.values())
