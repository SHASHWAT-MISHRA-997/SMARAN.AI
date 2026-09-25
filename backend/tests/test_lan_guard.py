"""Another computer on the Wi-Fi gets nothing from the API without a credential."""
import asyncio

import pytest

from app.lan_guard import LanGuard, credentials, is_public


def run(path, client="192.168.1.50", headers=(), query=b"", kind="http", validate=lambda p, s: False):
    reached, sent = [], []

    async def app(scope, receive, send):
        reached.append(scope["path"])

    async def send(message):
        sent.append(message)

    scope = {"type": kind, "path": path, "client": (client, 5000), "headers": list(headers), "query_string": query}
    asyncio.run(LanGuard(app, validate=validate)(scope, None, send))
    return reached, sent


@pytest.mark.parametrize("path", ["/api/agent/run", "/api/plugins/install", "/api/mcp/servers", "/api/office/message",
                                  "/api/lock/disable", "/api/sites", "/api/video/generate", "/api/workspace/open"])
def test_a_stranger_on_the_network_is_refused(path):
    reached, sent = run(path)
    assert not reached and sent[0]["status"] == 401


def test_websockets_from_a_stranger_are_closed():
    reached, sent = run("/ws/voice/live", kind="websocket")
    assert not reached and sent[0] == {"type": "websocket.close", "code": 4401}


def test_this_computer_is_the_owner():
    reached, _ = run("/api/agent/run", client="127.0.0.1")
    assert reached == ["/api/agent/run"]


def test_a_paired_phone_or_a_session_gets_in():
    ok = lambda paired, session: paired == "good" or session == "sess"
    assert run("/api/sites", headers=[(b"x-companion-token", b"good")], validate=ok)[0]
    assert run("/ws/voice/live", query=b"companion_token=good", kind="websocket", validate=ok)[0]
    assert run("/api/sites", headers=[(b"authorization", b"Bearer sess")], validate=ok)[0]
    assert run("/api/sites", headers=[(b"cookie", b"a=1; session_token=sess")], validate=ok)[0]
    assert not run("/api/sites", headers=[(b"x-companion-token", b"stale")], validate=ok)[0]


@pytest.mark.parametrize("path", ["/api/auth/login", "/api/companion/pairing/claim", "/api/companion/sync",
                                  "/api/agent/gateway/webhook/telegram", "/health", "/", "/assets/index.js"])
def test_sign_in_pairing_and_the_page_itself_stay_reachable(path):
    reached, _ = run(path)
    assert reached == [path]


def test_public_prefixes_do_not_leak_to_neighbours():
    assert not is_public("/api/companion/syncx")
    assert not is_public("/api/authz")
    assert is_public("/api/auth/login")


def test_credentials_are_read_from_every_place_the_app_sends_them():
    scope = {"headers": [(b"cookie", b"session_token=abc")], "query_string": b"companion_token=xyz"}
    assert credentials(scope) == ("xyz", "abc")


def test_a_cors_preflight_passes_but_the_request_after_it_is_checked():
    reached, sent = [], []

    async def app(scope, receive, send):
        reached.append(scope["method"])

    async def send(message):
        sent.append(message)

    guard = LanGuard(app, validate=lambda p, s: p == "good")
    base = {"type": "http", "path": "/api/chat", "client": ("192.168.1.4", 5000), "query_string": b""}
    asyncio.run(guard(dict(base, method="OPTIONS", headers=[]), None, send))
    asyncio.run(guard(dict(base, method="POST", headers=[]), None, send))
    asyncio.run(guard(dict(base, method="POST", headers=[(b"x-companion-token", b"good")]), None, send))
    assert reached == ["OPTIONS", "POST"]          # preflight, then only the POST with a token
    assert sent[0]["status"] == 401
