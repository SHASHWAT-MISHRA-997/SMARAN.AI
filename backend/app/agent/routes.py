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

import asyncio
import json
import logging
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.agent import loop
from app.companion import get_current_user_dep

logger = logging.getLogger("agent.routes")

router = APIRouter(prefix="/api/agent", tags=["agent"])


class AgentRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=20000)
    model: str = ""
    history: Optional[List[dict]] = None
    provider: str = ""
    api_key: str = ""
    root: str = ""
    # Code mode's "Ask for approval": every change waits for the person.
    ask_for_approval: bool = False
    # manual | smart | off. Left empty, the saved setting is used; the older
    # ask_for_approval flag still means manual.
    approval_mode: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Core Agent & Tools
# ─────────────────────────────────────────────────────────────────────────────

class GitPreferencesUpdate(BaseModel):
    branch_prefix: Optional[str] = Field(None, max_length=40)
    merge_method: Optional[str] = None
    draft_prs: Optional[bool] = None


@router.get("/git-preferences")
async def get_git_preferences(_user=Depends(get_current_user_dep)):
    """What Settings -> SMARAN Code -> Git shows, and the rules the agent is given."""
    from app.agent import git_policy
    return {"preferences": git_policy.load(), "rules": git_policy.describe()}


@router.put("/git-preferences")
async def put_git_preferences(update: GitPreferencesUpdate, _user=Depends(get_current_user_dep)):
    from app.agent import git_policy
    try:
        prefs = git_policy.save(update.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"preferences": prefs, "rules": git_policy.describe(prefs)}


class SafetyUpdate(BaseModel):
    approval_mode: Optional[str] = None
    allowlist: Optional[List[str]] = None
    redact_secrets: Optional[bool] = None


@router.get("/safety")
async def get_safety(_user=Depends(get_current_user_dep)):
    """Approval mode, the owner's allowed commands, and secret masking."""
    from app.agent import safety
    return {"preferences": safety.load()}


@router.put("/safety")
async def put_safety(update: SafetyUpdate, _user=Depends(get_current_user_dep)):
    from app.agent import safety
    try:
        return {"preferences": safety.save(update.model_dump(exclude_none=True))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/runs")
async def recent_runs(_user=Depends(get_current_user_dep)):
    """Recent runs that changed files, newest first."""
    from app.agent import checkpoints
    return {"runs": checkpoints.list_runs()}


@router.get("/runs/{run_id}/changes")
async def run_changes(run_id: str, _user=Depends(get_current_user_dep)):
    from app.agent import checkpoints
    try:
        return checkpoints.changes(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/runs/{run_id}/undo")
async def undo_run(run_id: str, _user=Depends(get_current_user_dep)):
    """Put back every file the run wrote or edited; delete the ones it created."""
    from app.agent import checkpoints
    try:
        return checkpoints.undo(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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


#: Decisions a running agent is waiting for, keyed "run_id:step".
_approvals: Dict[str, "asyncio.Future"] = {}


class ApprovalDecision(BaseModel):
    run_id: str = Field(..., min_length=8, max_length=64)
    step: int = Field(..., ge=1, le=1000)
    approve: bool
    # What the person typed with the decision: "yes, but name it utils.py",
    # "no - add a test first". The agent is given it word for word. Allow and
    # Deny alone gave no way to steer a run short of stopping it.
    message: str = Field("", max_length=4000)


@router.post("/approve")
async def agent_approve(decision: ApprovalDecision):
    """Allow or refuse the change a running agent is waiting on."""
    future = _approvals.get(f"{decision.run_id}:{decision.step}")
    if future is None or future.done():
        raise HTTPException(status_code=404, detail="Nothing is waiting for that decision.")
    future.set_result((decision.approve, decision.message.strip()))
    return {"ok": True, "approved": decision.approve}


@router.post("/run")
async def agent_run(request: AgentRequest):
    """Carry out the task, streaming each step as it happens."""
    run_id = secrets.token_urlsafe(12)
    from app.agent import safety

    mode = request.approval_mode or ("manual" if request.ask_for_approval else safety.load()["approval_mode"])
    if mode not in safety.MODES:
        raise HTTPException(status_code=400, detail="Approval mode is manual, smart or off.")

    async def approve(step: int):
        """(allowed, what the person said with it)."""
        future = asyncio.get_running_loop().create_future()
        _approvals[f"{run_id}:{step}"] = future
        try:
            # Ten minutes to decide; silence is a no.
            return await asyncio.wait_for(future, timeout=600)
        except asyncio.TimeoutError:
            return (False, "")
        finally:
            _approvals.pop(f"{run_id}:{step}", None)

    async def stream():
        yield json.dumps({"type": "run", "id": run_id, "mode": mode}) + "\n"
        try:
            async for event in loop.run(request.task, request.model, request.history,
                                        request.provider, request.api_key,
                                        request.root,
                                        approve=approve, mode=mode, run_id=run_id):
                yield json.dumps(event) + "\n"
        except Exception as exc:  # noqa: BLE001
            logger.exception("agent run failed")
            yield json.dumps({"type": "error", "message": str(exc)[:300]}) + "\n"
        finally:
            for key in [k for k in _approvals if k.startswith(run_id + ":")]:
                future = _approvals.pop(key, None)
                if future and not future.done():
                    future.set_result((False, ""))

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
    scheduler = AutomationScheduler.get_instance()
    jobs = scheduler.store.list_jobs()
    return {"jobs": [{**j.__dict__, "last_status": "running" if j.id in scheduler._active_jobs else j.last_status}
                     for j in jobs]}


@router.post("/scheduler/jobs")
def create_scheduled_job(req: CreateJobRequest):
    """Create a new recurring or one-shot scheduled automation."""
    from app.agent.scheduler import AutomationScheduler
    try:
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
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    result = AutomationScheduler.get_instance().queue_job(job_id)
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return JSONResponse(result, status_code=202)


@router.get("/scheduler/blueprints")
async def scheduler_blueprints():
    """Ready-made jobs to start from. {placeholders} are filled in by the person."""
    from app.agent.scheduler import BLUEPRINTS
    return {"blueprints": BLUEPRINTS}


class JobToggle(BaseModel):
    enabled: bool


@router.patch("/scheduler/jobs/{job_id}")
async def toggle_scheduled_job(job_id: str, body: JobToggle):
    """Pause or resume a job without deleting it."""
    from app.agent.scheduler import AutomationScheduler
    if not AutomationScheduler.get_instance().store.toggle_job(job_id, body.enabled):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "enabled": body.enabled}


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
def create_snapshot(req: SnapshotCreateRequest):
    """Create a workspace snapshot."""
    from app.agent.sandbox import get_sandbox
    try:
        snap = get_sandbox().create_snapshot(req.root, description=req.description)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "created", "id": snap.id, "files_count": len(snap.file_checksums)}


@router.post("/sandbox/restore")
def restore_snapshot(req: SnapshotRestoreRequest):
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
    else:
        raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")
    return {"platform": platform, "stopped": True}


@router.post("/gateway/webhook/{platform}")
async def receive_webhook(platform: str, request: Request):
    """Receive external webhook payload and trigger agent task."""
    from app.gateway.webhook_adapter import WebhookGateway
    gateway = WebhookGateway.get_instance()
    if not gateway.is_running():
        raise HTTPException(status_code=503, detail="Webhook gateway is stopped")
    if gateway.secret_token and not secrets.compare_digest(
            request.headers.get("X-Webhook-Secret", ""), gateway.secret_token):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Payload must be a JSON object")
    result = await gateway.handle_incoming(platform, body)
    return result
