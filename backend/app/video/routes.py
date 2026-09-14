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
    # Left unset, these are chosen from the machine's own VRAM by
    # planner.suggest(). They were once fixed at 960x576 and 40 steps for
    # everybody, so a 6 GB card was asked for exactly what a 24 GB card was
    # asked for: it still finished, by offloading, but took far longer than
    # that card needed to - and a strong machine was never offered more than a
    # weak one. An explicit value from the caller always wins.
    width: Optional[int] = Field(None, ge=128, le=1280)
    height: Optional[int] = Field(None, ge=128, le=1280)
    # fps is chosen from the machine too, and for a reason beyond taste: it
    # sets the frame count, and the frame count is most of what the final
    # decode has to hold at once. Left at a fixed 30 while the resolution was
    # picked for 24, the pair disagreed - a size chosen to fit 41 frames was
    # handed 57 - and the job was refused for not fitting settings this code
    # had selected itself.
    # The shape, chosen rather than assumed. A fixed landscape size is
    # wrong for anyone making something for a phone.
    aspect: Optional[str] = Field(None, description="16:9, 9:16, 1:1 or 4:3")
    # A clip longer than one pass is rendered as a chain of continuations and
    # joined. Nothing about that makes the card faster, so the cost is reported
    # before it starts rather than discovered during it.
    soundtrack: bool = Field(False, description=(
        "Generate music from the same prompt and lay it under the clip. The "
        "video model itself is silent; this is a separate model and it does "
        "not watch the video."
    ))
    upscale: Optional[str] = Field(None, description=(
        "HD, QHD, 4K or 8K. Enlarges the finished clip - it does not render "
        "at that size and does not add detail."
    ))
    fps: Optional[int] = Field(None, ge=8, le=30)
    steps: Optional[int] = Field(None, ge=1, le=100)
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
def install_status():
    """Whether the video packages are present, and what it would take."""
    from .install import status

    return status()


@router.post("/install")
def install_start():
    """Fetch the video packages. Reports progress; does not block."""
    from .install import start, status

    current = status()
    if current["installed"]:
        return {"started": False, "detail": "Already installed."}
    if not current["can_install"]:
        raise HTTPException(status_code=409, detail=current["blocker"])
    if current.get("free_space_gb") is not None \
            and current["free_space_gb"] < current["required_free_gb"]:
        # Refused here as well as inside the installer, so the button can say
        # why instead of starting a job that is going to fail.
        raise HTTPException(status_code=409, detail=(
            "Not enough disk space: about %.0f GB is needed and %.1f GB is free."
            % (current["required_free_gb"], current["free_space_gb"])
        ))
    return start()


@router.post("/install/cancel")
def install_cancel():
    """Stop an install in progress. Nothing already installed is affected."""
    from .install import cancel

    return cancel()


@router.get("/plan")
async def plan_for(seconds: float = 2.0, aspect: str = "16:9"):
    """Whether this machine can make that clip, before anything is started.

    A duration control that accepts any number and then fails - or quietly
    returns something shorter - is precisely the behaviour this project has
    been caught with before. This answers first: the settings if it fits, and
    if it does not, the longest clip that would at the same size.
    """
    from .planner import plan_clip

    return plan_clip(seconds=seconds, aspect=aspect)


@router.get("/sequence/plan")
async def sequence_plan(seconds: float = 5.0, aspect: str = "16:9"):
    """What a clip longer than one pass would take, before it is started.

    A single pass is capped by the decode, not by time - under two seconds on
    a 6 GB card. Past that the clip is a chain of continuations, and the chain
    costs one full render per link. This returns the number of links and the
    hours, so that is a decision rather than a discovery.
    """
    from .continuity import plan_sequence

    return plan_sequence(seconds, aspect=aspect)


@router.get("/soundtrack")
async def soundtrack_status():
    """Whether a soundtrack can be made, and what it honestly would be."""
    from .soundtrack import status

    return status()


@router.get("/sizes")
async def sizes():
    """The enlargement targets, described as enlargement rather than render."""
    from .continuity import TARGET_HEIGHTS

    return {
        "targets": TARGET_HEIGHTS,
        "note": (
            "These enlarge a finished clip. This machine renders well below "
            "them and interpolating up does not add detail, so a clip marked "
            "4K holds exactly as much detail as the size it was rendered at."
        ),
    }


@router.get("/suggested")
async def suggested():
    """What this machine will be asked for when the caller does not say.

    Exposed so the interface can show it rather than leaving the user to guess
    why their render is 704x448 on one computer and 1280x768 on another.
    """
    from .planner import suggest

    return suggest()


@router.get("/hardware")
async def hardware():
    return probe().as_dict()


def _add_sound_and_size(req: GenerateRequest, out_path: str, result: dict,
                        note) -> dict:
    """Optional soundtrack and enlargement, after the picture exists.

    Both are deliberately non-fatal. A clip that rendered for an hour must not
    be thrown away because the music model is missing or ffmpeg refused to
    scale it; the video is the thing that was asked for, and the rest is said
    plainly in the job's messages instead.
    """
    import os as _os
    import tempfile as _tempfile

    if req.soundtrack:
        from .soundtrack import SoundtrackError, generate_track, has_audio, mux

        try:
            wav = _os.path.join(_tempfile.gettempdir(),
                                "smaran-%s.wav" % _os.path.basename(out_path))
            generate_track(req.prompt, result.get("seconds") or req.seconds, wav,
                           progress=note)
            merged = out_path + ".snd.mp4"
            mux(out_path, wav, merged)
            _os.replace(merged, out_path)
            # Verified from the file, not assumed from the fact that ffmpeg
            # was asked. Reporting sound that is not there is the failure mode
            # this whole area keeps being caught by.
            result["has_audio"] = has_audio(out_path)
            note("Soundtrack added." if result["has_audio"] else
                 "The soundtrack step ran but the file still has no audio track.")
        except SoundtrackError as exc:
            result["has_audio"] = False
            note("No soundtrack: %s" % exc)
        finally:
            try:
                _os.unlink(wav)
            except OSError:
                pass
    else:
        result["has_audio"] = False

    if req.upscale:
        from .continuity import ContinuityError, upscale

        try:
            bigger = out_path + ".big.mp4"
            detail = upscale(out_path, bigger, req.upscale)
            _os.replace(bigger, out_path)
            result["width"], result["height"] = detail["to"]
            result["upscaled"] = detail["detail"]
            note(detail["detail"])
        except ContinuityError as exc:
            note("Could not enlarge the clip: %s" % exc)

    return result


def _run(job_id: str, req: GenerateRequest, out_path: str) -> None:
    from .ltx_engine import VideoError, generate, release

    def note(message: str) -> None:
        with _jobs_lock:
            _jobs[job_id]["messages"].append(message)
            _jobs[job_id]["updated"] = time.time()
        logger.info("video job %s: %s", job_id, message)

    # Filled in here, not in the route, because two different callers start
    # jobs: POST /api/video/generate, and the chat path in main.py, which
    # builds a GenerateRequest from the prompt alone. Once width, height and
    # steps became optional, filling them only in the route left the chat path
    # handing None to the engine, which failed on the first arithmetic it did
    # with them - so asking for a video in chat crashed the job outright.
    from .planner import _round_frames, _shrink_to_decode, suggest
    from .hardware import probe as probe_hw

    tuned = suggest()
    chose_size = req.width is None and req.height is None
    # A named shape reshapes the tier's size, keeping the same pixel count so
    # it still decodes. Only when the size was ours to choose: naming both a
    # resolution and an aspect is a contradiction, and the resolution is the
    # more specific of the two.
    if chose_size and req.aspect:
        from .planner import ASPECTS, _fit_aspect

        if req.aspect in ASPECTS:
            tuned = dict(tuned)
            tuned["width"], tuned["height"] = _fit_aspect(
                tuned["width"], tuned["height"], ASPECTS[req.aspect],
            )
    if req.width is None:
        req.width = tuned["width"]
    if req.height is None:
        req.height = tuned["height"]
    if req.steps is None:
        req.steps = tuned["steps"]
    if req.fps is None:
        req.fps = tuned["fps"]

    # suggest() sizes its answer against a two second clip at its own frame
    # rate. This request may be neither, and a size chosen for 41 frames does
    # not necessarily hold 57. Re-fit against what was actually asked for -
    # but only when the size is ours to choose. A caller who named a
    # resolution gets that resolution, and the check in the engine tells them
    # plainly if it cannot be decoded, rather than quietly substituting
    # something else and returning a video they did not ask for.
    if chose_size:
        req.width, req.height = _shrink_to_decode(
            req.width, req.height, _round_frames(req.seconds, req.fps), probe_hw(),
        )

    # Said before the first slow step, not after it. The whole point is to
    # reach the user while they are deciding whether the app has hung.
    try:
        from .planner import estimate_seconds

        note(estimate_seconds(
            width=req.width, height=req.height, steps=req.steps,
            seconds=req.seconds, fps=req.fps,
        )["text"])
    except Exception:  # noqa: BLE001
        # An estimate is a courtesy; failing to produce one must never stop the
        # generation the user actually asked for.
        logger.warning("video job %s: could not estimate duration", job_id, exc_info=True)

    try:
        from .continuity import plan_sequence

        # More than one pass is needed whenever the clip is longer than the
        # decode allows. Routed here rather than at the caller so every entry
        # point - the HTTP route and the chat path - behaves the same way.
        chain = None
        if not req.image_path:
            chain = plan_sequence(req.seconds, aspect=req.aspect or "16:9")

        if chain and chain.get("possible") and chain["chunks"] > 1:
            from .continuity import generate_sequence

            result = generate_sequence(
                prompt=req.prompt,
                output_path=out_path,
                total_seconds=req.seconds,
                aspect=req.aspect or "16:9",
                seed=req.seed,
                guidance_scale=req.guidance_scale,
                progress=note,
            )
        else:
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

        result = _add_sound_and_size(req, out_path, result, note)

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
    finally:
        # Hand the card back. Held on to, a finished job left 5.6 GB of a 6 GB
        # card occupied indefinitely, and everything after it - another video,
        # an image, a local model - was refused for want of memory the app
        # itself was sitting on.
        release()


@router.post("/generate")
async def start(req: GenerateRequest):
    from app.config import settings

    # Refuse before starting rather than failing minutes in, and say why.
    ready = plan("image-to-video" if req.image_path else "text-to-video")
    if not ready["recommended"]:
        blocked = [c["reason"] for c in ready["candidates"]] or ["No model available."]
        raise HTTPException(status_code=409, detail=blocked[0])

    # Anything the caller left to us is filled from this machine's hardware in
    # _run, which is the one path every job goes through.
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
