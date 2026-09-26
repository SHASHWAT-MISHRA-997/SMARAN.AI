"""HTTP surface for local image generation.

Shaped like the video routes on purpose: a job starts and is polled, because
even a fast model takes long enough on a modest card that holding the
connection would time out in front of the user.
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

from app.video.hardware import probe

from .engine import ImageError, evaluate, generate, release
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
        # A copy in Settings -> Cowork's files folder, where it can be found.
        from app import cowork_prefs
        final = result.get("path", out_path) if isinstance(result, dict) else out_path
        kept = cowork_prefs.keep_artifact(final, "Images", req.prompt)
        if kept and isinstance(result, dict):
            result = {**result, "saved_copy": kept}
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
    finally:
        # Hand the card back; see engine.release().
        release()


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


@router.get("/file/{job_id}")
async def file(job_id: str):
    """Serve a finished picture.

    The video routes have had this since a job reported "done", gave a path
    on disk, and nothing could hand the file to a browser. Images had the
    same hole and no equivalent route at all, so a picture generated here
    could not be displayed by the app that made it - the only way to see one
    was to open the data folder.

    The id is checked against the pattern the generator produces rather than
    trusted, because it is about to be joined onto a directory path.
    """
    from fastapi.responses import FileResponse
    from app.config import settings

    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        raise HTTPException(status_code=404, detail="No such image.")
    path = os.path.join(settings.DATA_DIR, "images", "%s.png" % job_id)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="That image is not on disk.")
    return FileResponse(path, media_type="image/png")


# ---------------------------------------------------------------------------
# Cloud images (Replicate): Flux, Stable Diffusion 3.5, Qwen-Image, Seedream,
# Ideogram, Recraft... whatever Replicate hosts for text-to-image, on your key.
# Seconds instead of a local install and a big GPU.
# ---------------------------------------------------------------------------

class CloudImageRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=2000)
    model: str = Field("", max_length=120)
    aspect_ratio: Optional[str] = Field(None, pattern=r"^\d{1,2}:\d{1,2}$")


@router.get("/cloud")
async def cloud_status():
    import asyncio
    from app.video import hosted
    info = {"provider": "replicate", "configured": hosted.configured(),
            "key_url": "https://replicate.com/account/api-tokens", "models": [], "error": ""}
    if info["configured"]:
        try:
            info["models"] = await asyncio.to_thread(hosted.list_models, "text-to-image")
        except Exception as exc:  # noqa: BLE001
            info["error"] = str(exc)[:300]
    return info


def _run_cloud(job_id: str, req: CloudImageRequest, out_path: str) -> None:
    from app.video import hosted

    def note(text: str) -> None:
        with _jobs_lock:
            _jobs[job_id]["messages"].append(text)
            _jobs[job_id]["updated"] = time.time()

    try:
        url = hosted.generate(req.prompt, note, model=req.model,
                              options={"aspect_ratio": req.aspect_ratio, "output_format": "png"}, kind="image")
        raw = out_path + ".download"
        hosted.download(url, raw)
        # Replicate returns webp, jpg or png; the Images page serves PNG.
        from PIL import Image
        with Image.open(raw) as img:
            img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB").save(out_path, "PNG")
        os.remove(raw)
        with _jobs_lock:
            _jobs[job_id].update(status="completed", result={"path": out_path, "model": req.model, "where": "replicate"},
                                 updated=time.time())
    except Exception as exc:  # noqa: BLE001
        with _jobs_lock:
            _jobs[job_id].update(status="failed", error=str(exc)[:500], updated=time.time())


@router.post("/cloud/generate")
async def cloud_generate(req: CloudImageRequest):
    from app.config import settings
    from app.video import hosted
    if not hosted.configured():
        raise HTTPException(status_code=409, detail="Save a Replicate key first: Model Hub -> Cloud Provider Keys -> Replicate.")
    if not req.model:
        raise HTTPException(status_code=400, detail="Choose a model.")
    job_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(settings.DATA_DIR, "images")
    os.makedirs(out_dir, exist_ok=True)
    with _jobs_lock:
        _jobs[job_id] = {"id": job_id, "status": "running", "messages": [], "result": None, "error": None,
                         "started": time.time(), "updated": time.time(), "where": "cloud"}
    threading.Thread(target=_run_cloud, args=(job_id, req, os.path.join(out_dir, "%s.png" % job_id)),
                     daemon=True).start()
    return {"job_id": job_id, "status": "running"}


# ---------------------------------------------------------------------------
# ComfyUI on this computer: its checkpoints, or any workflow exported from it.
# ---------------------------------------------------------------------------

class ComfyRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=2000)
    model: str = Field("", max_length=300)
    aspect_ratio: Optional[str] = Field("1:1", pattern=r"^\d{1,2}:\d{1,2}$")
    workflow: str = Field("", max_length=400_000)


@router.get("/comfy")
async def comfy_status():
    import asyncio
    from . import comfy
    return await asyncio.to_thread(comfy.status)


def _run_comfy(job_id: str, req: ComfyRequest, out_path: str) -> None:
    from . import comfy

    def note(text: str) -> None:
        with _jobs_lock:
            _jobs[job_id]["messages"].append(text)
            _jobs[job_id]["updated"] = time.time()

    def stopping() -> bool:
        with _jobs_lock:
            return bool(_jobs[job_id].get("stop_requested"))

    try:
        graph = (comfy.custom_workflow(req.workflow, req.prompt) if req.workflow.strip()
                 else comfy.standard_workflow(req.prompt, req.model, req.aspect_ratio or "1:1"))
        comfy.run(graph, out_path, note, stopping)
        with _jobs_lock:
            _jobs[job_id].update(status="completed", result={"path": out_path, "model": req.model or "workflow",
                                                            "where": "comfyui"}, updated=time.time())
    except Exception as exc:  # noqa: BLE001
        with _jobs_lock:
            _jobs[job_id].update(status="failed", error=str(exc)[:500], updated=time.time())


@router.post("/comfy/generate")
async def comfy_generate(req: ComfyRequest):
    from app.config import settings
    if not req.workflow.strip() and not req.model:
        raise HTTPException(status_code=400, detail="Choose a checkpoint, or paste a workflow.")
    job_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(settings.DATA_DIR, "images")
    os.makedirs(out_dir, exist_ok=True)
    with _jobs_lock:
        _jobs[job_id] = {"id": job_id, "status": "running", "messages": [], "result": None, "error": None,
                         "started": time.time(), "updated": time.time(), "where": "comfyui"}
    threading.Thread(target=_run_comfy, args=(job_id, req, os.path.join(out_dir, "%s.png" % job_id)),
                     daemon=True).start()
    return {"job_id": job_id, "status": "running"}


@router.post("/job/{job_id}/stop")
async def stop_job(job_id: str):
    with _jobs_lock:
        record = _jobs.get(job_id)
        if not record:
            raise HTTPException(status_code=404, detail="No such job.")
        record["stop_requested"] = True
    return {"status": "stopping"}
