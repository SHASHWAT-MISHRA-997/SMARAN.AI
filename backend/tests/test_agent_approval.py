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

    async def refuse(step, *call):
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

    async def allow(step, *call):
        return True

    collect("write hello", tmp_path, allow)
    assert (tmp_path / "hello.txt").read_text() == "hi"


def test_reading_never_waits(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted([READ, "Listed."]))
    asked = []

    async def watch(step, *call):
        asked.append(step)
        return True

    events = collect("look around", tmp_path, watch)
    assert asked == [] and not any(e["type"] == "approval_needed" for e in events)


def test_the_route_resolves_a_waiting_decision():
    from app.agent import routes

    async def go():
        future = asyncio.get_running_loop().create_future()
        routes._approvals["abcdefgh1234:3"] = {"future": future, "name": "run_command", "arguments": {}}
        out = await routes.agent_approve(routes.ApprovalDecision(run_id="abcdefgh1234", step=3, approve=False,
                                                                 note="use port 8000 instead"))
        return out, future.result()

    out, decided = asyncio.run(go())
    assert out["approved"] is False and decided == {"approve": False, "note": "use port 8000 instead"}
    with pytest.raises(Exception):
        asyncio.run(routes.agent_approve(routes.ApprovalDecision(run_id="nothing-waits", step=1, approve=True)))


def test_a_note_with_deny_reaches_the_model(tmp_path, monkeypatch):
    seen = []

    async def ask(messages, model="", provider="", api_key=""):
        seen.append(messages[-1]["content"])
        return WRITE if len(seen) == 1 else "OK."

    monkeypatch.setattr(loop, "_ask_model", ask)

    async def deny(step, *call):
        return {"approve": False, "note": "name it greeting.txt"}

    collect("write hello", tmp_path, deny)
    assert "They said: name it greeting.txt" in seen[-1]
    assert not (tmp_path / "hello.txt").exists()


def test_switching_mode_releases_a_waiting_step(tmp_path, monkeypatch):
    from app.agent import routes, safety
    monkeypatch.setattr(safety.settings, "DATA_DIR", str(tmp_path))
    safety.save({"approval_mode": "manual"})

    async def go():
        future = asyncio.get_running_loop().create_future()
        routes._approvals["runrunrun1:2"] = {"future": future, "name": "run_command",
                                             "arguments": {"command": "npm install left-pad"}}
        safety.save({"approval_mode": "off"})
        released = routes.settle_for_mode()
        routes._approvals.pop("runrunrun1:2", None)
        return released, future.result()

    released, decided = asyncio.run(go())
    assert released == 1 and decided["approve"] is True


def test_live_mode_follows_the_setting_during_a_run(tmp_path, monkeypatch):
    from app.agent import safety
    monkeypatch.setattr(safety.settings, "DATA_DIR", str(tmp_path / "d"))
    safety.save({"approval_mode": "off"})
    monkeypatch.setattr(loop, "_ask_model", scripted([WRITE, "Done."]))
    asked = []

    async def watch(step, *call):
        asked.append(step)
        return True

    async def go():
        return [e async for e in loop.run("write", root=str(tmp_path), approve=watch, mode="live", run_id="livelive1")]

    asyncio.run(go())
    assert asked == [] and (tmp_path / "hello.txt").exists()


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


BAD_EDIT = ('<tool_call name="edit_file">\n<path>a.py</path>\n<find>not there</find>\n'
            '<replace>x</replace>\n</tool_call>')


def test_the_same_failing_step_three_times_stops_the_run(tmp_path, monkeypatch):
    (tmp_path / "a.py").write_text("print(1)\n")
    monkeypatch.setattr(loop, "_ask_model", scripted([BAD_EDIT] * 10))

    events = collect("edit a", tmp_path, None)
    results = [e["result"] for e in events if e["type"] == "tool_result"]
    assert len(results) == 3
    assert "exact call before" in results[1]
    assert events[-1]["type"] == "error" and "kept repeating" in events[-1]["message"]


def test_announcing_a_step_without_doing_it_gets_a_nudge_not_an_ending(tmp_path, monkeypatch):
    monkeypatch.setattr(loop, "_ask_model", scripted(["The file is missing. Let's write it.", WRITE,
                                                      "I have made the change."]))
    events = collect("write hello", tmp_path, None)
    assert (tmp_path / "hello.txt").read_text() == "hi"
    assert events[-1]["type"] == "done"


def test_an_edit_written_on_one_line_with_escaped_breaks_keeps_its_lines():
    slash = chr(92)
    call = loop.parse_tool_call(
        '<tool_call name="edit_file">\n<path>a.py</path>\n'
        '<find>def f():' + slash + 'n    return 1</find>\n'
        '<replace>print("a' + slash + 'nb")</replace>\n</tool_call>')
    assert call["arguments"]["find"] == "def f():\n    return 1"
    # A real escape inside a string literal is left as it is.
    assert call["arguments"]["replace"] == 'print("a' + slash + 'nb")'
