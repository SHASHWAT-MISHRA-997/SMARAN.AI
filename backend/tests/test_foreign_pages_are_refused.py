"""A web page that is not SMARAN.AI cannot drive it (app/origin_guard.py).

Any site the owner visited could POST text/plain to 127.0.0.1 - no CORS
preflight for a "simple" request - and /api/terminal/run, parsing the body as
JSON regardless, ran the command as the owner. WebSockets skip CORS entirely.
A public domain resolving to 127.0.0.1 (DNS rebinding) was the same page with
a local-looking address.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402

local = TestClient(app, client=("127.0.0.1", 50001), raise_server_exceptions=False)


def test_a_foreign_site_cannot_post_a_command_as_plain_text():
    res = local.post("/api/terminal/run", content='{"command": "echo pwned", "source": "user"}',
                     headers={"content-type": "text/plain", "origin": "https://evil.example"})
    assert res.status_code == 403
    assert b"pwned" not in res.content


def test_a_page_on_another_lan_device_cannot_act_as_the_owner():
    res = local.post("/api/control/session", json={},
                     headers={"origin": "http://192.168.1.99"})
    assert res.status_code == 403


def test_dns_rebinding_is_refused():
    res = local.get("/api/auth/me", headers={"host": "rebind.evil.example:8000"})
    assert res.status_code == 403


def test_a_foreign_websocket_is_closed():
    with pytest.raises(WebSocketDisconnect):
        with local.websocket_connect("/ws/telemetry", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_text()


@pytest.mark.parametrize("origin", ["http://127.0.0.1:8000", "http://localhost:3003",
                                    "https://localhost", "capacitor://localhost"])
def test_the_apps_own_pages_still_work(origin):
    res = local.post("/api/control/session", json={}, headers={"origin": origin})
    assert res.status_code == 200


def test_tools_that_send_no_origin_still_work():
    assert local.post("/api/control/session", json={}).status_code == 200


def test_the_paired_phone_origin_is_accepted_from_the_network():
    phone = TestClient(app, client=("192.168.1.20", 50002), raise_server_exceptions=False)
    res = phone.get("/api/auth/me", headers={"origin": "https://localhost"})
    assert res.status_code != 403  # 401 without a token - but not refused as foreign
