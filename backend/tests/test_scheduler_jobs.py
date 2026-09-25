"""Scheduled jobs actually run, safely, and reach the owner."""
import asyncio
import time
from datetime import datetime

import pytest

from app.agent import scheduler as sched


@pytest.fixture
def store(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "DATA_DIR", str(tmp_path / "data"))
    s = sched.SchedulerStore(db_path=tmp_path / "jobs.db")
    runner = sched.AutomationScheduler.__new__(sched.AutomationScheduler)
    runner.store = s
    runner._active_jobs = {}
    return s, runner


@pytest.mark.parametrize("expr,weekday,hour", [
    ("every monday at 09:00", 0, 9), ("every friday at 17:30", 4, 17), ("weekdays at 08:30", None, 8),
])
def test_weekly_schedules(expr, weekday, hour):
    when = datetime.fromtimestamp(sched._parse_schedule_to_next_ts(expr))
    assert when.hour == hour and when > datetime.now()
    if weekday is not None:
        assert when.weekday() == weekday
    else:
        assert when.weekday() < 5


def test_impossible_schedules_are_refused():
    for expr in ("every sunday at 25:00", "whenever", "every blursday at 09:00"):
        with pytest.raises(ValueError):
            sched._parse_schedule_to_next_ts(expr)


def test_every_blueprint_is_a_valid_job():
    for bp in sched.BLUEPRINTS:
        assert sched._parse_schedule_to_next_ts(bp["schedule"]) > time.time(), bp["id"]
        assert bp["channel"] in {"ui", "phone"}
        assert bp["name"] and bp["prompt"]


def test_a_job_without_a_project_is_researched_and_reaches_the_phone(store, monkeypatch):
    s, runner = store
    job = s.add_job(name="Briefing", schedule_expr="daily at 08:00", task_prompt="brief me", target_channel="phone")

    async def answer(prompt, model="", provider=""):
        return "Sunny, 31C. Headlines: A, B, C."

    monkeypatch.setattr(sched, "research_answer", answer)
    sent = []
    import app.companion as companion
    monkeypatch.setattr(companion, "notify_paired_devices", lambda text: sent.append(text) or 1)

    out = asyncio.run(runner._execute_job(job.id))
    assert out["status"] == "success" and "Sunny" in out["output"]
    assert sent and sent[0].startswith("Briefing: Sunny")
    assert s.get_history(job.id)[0]["status"] == "success"


def test_a_project_job_runs_the_agent_in_smart_mode_with_a_step_cap(store, monkeypatch, tmp_path):
    s, runner = store
    job = s.add_job(name="Health", schedule_expr="daily at 09:30", task_prompt="run tests",
                    workspace_root=str(tmp_path))
    seen = {}

    async def fake_run(task, model="", provider="", root="", mode=None, max_steps=0, **kw):
        seen.update(root=root, mode=mode, max_steps=max_steps)
        yield {"type": "message", "text": "2 passed."}

    import app.agent.loop as agent_loop
    monkeypatch.setattr(agent_loop, "run", fake_run)
    out = asyncio.run(runner._execute_job(job.id))
    assert out["output"] == "2 passed."
    assert seen == {"root": str(tmp_path), "mode": "smart", "max_steps": 15}


def test_resuming_a_paused_job_waits_for_its_next_time(store):
    s, _ = store
    job = s.add_job(name="Nudge", schedule_expr="every 2 hours", task_prompt="drink water")
    with s._get_conn() as conn:
        conn.execute("UPDATE jobs SET next_run_ts = ? WHERE id = ?", (time.time() - 86400, job.id))
        conn.commit()
    s.toggle_job(job.id, False)
    s.toggle_job(job.id, True)
    assert s.get_job(job.id).next_run_ts > time.time() + 3600


def test_unknown_delivery_channels_are_refused(store):
    s, _ = store
    with pytest.raises(ValueError):
        s.add_job(name="x", schedule_expr="every 1 hour", task_prompt="y", target_channel="fax")


def test_a_briefing_searches_first_and_answers_once(monkeypatch):
    import app.web_search as ws
    from app.agent import models as backends

    monkeypatch.setattr(ws, "perform_web_search", lambda q, n=6: [
        {"title": "AI model released", "url": "https://example.com/a", "snippet": "A new model shipped today."}])
    seen = {}

    async def complete(messages, model="", provider="", api_key="", attempts=2):
        seen["messages"] = messages
        return "- A new model shipped today (example.com)"

    monkeypatch.setattr(backends, "complete", complete)
    out = asyncio.run(sched.research_answer("news about AI today", model="m"))
    assert out.startswith("- A new model")
    assert "https://example.com/a" in seen["messages"][-1]["content"]
    assert "ONLY the search results" in seen["messages"][0]["content"]


def test_a_reminder_does_not_search(monkeypatch):
    import app.web_search as ws
    from app.agent import models as backends

    monkeypatch.setattr(ws, "perform_web_search", lambda *a, **k: (_ for _ in ()).throw(AssertionError("searched")))

    async def complete(messages, **kw):
        return "Drink some water."

    monkeypatch.setattr(backends, "complete", lambda messages, model="", provider="", api_key="", attempts=2: complete(messages))
    assert asyncio.run(sched.research_answer("remind me to drink water", model="m")) == "Drink some water."
