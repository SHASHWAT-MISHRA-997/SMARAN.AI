"""The Director's HTTP surface.

Planning is separate from rendering on purpose. /plan costs nothing and can
be called as the writer types; /render is minutes of GPU time. Splitting them
means nobody starts a twenty-minute job to find out how long the film is.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings

from . import render
from .script import DEFAULT_SECONDS, ScriptError, parse

router = APIRouter(prefix="/api/director", tags=["director"])


class PlanRequest(BaseModel):
    script: str = Field(..., description="The script, one shot per paragraph.")
    default_seconds: float = DEFAULT_SECONDS
    #: Only used to time the estimate; /plan renders nothing.
    steps: int = 40


class RenderRequest(PlanRequest):
    width: int = 960
    height: int = 576
    steps: int = 40
    seed: int | None = None


def _out_dir(job_id: str) -> str:
    return os.path.join(settings.DATA_DIR, "director", job_id)


@router.post("/plan")
async def plan_only(req: PlanRequest):
    """Read the script into shots. No GPU, no files written."""
    try:
        plan = parse(req.script, default_seconds=req.default_seconds)
    except ScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"plan": plan.as_dict(),
            "estimate": render.estimate(plan, steps=req.steps)}


@router.post("/render")
async def start_render(req: RenderRequest):
    try:
        plan = parse(req.script, default_seconds=req.default_seconds)
    except ScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    import uuid

    job_dir = _out_dir(uuid.uuid4().hex[:12])
    try:
        return render.start(
            req.script, job_dir, default_seconds=req.default_seconds,
            width=req.width, height=req.height, steps=req.steps, seed=req.seed,
        )
    except render.DirectorError as exc:
        # 503, not 500: the request was fine, this machine cannot serve it.
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/job/{job_id}")
async def job(job_id: str):
    found = render.status(job_id)
    if not found:
        raise HTTPException(status_code=404, detail="No such render job.")
    return found
