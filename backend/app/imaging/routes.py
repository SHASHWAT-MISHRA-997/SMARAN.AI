"""HTTP surface for local image generation.

Shaped like the video routes on purpose: a job starts and is polled, because
even a fast model takes long enough on a modest card that holding the
connection would time out in front of the user.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.video.hardware import probe

from .engine import ImageError, evaluate, generate
from .registry import MODELS, by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/image", tags=["image"])

_jobs: dict = {}
_jobs_lock = threading.Lock()


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    model: str = Field("sd15")
    width: Optional[int] = Field(None, ge=256, le=1536)
    height: Optional[int] = Field(None, ge=256, le=1536)
    steps: int = Field(28, ge=1, le=100)
    guidance_scale: float = Field(7.0, ge=0, le=20)
    seed: Optional[int] = None
    negative_prompt: Optional[str] = None


@router.get("/models")
async def models():
    """Every model, with its terms and whether this card can run it."""
    hw = probe()
    rows = []
    for model in MODELS:
        verdict = evaluate(model, hw)
        rows.append({**model.as_dict(), **verdict})
    return {
        "models": rows,
        "hardware": hw.as_dict(),
        "note": (
            "Downloads are the fp16 weights a pipeline actually fetches, not "
            "the repository total, which counts every precision it holds."
        ),
    }


def _run(job_id: str, req: GenerateRequest, out_path: str) -> None:
    def note(message: str) -> None:
        with _jobs_lock:
            _jobs[job_id]["messages"].append(message)
            _jobs[job_id]["updated"] = time.time()
        logger.info("image job %s: %s", job_id, message)

    try:
        kwargs = dict(
            prompt=req.prompt,
            output_path=out_path,
            model_id=req.model,
            width=req.width,
            height=req.height,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
            progress=note,
        )
        if req.negative_prompt:
            kwargs["negative_prompt"] = req.negative_prompt
        result = generate(**kwargs)
        with _jobs_lock:
            _jobs[job_id].update(status="completed", result=result, updated=time.time())
    except ImageError as exc:
        with _jobs_lock:
            _jobs[job_id].update(status="failed", error=str(exc), updated=time.time())
    except Exception as exc:
        logger.exception("image job %s crashed", job_id)
        with _jobs_lock:
            _jobs[job_id].update(
                status="failed", error="Unexpected failure: %s" % exc, updated=time.time()
            )


@router.post("/generate")
async def start(req: GenerateRequest):
    from app.config import settings

    model = by_id(req.model)
    if not model:
        raise HTTPException(status_code=400, detail="No image model called %r." % req.model)

    # Refuse before starting rather than failing minutes in, and say why.
    verdict = evaluate(model, probe())
    if not verdict["runnable"]:
        raise HTTPException(status_code=409, detail=verdict["reason"])

    job_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(settings.DATA_DIR, "images")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "%s.png" % job_id)

    with _jobs_lock:
        _jobs[job_id] = {
            "id": job_id,
            "status": "running",
            "messages": [],
            "result": None,
            "error": None,
            "started": time.time(),
            "updated": time.time(),
        }

    threading.Thread(target=_run, args=(job_id, req, out_path), daemon=True).start()
    return {"job_id": job_id, "status": "running", "model": req.model}


@router.get("/job/{job_id}")
async def job(job_id: str):
    with _jobs_lock:
        record = _jobs.get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="No such job.")
    return record
