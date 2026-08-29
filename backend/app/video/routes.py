"""HTTP surface for local video generation.

Generation takes minutes, so a request starts a job and returns immediately.
Holding the connection open would time out in front of the user and give them
nothing to look at while it worked.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .hardware import probe
from .planner import plan
from .registry import MODELS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["video"])

_jobs: dict = {}
_jobs_lock = threading.Lock()


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    image_path: Optional[str] = None
    seconds: float = Field(1.0, gt=0, le=60)
    # Defaults match what was measured to produce usable output rather than
    # the smallest thing that runs; below roughly 960x576 this model washes out.
    width: int = Field(960, ge=128, le=1280)
    height: int = Field(576, ge=128, le=1280)
    fps: int = Field(30, ge=8, le=30)
    steps: int = Field(40, ge=1, le=100)
    guidance_scale: float = Field(3.0, ge=0, le=20)
    seed: Optional[int] = None


@router.get("/capabilities")
async def capabilities(capability: str = "text-to-video"):
    """What this machine can run, and the reason where it cannot."""
    return plan(capability)


@router.get("/models")
async def models():
    """The registry, with the sources behind every figure."""
    return {
        "models": [m.as_dict() for m in MODELS],
        "note": (
            "Memory figures and durations are the publishers' own claims, read "
            "from their repositories on the date shown. None has been measured "
            "on this machine."
        ),
    }


@router.get("/install")
async def install_status():
    """Whether the video packages are present, and what it would take."""
    from .install import status

    return status()


@router.post("/install")
async def install_start():
    """Fetch the video packages. Reports progress; does not block."""
    from .install import start, status

    current = status()
    if current["installed"]:
        return {"started": False, "detail": "Already installed."}
    if not current["can_install"]:
        raise HTTPException(status_code=409, detail=current["blocker"])
    return start()


@router.get("/hardware")
async def hardware():
    return probe().as_dict()


def _run(job_id: str, req: GenerateRequest, out_path: str) -> None:
    from .ltx_engine import VideoError, generate

    def note(message: str) -> None:
        with _jobs_lock:
            _jobs[job_id]["messages"].append(message)
            _jobs[job_id]["updated"] = time.time()
        logger.info("video job %s: %s", job_id, message)

    try:
        result = generate(
            prompt=req.prompt,
            output_path=out_path,
            image_path=req.image_path,
            seconds=req.seconds,
            width=req.width,
            height=req.height,
            fps=req.fps,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
            progress=note,
        )
        with _jobs_lock:
            _jobs[job_id].update(status="completed", result=result, updated=time.time())
    except VideoError as exc:
        # The engine's messages are written to be read by the user, so they are
        # passed through rather than replaced with something generic.
        with _jobs_lock:
            _jobs[job_id].update(status="failed", error=str(exc), updated=time.time())
    except Exception as exc:
        logger.exception("video job %s crashed", job_id)
        with _jobs_lock:
            _jobs[job_id].update(
                status="failed", error="Unexpected failure: %s" % exc, updated=time.time()
            )


@router.post("/generate")
async def start(req: GenerateRequest):
    from app.config import settings

    # Refuse before starting rather than failing minutes in, and say why.
    ready = plan("image-to-video" if req.image_path else "text-to-video")
    if not ready["recommended"]:
        blocked = [c["reason"] for c in ready["candidates"]] or ["No model available."]
        raise HTTPException(status_code=409, detail=blocked[0])

    job_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(settings.DATA_DIR, "video")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "%s.mp4" % job_id)

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
    return {"job_id": job_id, "status": "running", "model": ready["recommended"]}


@router.get("/file/{job_id}")
async def file(job_id: str):
    """Serve a finished video.

    A job reported "done" and gave a path on disk, and there was nothing that
    would hand the file to a browser - so a generated video could not be
    played from the app that made it.
    """
    from fastapi.responses import FileResponse
    from app.config import settings

    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        raise HTTPException(status_code=404, detail="No such video.")
    path = os.path.join(settings.DATA_DIR, "video", "%s.mp4" % job_id)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="That video is not on disk.")
    return FileResponse(path, media_type="video/mp4")


@router.get("/job/{job_id}")
async def job(job_id: str):
    with _jobs_lock:
        record = _jobs.get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="No such job.")
    return record
