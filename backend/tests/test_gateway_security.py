"""Chat bots run the agent on this computer: only paired owners may command them."""
import asyncio

import pytest

from app.gateway import owners
from app.gateway.telegram_bot import TelegramGateway, token_problem


@pytest.fixture
def gw(tmp_path, monkeypatch):
    monkeypatch.setattr(owners, "_path", lambda: str(tmp_path / "owners.json"))
    g = TelegramGateway()
    sent, ran = [], []

    async def send(chat, text):
        sent.append(text)
        return True

    async def run(chat, prompt):
        ran.append(prompt)
    g.send_message = send
    g._run_agent_task = run
    return g, sent, ran


def _msg(user, text):
    return {"message": {"chat": {"id": user}, "from": {"id": user}, "text": text}}


def _drain():
    async def z():
        await asyncio.sleep(0)
    return z()


def test_a_stranger_cannot_run_anything(gw):
    g, sent, ran = gw
    asyncio.run(g._handle_update(_msg(111, "run rm -rf / please")))
    assert ran == [] and "private" in sent[-1]


def test_pairing_with_the_code_makes_an_owner(gw):
    g, sent, ran = gw
    code = g.pairing.code
    asyncio.run(g._handle_update(_msg(222, f"/pair {code}")))
    assert "Paired" in sent[-1] and g.pairing.is_owner(222)
    assert g.pairing.code != code                      # a code works once

    async def go():
        await g._handle_update(_msg(222, "what time is it"))
        await asyncio.sleep(0)
    asyncio.run(go())
    assert ran == ["what time is it"]


def test_the_code_cannot_be_guessed(gw):
    g, sent, _ = gw
    code = g.pairing.code
    wrong = [f"{(int(code) + i) % 10**6:06d}" for i in range(1, 7)]
    for attempt in wrong:
        asyncio.run(g._handle_update(_msg(333, f"/pair {attempt}")))
    asyncio.run(g._handle_update(_msg(333, f"/pair {g.pairing.code}")))
    assert "Too many" in sent[-1] and not g.pairing.is_owner(333)


def test_many_guessers_kill_the_code(gw):
    g, _, _ = gw
    code = g.pairing.code
    for user in range(20):
        g.pairing.try_pair(1000 + user, "000000" if code != "000000" else "111111")
    assert g.pairing.code != code


def test_the_gateway_telegram_org_token_is_named():
    assert "BotFather" in token_problem("AAFpTwxyzUVeb3w1234567890abcdefghij")
    assert "gateway.telegram.org" in token_problem("AAFpTwxyzUVeb3w1234567890abcdefghij")
    assert token_problem("123456789:AAEhBP0av28abcdefghijklmnopqrstuvwxyz") == ""
    assert token_problem("")


def test_start_reports_why(monkeypatch):
    g = TelegramGateway()
    assert asyncio.run(g.start({"token": "not-a-token"})) is False
    assert "BotFather" in g.last_error


def test_webhook_needs_a_secret():
    from app.gateway.webhook_adapter import WebhookGateway
    w = WebhookGateway()
    asyncio.run(w.start({}))
    assert len(w.secret_token) >= 20
