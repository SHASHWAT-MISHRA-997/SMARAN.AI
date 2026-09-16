"""HTTP surface for the SMARAN.AI coding agent (Hermes & NemoClaw Parity).

Provides endpoints for:
- Agent planning & execution streaming
- Cross-session memory search and retrieval
- Autonomous skill creation and catalog
- Scheduled automations (cron & natural language)
- Sandbox controls, snapshots & restores
- Subagent delegation management
- Multi-platform gateway management & webhook receiver
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.agent import loop

logger = logging.getLogger("agent.routes")

router = APIRouter(prefix="/api/agent", tags=["agent"])


class AgentRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=20000)
    model: str = ""
    history: Optional[List[dict]] = None
    provider: str = ""
    api_key: str = ""
    root: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Core Agent & Tools
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/tools")
async def list_tools():
    """What the agent can do, in the words the model is given."""
    from app.agent import tools as toolbox

    return {
        "tools": [
            {"name": name, "arguments": args, "description": description,
             "changes_things": name in toolbox.MUTATING}
            for name, (_, args, description) in toolbox.TOOLS.items()
        ],
        "note": ("Every tool returns its result to the model, which is what "
                 "lets it correct itself. Tools marked as changing things "
                 "write files or run commands."),
    }


@router.post("/plan")
async def agent_plan(request: AgentRequest):
    """What the agent intends to do. Nothing is touched by this."""
    try:
        return {"plan": await loop.plan(request.task, request.model,
                                        request.provider, request.api_key)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)[:300]) from exc


@router.post("/run")
async def agent_run(request: AgentRequest):
    """Carry out the task, streaming each step as it happens."""

    async def stream():
        try:
            async for event in loop.run(request.task, request.model, request.history,
                                        request.provider, request.api_key,
                                        request.root):
                yield json.dumps(event) + "\n"
        except Exception as exc:  # noqa: BLE001
            logger.exception("agent run failed")
            yield json.dumps({"type": "error", "message": str(exc)[:300]}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


# ─────────────────────────────────────────────────────────────────────────────
# Cross-Session Memory & User Model (Hermes Parity)
# ─────────────────────────────────────────────────────────────────────────────

class MemorySearchRequest(BaseModel):
    query: str
    limit: int = 10


class MemorySaveRequest(BaseModel):
    content: str
    category: str = "general"
    session_id: str = "manual"


@router.get("/memory/user-model")
async def get_user_model():
    """Returns the agent's evolving model of user preferences and style."""
    from app.agent.memory import get_memory
    return {"user_model": get_memory().get_user_model()}


@router.post("/memory/search")
async def search_memory(req: MemorySearchRequest):
    """Full-text search across past agent sessions and learnings."""
    from app.agent.memory import get_memory
    results = get_memory().search(req.query, limit=req.limit)
    return {"query": req.query, "count": len(results), "results": results}


@router.post("/memory/save")
async def save_memory(req: MemorySaveRequest):
    """Manually persist a learning or preference into cross-session memory."""
    from app.agent.memory import get_memory
    row_id = get_memory().save_learning(req.session_id, req.content, category=req.category)
    return {"status": "saved", "id": row_id}


# ─────────────────────────────────────────────────────────────────────────────
# Autonomous Skills (Hermes Parity)
# ─────────────────────────────────────────────────────────────────────────────

class CreateSkillRequest(BaseModel):
    name: str
    description: str
    steps: List[str]
    triggers: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)


@router.get("/skills")
async def list_skills():
    """List all autonomous and learned skills."""
    from app.agent.skill_creator import get_skill_creator
    skills = get_skill_creator().list_skills()
    return {"skills": skills, "total": len(skills)}


@router.post("/skills")
async def create_skill(req: CreateSkillRequest):
    """Register a new autonomous skill."""
    from app.agent.skill_creator import get_skill_creator
    filepath = get_skill_creator().create_skill(
        name=req.name,
        description=req.description,
        steps=req.steps,
        triggers=req.triggers,
        tags=req.tags
    )
    return {"status": "created", "path": filepath, "name": req.name}


# ─────────────────────────────────────────────────────────────────────────────
# Scheduled Automations (Hermes Parity)
# ─────────────────────────────────────────────────────────────────────────────

class CreateJobRequest(BaseModel):
    name: str
    schedule_expr: str
    task_prompt: str
    model: str = ""
    provider: str = ""
    workspace_root: str = ""
    target_channel: str = "ui"
    target_recipient: str = ""


@router.get("/scheduler/jobs")
async def list_scheduled_jobs():
    """List all scheduled tasks and next run times."""
    from app.agent.scheduler import AutomationScheduler
    jobs = AutomationScheduler.get_instance().store.list_jobs()
    return {"jobs": [j.__dict__ for j in jobs]}


@router.post("/scheduler/jobs")
async def create_scheduled_job(req: CreateJobRequest):
    """Create a new recurring or one-shot scheduled automation."""
    from app.agent.scheduler import AutomationScheduler
    job = AutomationScheduler.get_instance().store.add_job(
        name=req.name,
        schedule_expr=req.schedule_expr,
        task_prompt=req.task_prompt,
        model=req.model,
        provider=req.provider,
        workspace_root=req.workspace_root,
        target_channel=req.target_channel,
        target_recipient=req.target_recipient,
    )
    return {"status": "created", "job": job.__dict__}


@router.delete("/scheduler/jobs/{job_id}")
async def delete_scheduled_job(job_id: str):
    """Delete a scheduled automation."""
    from app.agent.scheduler import AutomationScheduler
    deleted = AutomationScheduler.get_instance().store.delete_job(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "deleted", "job_id": job_id}


@router.post("/scheduler/jobs/{job_id}/run")
async def run_scheduled_job_now(job_id: str):
    """Trigger immediate execution of a scheduled automation."""
    from app.agent.scheduler import AutomationScheduler
    result = await AutomationScheduler.get_instance().run_job_now(job_id)
    return result


@router.get("/scheduler/jobs/{job_id}/history")
async def get_job_history(job_id: str):
    """Fetch execution history for a scheduled task."""
    from app.agent.scheduler import AutomationScheduler
    history = AutomationScheduler.get_instance().store.get_history(job_id)
    return {"job_id": job_id, "history": history}


# ─────────────────────────────────────────────────────────────────────────────
# Sandboxed Execution & Snapshots (NemoClaw Parity)
# ─────────────────────────────────────────────────────────────────────────────

class SnapshotCreateRequest(BaseModel):
    root: str
    description: str = ""


class SnapshotRestoreRequest(BaseModel):
    snapshot_id: str
    root: str


@router.get("/sandbox/status")
async def get_sandbox_status():
    """Get current sandbox isolation mode and security configuration."""
    from app.agent.sandbox import get_sandbox
    sb = get_sandbox()
    return {
        "mode": sb.config.mode.value,
        "timeout_seconds": sb.config.timeout_seconds,
        "allowed_hosts": sb.config.allowed_hosts,
        "snapshots_count": len(sb.list_snapshots()),
    }


@router.get("/sandbox/snapshots")
async def list_snapshots():
    """List all workspace checkpoint snapshots."""
    from app.agent.sandbox import get_sandbox
    return {"snapshots": get_sandbox().list_snapshots()}


@router.post("/sandbox/snapshots")
async def create_snapshot(req: SnapshotCreateRequest):
    """Create a workspace snapshot."""
    from app.agent.sandbox import get_sandbox
    snap = get_sandbox().create_snapshot(req.root, description=req.description)
    return {"status": "created", "id": snap.id, "files_count": len(snap.file_checksums)}


@router.post("/sandbox/restore")
async def restore_snapshot(req: SnapshotRestoreRequest):
    """Restore workspace to a saved snapshot."""
    from app.agent.sandbox import get_sandbox
    res = get_sandbox().restore_snapshot(req.snapshot_id, req.root)
    return res


# ─────────────────────────────────────────────────────────────────────────────
# Subagents (Hermes Parity)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/subagents")
async def list_active_subagents():
    """List all active subagents and their current statuses."""
    from app.agent.subagent import get_subagent_manager
    mgr = get_subagent_manager()
    tasks = mgr.get_active_tasks()
    return {"active_subagents": [t.__dict__ for t in tasks]}


# ─────────────────────────────────────────────────────────────────────────────
# Multi-Platform Gateway (Hermes Parity)
# ─────────────────────────────────────────────────────────────────────────────

class GatewayStartRequest(BaseModel):
    token: Optional[str] = None
    default_chat_id: Optional[str] = None
    default_channel_id: Optional[str] = None
    secret_token: Optional[str] = None
    callback_url: Optional[str] = None


@router.get("/gateway/status")
async def get_gateway_status():
    """Check running status of Telegram, Discord, and Webhook gateways."""
    from app.gateway.telegram_bot import TelegramGateway
    from app.gateway.discord_bot import DiscordGateway
    from app.gateway.webhook_adapter import WebhookGateway

    return {
        "telegram": {"running": TelegramGateway.get_instance().is_running()},
        "discord": {"running": DiscordGateway.get_instance().is_running()},
        "webhook": {"running": WebhookGateway.get_instance().is_running()},
    }


@router.post("/gateway/{platform}/start")
async def start_gateway(platform: str, req: GatewayStartRequest):
    """Start Telegram, Discord, or Webhook adapter."""
    config = req.model_dump(exclude_none=True)
    if platform == "telegram":
        from app.gateway.telegram_bot import TelegramGateway
        ok = await TelegramGateway.get_instance().start(config)
        return {"platform": platform, "started": ok}
    elif platform == "discord":
        from app.gateway.discord_bot import DiscordGateway
        ok = await DiscordGateway.get_instance().start(config)
        return {"platform": platform, "started": ok}
    elif platform == "webhook":
        from app.gateway.webhook_adapter import WebhookGateway
        ok = await WebhookGateway.get_instance().start(config)
        return {"platform": platform, "started": ok}
    else:
        raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")


@router.post("/gateway/{platform}/stop")
async def stop_gateway(platform: str):
    """Stop Telegram, Discord, or Webhook adapter."""
    if platform == "telegram":
        from app.gateway.telegram_bot import TelegramGateway
        await TelegramGateway.get_instance().stop()
    elif platform == "discord":
        from app.gateway.discord_bot import DiscordGateway
        await DiscordGateway.get_instance().stop()
    elif platform == "webhook":
        from app.gateway.webhook_adapter import WebhookGateway
        await WebhookGateway.get_instance().stop()
    return {"platform": platform, "stopped": True}


@router.post("/gateway/webhook/{platform}")
async def receive_webhook(platform: str, request: Request):
    """Receive external webhook payload and trigger agent task."""
    from app.gateway.webhook_adapter import WebhookGateway
    body = await request.json()
    result = await WebhookGateway.get_instance().handle_incoming(platform, body)
    return result
