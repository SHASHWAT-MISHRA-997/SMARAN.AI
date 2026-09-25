"""Code mode's "Ask for approval": a change waits for the person, and a refusal really stops it."""
import asyncio

import pytest

from app.agent import loop


def scripted(replies):
    it = iter(replies)

    async def ask(messages, model="", provider="", api_key=""):
        return next(it)
    return ask


WRITE = '<tool_call name="write_file">\n<path>hello.txt</path>\n<content>hi</content>\n</tool_call>'
READ = '<tool_call name="list_files">\n<path>.</path>\n</tool_call>'


def collect(task, root, approve):
    async def go():
        return [e async for e in loop.run(task, root=str(root), approve=approve)]
    return asyncio.run(go())


def test_a_refused_change_is_not_made(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted([WRITE, "I did not write it."]))
    asked = []

    async def refuse(step):
        asked.append(step)
        return False

    events = collect("write hello", tmp_path, refuse)
    assert asked == [1]
    assert not (tmp_path / "hello.txt").exists()
    kinds = [e["type"] for e in events]
    assert kinds.index("approval_needed") < kinds.index("approval") < kinds.index("tool_result")
    result = next(e for e in events if e["type"] == "tool_result")["result"]
    assert "declined" in result


def test_an_allowed_change_is_made(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted([WRITE, "Wrote hello.txt."]))

    async def allow(step):
        return True

    collect("write hello", tmp_path, allow)
    assert (tmp_path / "hello.txt").read_text() == "hi"


def test_reading_never_waits(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted([READ, "Listed."]))
    asked = []

    async def watch(step):
        asked.append(step)
        return True

    events = collect("look around", tmp_path, watch)
    assert asked == [] and not any(e["type"] == "approval_needed" for e in events)


def test_the_route_resolves_a_waiting_decision():
    from app.agent import routes

    async def go():
        future = asyncio.get_running_loop().create_future()
        routes._approvals["abcdefgh1234:3"] = future
        out = await routes.agent_approve(routes.ApprovalDecision(run_id="abcdefgh1234", step=3, approve=True))
        return out, future.result()

    out, decided = asyncio.run(go())
    assert out["approved"] and decided is True
    with pytest.raises(Exception):
        asyncio.run(routes.agent_approve(routes.ApprovalDecision(run_id="nothing-waits", step=1, approve=True)))


def test_saved_keys_are_used_for_cloud_providers(monkeypatch):
    from app.agent import models

    seen = {}
    monkeypatch.setenv("TOGETHER_API_KEY", "saved-key")
    monkeypatch.setattr(models, "_openai_style", lambda base, model, key, messages: seen.update(base=base, key=key) or "ok")
    assert asyncio.run(models.complete([{"role": "user", "content": "hi"}], "m", "together")) == "ok"
    assert seen == {"base": "https://api.together.xyz/v1", "key": "saved-key"}
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    with pytest.raises(models.ProviderError, match="No mistral key"):
        asyncio.run(models.complete([{"role": "user", "content": "hi"}], "m", "mistral"))
