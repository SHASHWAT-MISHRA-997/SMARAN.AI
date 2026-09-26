"""A wrong Telegram token is explained, not just refused."""
import asyncio

import httpx

from app.gateway.telegram_bot import TelegramGateway


def fresh():
    gateway = TelegramGateway()
    return gateway


def test_a_telegram_gateway_api_token_is_recognised_for_what_it_is():
    gateway = fresh()
    assert asyncio.run(gateway.start({"token": "AAFpTwXXXXXXXXXXXXXXXXXXXXXXXXXXUVeb3w"})) is False
    assert "gateway.telegram.org" in gateway.last_error and "@BotFather" in gateway.last_error


def test_a_revoked_bot_token_reports_telegrams_reason(monkeypatch):
    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def get(self, path):
            return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})

        async def aclose(self):
            pass

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    gateway = fresh()
    ok = asyncio.run(gateway.start({"token": "123456789:" + "A" * 35}))
    assert ok is False and "Unauthorized" in gateway.last_error and "/token" in gateway.last_error


def test_an_empty_token_asks_for_one():
    gateway = fresh()
    assert asyncio.run(gateway.start({"token": "  "})) is False
    assert "@BotFather" in gateway.last_error
