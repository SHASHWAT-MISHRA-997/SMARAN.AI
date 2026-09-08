"""The Director's HTTP surface.

Planning is split from working for the same reason the video Director splits
them: a plan costs one model call and can be read and corrected, while a run
writes files. Anyone about to let four models loose on a folder should be able
to see the split first.

Runs are held in memory. They are long, they stream, and a run that the server
forgot halfway through would be worse than one that is only remembered until
the app restarts.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import prompts
from .graph import GraphError, build_graph
from .routing import (
    Candidate, NoProviderAvailable, PAID_PROVIDERS, Router, local_chat_models,
    select_candidates,
)
from .run import Run, RunConfig

logger = logging.getLogger("orchestrator.routes")

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

#: Kept small. Each run holds its events and every diff it staged.
MAX_REMEMBERED_RUNS = 20
_runs: "OrderedDict[str, Run]" = OrderedDict()
_tasks: Dict[str, asyncio.Task] = {}


class ModelChoice(BaseModel):
    #: Empty means the local engine.
    provider: str = ""
    model: str = ""
    #: Sent per request and never stored, the way the coding agent does it.
    api_key: str = ""
    capabilities: List[str] = Field(default_factory=list)


class RunRequest(BaseModel):
    request: str = Field(..., min_length=1, max_length=20000)
    root: str = ""
    models: List[ModelChoice] = Field(default_factory=list)
    #: Paid providers are never reached for without this, said in as many
    #: words by whoever started the run.
    allow_paid: bool = False
    concurrency: int = Field(2, ge=1, le=6)
    #: False stages every change as a diff and applies none of them.
    apply_changes: bool = True
    stack: str = ""


def _candidates(choices: List[ModelChoice]) -> List[Candidate]:
    return [Candidate(provider=c.provider, model=c.model, api_key=c.api_key,
                      capabilities=tuple(c.capabilities))
            for c in choices if (c.model or "").strip()]


def _remember(run: Run) -> None:
    _runs[run.id] = run
    while len(_runs) > MAX_REMEMBERED_RUNS:
        old_id, _ = _runs.popitem(last=False)
        _tasks.pop(old_id, None)


def _get(run_id: str) -> Run:
    run = _runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="No run with that id is remembered.")
    return run


@router.get("/roles")
async def roles():
    """The roles work is split across, for the interface to label."""
    from .graph import ROLES
    from .routing import ROLE_CAPABILITY

    return {"roles": [{"name": name, "wants": ROLE_CAPABILITY.get(name)}
                      for name in ROLES],
            "note": ("Every task claims the files it alone may write. Two tasks "
                     "whose claims overlap never run at the same time.")}


@router.get("/models")
async def models():
    """Local models that can actually run a task, and the truth if there are none."""
    available = local_chat_models()
    return {
        "local": available,
        "paid_providers": sorted(PAID_PROVIDERS),
        "note": (
            "Models that only produce embeddings are left out; they cannot hold "
            "a conversation and would fail on the first task."
            if available else
            "No local chat model is installed. Pull one in the Model Hub, or "
            "add a provider key and allow paid providers for the run."
        ),
    }


@router.post("/plan")
async def plan(request: RunRequest):
    """What the Director intends. Nothing is written by this."""
    try:
        candidates = select_candidates(_candidates(request.models),
                                       allow_paid=request.allow_paid)
    except NoProviderAvailable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    model_router = Router(candidates)
    try:
        completion = await model_router.complete(
            prompts.decompose_prompt(request.request, stack=request.stack),
            role="review")
        graph = build_graph(prompts.parse_plan(completion.text))
    except (NoProviderAvailable, prompts.PlanError, GraphError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)[:500]) from exc

    return {"tasks": [t.as_dict() for t in graph.tasks()],
            "planned_by": completion.candidate.label,
            "fallback_reason": completion.fallback_reason}


@router.post("/runs")
async def start(request: RunRequest):
    """Begin a run. Returns immediately; follow it with /stream or /runs/{id}."""
    if not request.root.strip():
        raise HTTPException(status_code=400,
                            detail="A project folder is required before anything is written.")
    try:
        candidates = select_candidates(_candidates(request.models),
                                       allow_paid=request.allow_paid)
    except NoProviderAvailable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    run = Run(RunConfig(
        request=request.request, root=request.root.strip(), candidates=candidates,
        allow_paid=request.allow_paid, concurrency=request.concurrency,
        apply_changes=request.apply_changes, stack=request.stack))
    _remember(run)
    _tasks[run.id] = asyncio.create_task(run.start())
    return run.snapshot()


@router.get("/runs")
async def listing():
    return {"runs": [{"id": r.id, "state": r.state, "request": r.config.request[:200],
                      "created_at": r.created_at} for r in reversed(_runs.values())]}


@router.get("/runs/{run_id}")
async def snapshot(run_id: str):
    return _get(run_id).snapshot()


@router.post("/runs/{run_id}/cancel")
async def cancel(run_id: str):
    run = _get(run_id)
    result = run.cancel()
    # The run's own loop notices and stops handing out work; the request in
    # flight is left to finish rather than being torn out of a thread.
    return {**result, "state": run.state}


@router.get("/runs/{run_id}/stream")
async def stream(run_id: str):
    """Every event as it happens, then the finished run."""
    run = _get(run_id)

    async def events():
        sent = 0
        while True:
            while sent < len(run.events):
                yield json.dumps(run.events[sent]) + "\n"
                sent += 1
            if run.state in ("done", "failed", "cancelled"):
                break
            await asyncio.sleep(0.2)
        yield json.dumps({"kind": "snapshot", "run": run.snapshot()}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.get("/runs/{run_id}/changes")
async def changes(run_id: str):
    """Every diff the run staged, applied or not."""
    run = _get(run_id)
    return {"changes": run.changes, "applied": run.config.apply_changes}
