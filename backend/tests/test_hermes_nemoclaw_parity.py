"""Comprehensive test suite for Hermes Agent + NVIDIA NemoClaw parity features."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
from pathlib import Path
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.agent import memory as mem_module
from app.agent import skill_creator as skill_module
from app.agent import sandbox as sandbox_module
from app.agent import scheduler as scheduler_module
from app.agent import subagent as subagent_module
from app.agent import tools as toolbox
from app.gateway.webhook_adapter import WebhookGateway


def test_agent_memory_fts_and_user_model(tmp_path):
    db_file = str(tmp_path / "test_mem.db")
    agent_mem = mem_module.AgentMemory(db_path=db_file)

    # 1. Test learning persistence
    row_id = agent_mem.save_learning("sess_1", "User prefers Python type annotations and FastAPI", category="preference")
    assert row_id is not None
    assert row_id > 0

    # 2. Test FTS search
    results = agent_mem.search("FastAPI")
    assert len(results) >= 1
    assert "FastAPI" in results[0]["content"]

    # 3. Test user model
    agent_mem.update_user_model("style", "PEP 8 strict")
    user_model = agent_mem.get_user_model()
    assert user_model.get("style", {}).get("value") == "PEP 8 strict"

    # 4. Test nudge check
    assert agent_mem.should_nudge(6, ["write_file", "edit_file", "run_command"]) is True
    assert agent_mem.should_nudge(2, ["read_file"]) is False


def test_skill_creator(tmp_path):
    creator = skill_module.SkillCreator(skills_dir=str(tmp_path))

    skill = creator.create_skill(
        name="test_skill",
        description="Deploy app to cloud",
        steps=["Step 1: run tests", "Step 2: deploy"],
        triggers=["deploy"]
    )
    assert os.path.exists(skill.filepath)

    # Verify extraction from session
    candidate = creator.extract_skill_from_session(
        task="deploy the project to production",
        steps_taken=6,
        tools_used=["read_file", "edit_file", "run_command"],
        summary="Successfully deployed"
    )
    assert candidate is not None
    assert "deploy" in candidate["triggers"]


def test_scheduler_parsing_and_persistence(tmp_path):
    db_path = tmp_path / "test_scheduler.db"
    store = scheduler_module.SchedulerStore(db_path=db_path)

    # Natural language schedule
    job = store.add_job(
        name="Health Check",
        schedule_expr="every 30 minutes",
        task_prompt="Run curl localhost:8000/api/health",
    )
    assert job.id is not None
    assert job.next_run_ts > time.time()

    jobs = store.list_jobs()
    assert len(jobs) == 1
    assert jobs[0].name == "Health Check"

    # History recording
    store.record_run(job.id, "success", "Healthy 200 OK", 0.5, time.time() + 1800)
    history = store.get_history(job.id)
    assert len(history) == 1
    assert history[0]["status"] == "success"

    # Deletion
    assert store.delete_job(job.id) is True
    assert len(store.list_jobs()) == 0


def test_nemoclaw_sandbox_security_and_snapshots(tmp_path):
    # Setup test workspace
    (tmp_path / "code.py").write_text("print('hello')", encoding="utf-8")
    cfg = sandbox_module.SandboxConfig(mode=sandbox_module.SandboxMode.PERMISSIVE)
    sb = sandbox_module.Sandbox(config=cfg)

    # 1. Dangerous command blocking
    res = sb.run_command("rm -rf /", cwd=str(tmp_path))
    assert res.blocked is True
    assert "Blocked" in res.block_reason or "restricted" in res.block_reason

    # 2. Permissive safe command execution
    res_safe = sb.run_command("python -c \"print('sandbox ok')\"", cwd=str(tmp_path))
    assert "sandbox ok" in res_safe.output

    # 3. Snapshot creation and rollback
    snap = sb.create_snapshot(str(tmp_path), description="Initial checkpoint")
    assert snap.id is not None

    # Modify file
    (tmp_path / "code.py").write_text("BROKEN CODE", encoding="utf-8")
    assert (tmp_path / "code.py").read_text(encoding="utf-8") == "BROKEN CODE"

    # Roll back to snapshot
    restore_res = sb.restore_snapshot(snap.id, str(tmp_path))
    assert restore_res["success"] is True
    assert (tmp_path / "code.py").read_text(encoding="utf-8") == "print('hello')"


def test_subagent_delegation():
    mgr = subagent_module.SubagentManager()
    task = mgr.create_subagent(
        instruction="Inspect logs",
        parent_id="root",
        tools_allowed={"read_file", "search"},
        step_budget=10
    )
    assert task.id is not None
    assert task.status == "pending"

    active = mgr.get_active_tasks()
    assert len(active) == 1
    assert active[0].id == task.id

    assert mgr.cancel_task(task.id) is True


def test_webhook_adapter():
    async def _run():
        gateway = WebhookGateway.get_instance()
        await gateway.start({"callback_url": ""})
        res = await gateway.handle_incoming("generic", {"prompt": "Run tests"})
        assert res["status"] == "accepted"

    asyncio.run(_run())
