"""Jev (TypeSafe) as a second opinion: it can add caution, never remove it."""
import asyncio

import httpx
import pytest

from app import jev
from app.agent import loop, safety


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def _answer(p):
    return lambda *a, **k: _Resp(200, {"model": "jev-1.13.0", "answers": {"risky": {"type": "noul", "noul": p}}})


def test_no_key_no_call(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setattr(httpx, "post", lambda *a, **k: pytest.fail("called without a key"))
    assert jev.risky("x", "y") is None
    assert safety.jev_caution("write_file", {"path": "a.py", "content": "x"}) is None


def test_the_request_has_the_documented_shape(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-test")
    seen = {}

    def post(url, **kw):
        seen.update(url=url, **kw)
        return _answer(0.2)()
    monkeypatch.setattr(httpx, "post", post)
    assert jev.risky("state", "question?") == 0.2
    assert seen["url"] == "https://api.typesafe.ai/v1/systemone"
    assert seen["headers"]["Authorization"] == "Bearer ts-test"
    assert seen["json"]["questions"]["risky"] == {"type": "noul", "instructions": "question?"}


def test_failures_are_no_opinion(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-test")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
    assert jev.risky("s", "q") is None
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(500, {}))
    assert jev.risky("s", "q") is None


def test_a_bad_key_is_refused(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(401, {}))
    with pytest.raises(PermissionError):
        jev.verify("bad")


def test_smart_mode_asks_when_jev_says_risky(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-test")
    monkeypatch.setattr(httpx, "post", _answer(0.9))
    replies = iter(['<tool_call name="write_file">\n<path>auth.py</path>\n<content>ALLOW_ALL = True</content>\n</tool_call>', "ok"])

    async def ask(*a, **k):
        return next(replies)
    monkeypatch.setattr(loop, "_ask_model", ask)
    asked = []

    async def approve(step):
        asked.append(step)
        return (False, "")

    async def go():
        return [e async for e in loop.run("x", root=str(tmp_path), approve=approve, mode="smart")]
    events = asyncio.run(go())
    needed = next(e for e in events if e["type"] == "approval_needed")
    assert asked == [1] and "Jev" in needed["reason"]
    assert not (tmp_path / "auth.py").exists()


def test_smart_mode_runs_when_jev_says_safe(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-test")
    monkeypatch.setattr(httpx, "post", _answer(0.05))
    replies = iter(['<tool_call name="write_file">\n<path>notes.txt</path>\n<content>hi</content>\n</tool_call>', "ok"])

    async def ask(*a, **k):
        return next(replies)
    monkeypatch.setattr(loop, "_ask_model", ask)

    async def go():
        return [e async for e in loop.run("x", root=str(tmp_path), approve=None, mode="smart")]
    asyncio.run(go())
    assert (tmp_path / "notes.txt").read_text() == "hi"


def test_computer_use_asks_when_jev_says_risky(monkeypatch):
    from app import computer_agent as ca
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-test")
    monkeypatch.setattr(httpx, "post", _answer(0.8))
    assert "Jev" in ca.second_opinion("tidy up", {"action": "click", "x": 1, "y": 1, "thought": "press the blue button"})
    monkeypatch.setattr(httpx, "post", _answer(0.1))
    assert ca.second_opinion("tidy up", {"action": "click", "x": 1, "y": 1}) is None


def test_replicate_and_typesafe_keys_are_actually_checked(monkeypatch):
    """They are not in the chat endpoint table; they used to be refused as
    "unsupported" before any check ran."""
    from app import main
    called = []

    async def replicate(key):
        called.append(key)
        return ["owner/model"]
    monkeypatch.setattr(main, "_fetch_replicate_models", replicate)
    monkeypatch.setattr(jev, "verify", lambda key: called.append(key) or True)
    assert asyncio.run(main._fetch_cloud_provider_models("replicate", "r8_x")) == (["owner/model"], False)
    assert asyncio.run(main._fetch_cloud_provider_models("typesafe", "ts_x")) == (["jev-latest"], False)
    assert called == ["r8_x", "ts_x"]
