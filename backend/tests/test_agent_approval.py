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
    assert out["approved"] and decided == (True, "")
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


def test_the_task_arrives_with_the_folder_layout(tmp_path, monkeypatch):
    (tmp_path / "calc.py").write_text("x = 1\n")
    seen = []

    async def ask(messages, model="", provider="", api_key=""):
        seen.append(messages[-1]["content"])
        return "Nothing to do."

    monkeypatch.setattr(loop, "_ask_model", ask)
    collect("look", tmp_path, None)
    assert "Files in the open folder" in seen[0] and "calc.py" in seen[0]


def test_a_call_missing_only_its_closing_tag_is_used():
    call = loop.parse_tool_call('<tool_call name="read_file">\n<path>calc.py</path>\n')
    assert call and call["name"] == "read_file" and call["arguments"] == {"path": "calc.py"}
    assert loop.parse_tool_call('<tool_call name="read_file">\n<path>calc.py') is None


def test_a_garbled_call_is_sent_back_instead_of_ending_the_run(tmp_path, monkeypatch):
    (tmp_path / "a.txt").write_text("hello")
    monkeypatch.setattr(loop, "_ask_model", scripted([
        '<tool_call name="read_file"><path',                       # unreadable
        '<tool_call name="read_file">\n<path>a.txt</path>\n</tool_call>',
        "Read it.",
    ]))
    events = collect("read a.txt", tmp_path, None)
    results = [e for e in events if e["type"] == "tool_result"]
    assert results and "hello" in results[0]["result"]
    assert events[-1]["type"] == "done"


def test_every_event_is_json(tmp_path, monkeypatch):
    import json
    from app.agent import skill_creator

    monkeypatch.setattr(loop, "_ask_model", scripted([READ, "Listed the files."]))

    class Skill:
        filepath = str(tmp_path / "skill.md")

    class Creator:
        def extract_skill_from_session(self, **kw):
            return {"name": "list", "description": "d", "steps": ["a"], "triggers": ["t"]}

        def create_skill(self, **kw):
            return Skill()

    monkeypatch.setattr(skill_creator, "get_skill_creator", lambda: Creator())
    events = collect("look around", tmp_path, None)
    for event in events:
        json.dumps(event)
    assert any(e["type"] == "skill_created" and e["path"].endswith("skill.md") for e in events)


def test_what_the_person_types_with_a_refusal_reaches_the_agent(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted([WRITE, "Understood."]))

    async def refuse_with_note(step):
        return (False, "call it greeting.txt instead")

    events = collect("write hello", tmp_path, refuse_with_note)
    assert not (tmp_path / "hello.txt").exists()
    result = next(e for e in events if e["type"] == "tool_result")["result"]
    assert "greeting.txt" in result
    assert next(e for e in events if e["type"] == "approval")["note"] == "call it greeting.txt instead"


def test_what_the_person_types_with_an_allow_reaches_the_agent(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted([WRITE, "Done."]))

    async def allow_with_note(step):
        return (True, "then add a test")

    events = collect("write hello", tmp_path, allow_with_note)
    assert (tmp_path / "hello.txt").read_text() == "hi"
    result = next(e for e in events if e["type"] == "tool_result")["result"]
    assert "then add a test" in result


def test_the_route_passes_the_typed_message(tmp_path):
    from app.agent import routes

    async def go():
        future = asyncio.get_running_loop().create_future()
        routes._approvals["abcdefgh5678:2"] = future
        await routes.agent_approve(routes.ApprovalDecision(
            run_id="abcdefgh5678", step=2, approve=False, message="  use pytest  "))
        return future.result()

    assert asyncio.run(go()) == (False, "use pytest")


def test_a_slow_command_does_not_freeze_the_server(tmp_path, monkeypatch):
    """The tool runs in a thread: the event loop keeps answering meanwhile."""
    import time
    from app.agent import tools as toolbox

    monkeypatch.setattr(loop, "_ask_model", scripted([READ, "Listed."]))
    real = toolbox.execute

    def slow(*a, **k):
        time.sleep(0.4)
        return real(*a, **k)

    monkeypatch.setattr(toolbox, "execute", slow)
    ticks = []

    async def go():
        async def ticker():
            for _ in range(6):
                ticks.append(1)
                await asyncio.sleep(0.05)
        t = asyncio.create_task(ticker())
        events = [e async for e in loop.run("look", root=str(tmp_path))]
        await t
        return events

    asyncio.run(go())
    assert len(ticks) >= 5


def test_no_open_folder_uses_the_projects_folder(tmp_path, monkeypatch):
    from app.agent import tools as toolbox
    monkeypatch.setenv("SMARAN_CODE_HOME", str(tmp_path / "projects"))
    ws = toolbox.workspace_for("")
    assert str(ws.root).endswith("projects")
