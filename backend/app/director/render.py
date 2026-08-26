"""Running a plan: every shot generated, then joined.

The plan is made first and can be read before anything starts, because on a
6 GB card each shot is minutes rather than seconds and the honest thing is to
show the bill before running up the total.

Failure is partial by design. If shot 4 of 6 runs out of memory, shots 1-3
are already on disk and stay there; the job reports which shot failed and
why, and the clips that did render can still be joined by hand. Discarding
completed work because a later step failed would throw away the expensive
part of the run.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from typing import Dict, List, Optional

from .script import Plan, parse

logger = logging.getLogger(__name__)

_jobs: Dict[str, dict] = {}
_lock = threading.Lock()

# One at a time. Two LTX pipelines will not fit in 6 GB together, and letting
# a second start would take the first out of memory mid-shot.
_render_lock = threading.Lock()


class DirectorError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def _set(job_id: str, **fields) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def _note(job_id: str, message: str) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id]["log"].append(
                {"at": time.time(), "message": message}
            )
    logger.info("director %s: %s", job_id, message)


# One real measurement, not a figure from a blog. Timed on this machine:
# an RTX 2060 with 5.0 GB free, so the pipeline runs with layers offloaded,
# generating 33 frames at 960x576 in 20 steps. Two shots took 520 s and 496 s,
# which is 17.4 and 19.0 seconds per step. The slower average is used.
#
# Everything about that run is recorded because the number only means
# anything with its conditions attached. A card that holds the pipeline
# resident is far faster, and this projection would then be pessimistic.
MEASURED = {
    "gpu": "NVIDIA GeForce RTX 2060",
    "vram_free_gb": 5.0,
    "offloaded": True,
    "frames": 33,
    "width": 960,
    "height": 576,
    "steps": 20,
    # Denoising only: 17.4 and 19.0 s per step across the two shots.
    "seconds_per_step": 18.2,
    # What is left of each shot after the steps finish - VAE decode and the
    # write to disk. Shot 1 spent 172 s outside the loop and shot 2 spent
    # 117 s; the difference is the 41 s load, which only shot 1 paid. Leaving
    # this out was what made the first version of this estimate read 13.3
    # minutes against a run that took 16.9.
    "decode_seconds": 124.0,
    "measured_on": "2026-08-27",
}

# Loading the pipeline from disk, once per job. Measured at 41 s; the weights
# were already in the page cache, so this is a floor, not a promise.
LOAD_SECONDS = 41.0


def project_minutes(plan: Plan, steps: int) -> dict:
    """How long this plan is likely to take, and on what evidence.

    A single data point extrapolated over frame count and step count. Said
    plainly, because a projection presented as a measurement is the kind of
    confident guess this project keeps deleting.
    """
    from app.video.hardware import probe

    hw = probe()
    frames = sum(s.frames for s in plan.shots)

    if not hw.has_cuda:
        return {"minutes": None, "basis": "No GPU, so there is nothing to time."}

    # Two terms, because they scale differently: denoising costs steps times
    # frames, decoding costs frames alone. Both linear in frames, which is
    # the simplest fit two shots support.
    scale = [s.frames / MEASURED["frames"] for s in plan.shots]
    stepping = sum(MEASURED["seconds_per_step"] * steps * f for f in scale)
    decoding = sum(MEASURED["decode_seconds"] * f for f in scale)
    total = LOAD_SECONDS + stepping + decoding

    basis = (
        "Extrapolated from one timed run on this machine (%s, %.1f GB free, "
        "offloaded): %d frames at %dx%d in %d steps, %.1f s per step plus "
        "%.0f s to decode and write, measured %s. Reproduces that run to "
        "within a minute. Scaled linearly in steps and frames from two shots, "
        "so treat it as an order of magnitude, not a promise."
        % (MEASURED["gpu"], MEASURED["vram_free_gb"], MEASURED["frames"],
           MEASURED["width"], MEASURED["height"], MEASURED["steps"],
           MEASURED["seconds_per_step"], MEASURED["decode_seconds"],
           MEASURED["measured_on"])
    )
    if hw.gpu_name and hw.gpu_name != MEASURED["gpu"]:
        basis += (
            " This machine is a %s, not the card that was timed, so the figure "
            "is worth less here." % hw.gpu_name
        )

    return {"minutes": round(total / 60, 1), "basis": basis}


def estimate(plan: Plan, steps: int = 40) -> dict:
    """What this plan will cost, from the hardware rather than from a guess."""
    from app.video.hardware import probe

    hw = probe()
    frames = sum(s.frames for s in plan.shots)

    if not hw.has_cuda:
        return {
            "runnable": False,
            "reason": hw.reason or "No usable GPU.",
            "total_frames": frames,
            "seconds_per_frame": None,
            "estimated_minutes": None,
        }

    projection = project_minutes(plan, steps)
    return {
        "runnable": True,
        "reason": "%s, %.1f GB free." % (hw.gpu_name, hw.vram_free_gb),
        "total_frames": frames,
        "shot_count": len(plan.shots),
        "total_seconds_of_video": plan.total_seconds,
        "estimated_minutes": projection["minutes"],
        "estimate_basis": projection["basis"],
    }


def _run(job_id: str, plan: Plan, out_dir: str, width: int, height: int,
         steps: int, seed: Optional[int]) -> None:
    from app.director import assemble
    from app.video import ltx_engine

    clips: List[str] = []
    started = time.time()

    if not _render_lock.acquire(blocking=False):
        _set(job_id, state="failed",
             error="Another render is already running. Two pipelines do not "
                   "fit in this card's memory, so they are not started "
                   "together.")
        return

    try:
        os.makedirs(out_dir, exist_ok=True)
        _set(job_id, state="rendering")

        for shot in plan.shots:
            shot_started = time.time()
            _note(job_id, "Shot %d of %d: %.2f s, %d frames."
                          % (shot.index, len(plan.shots), shot.seconds, shot.frames))
            _set(job_id, current_shot=shot.index)

            clip_path = os.path.join(out_dir, "shot-%02d.mp4" % shot.index)
            try:
                ltx_engine.generate(
                    prompt=shot.prompt,
                    output_path=clip_path,
                    seconds=shot.seconds,
                    width=width,
                    height=height,
                    steps=steps,
                    # Each shot gets its own seed derived from the job's, so a
                    # rerun reproduces the same film rather than a new one,
                    # and two shots do not come out identical.
                    seed=None if seed is None else int(seed) + shot.index,
                    progress=lambda m, i=shot.index: _note(job_id, "Shot %d: %s" % (i, m)),
                )
            except Exception as exc:
                # The clips already rendered stay on disk and are reported.
                _set(job_id, state="failed", current_shot=shot.index,
                     clips=list(clips),
                     error="Shot %d failed: %s" % (shot.index, exc))
                _note(job_id, "Stopped at shot %d. The %d clip(s) already "
                              "rendered are kept in %s."
                              % (shot.index, len(clips), out_dir))
                return

            clips.append(clip_path)
            elapsed = time.time() - shot_started
            done, total = shot.index, len(plan.shots)
            per_shot = (time.time() - started) / done
            _set(job_id, clips=list(clips),
                 seconds_per_shot=round(per_shot, 1),
                 projected_remaining_minutes=round(per_shot * (total - done) / 60, 1))
            _note(job_id, "Shot %d finished in %.0f s." % (shot.index, elapsed))

        _set(job_id, state="assembling")
        final = os.path.join(out_dir, "film.mp4")
        result = assemble.concat(clips, final,
                                 progress=lambda m: _note(job_id, m))
        _set(job_id, state="done", result=result,
             total_minutes=round((time.time() - started) / 60, 1))
        _note(job_id, "Done: %.2f s of video in %s."
                      % (result["duration_seconds"], final))

    except Exception as exc:
        _set(job_id, state="failed", clips=list(clips), error=str(exc))
        logger.exception("director %s failed", job_id)
    finally:
        _render_lock.release()


def start(script_text: str, out_dir: str, default_seconds: float = 3.0,
          width: int = 960, height: int = 576, steps: int = 40,
          seed: Optional[int] = None) -> dict:
    """Parse, check the hardware, and begin. Returns the plan and a job id."""
    plan = parse(script_text, default_seconds=default_seconds)
    cost = estimate(plan, steps=steps)
    if not cost["runnable"]:
        raise DirectorError(cost["reason"])

    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "state": "queued",
            "created_at": time.time(),
            "plan": plan.as_dict(),
            "estimate": cost,
            "out_dir": out_dir,
            "current_shot": 0,
            "clips": [],
            "log": [],
            "error": None,
            "result": None,
        }

    threading.Thread(
        target=_run, args=(job_id, plan, out_dir, width, height, steps, seed),
        daemon=True, name="director-%s" % job_id,
    ).start()

    return dict(_jobs[job_id])


def status(job_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
