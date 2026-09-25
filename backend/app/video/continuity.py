"""Longer video, made of clips that continue one another.

The model cannot produce a long clip. That is not a tuning problem: the final
decode holds every frame at full resolution in VRAM at once, so the length of a
single pass is capped by the card, and on 6 GB the cap is under two seconds.
Asking for five minutes in one pass is about 172 times over that budget.

What *can* be done is generate a clip, take its last frame, and start the next
clip from that frame - LTX-Video has an image-to-video mode, so this is the
model's own conditioning path, not a trick. Chain those and concatenate them.

Two honest limits, stated here because they are easy to hide:

  * This is a continuation, not one continuous shot. Each chunk is conditioned
    on a single frame, so colour and detail drift over a long chain. It does
    not loop - every chunk starts where the last one ended - but it is not the
    same thing as a model that can render five minutes at once.

  * It costs the same per second as a short clip. Nothing here makes the card
    faster. Ten seconds is roughly six chunks, and on a 6 GB card that is
    measured in hours. The estimate is returned before anything starts so that
    is a decision rather than a surprise.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)

# Generous: a chunk on a slow card can legitimately take an hour, and killing
# a render that was going to succeed is worse than waiting.
_FFMPEG_TIMEOUT = 600

# A ceiling on the chain, not a judgement about what is worth rendering. Five
# minutes on a 6 GB card is a couple of hundred chunks and many days of
# compute; the estimate says so and the choice stays with the user. This only
# stops the planning loop itself from running away.
_MAX_CHUNKS = 2500

# Below this, a trailing chunk is not worth a pipeline pass of its own.
_MIN_TAIL_SECONDS = 0.5


class ContinuityError(RuntimeError):
    """Raised with a message written to be shown to the user."""


def ffmpeg_path() -> Optional[str]:
    """The ffmpeg binary, preferring one the machine already has.

    imageio-ffmpeg ships one inside the video packages, so this works on a
    machine with no system ffmpeg - which is most Windows machines.
    """
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        logger.warning("no ffmpeg available", exc_info=True)
        return None


def _run(args: List[str], what: str) -> None:
    exe = ffmpeg_path()
    if not exe:
        raise ContinuityError(
            "ffmpeg is not available, so clips cannot be joined. It normally "
            "arrives with the video packages; reinstalling them from Settings "
            "-> Model Matrix would restore it."
        )
    try:
        done = subprocess.run(
            [exe, "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True, text=True, timeout=_FFMPEG_TIMEOUT,
        )
    except subprocess.TimeoutExpired as exc:
        raise ContinuityError("%s timed out." % what) from exc
    if done.returncode != 0:
        # ffmpeg's own message is far more useful than anything invented here.
        detail = (done.stderr or "").strip().splitlines()
        raise ContinuityError(
            "%s failed: %s" % (what, detail[-1] if detail else "unknown error")
        )


def last_frame(video_path: str, image_path: str) -> str:
    """Write the final frame of a clip out as a PNG.

    -sseof seeks from the end. Seeking to an absolute time computed from the
    duration is off by a frame often enough to matter, and being off by one
    here shows up as a visible jump at every join.
    """
    _run(
        ["-sseof", "-0.5", "-i", video_path, "-update", "1", "-q:v", "1", image_path],
        "Reading the last frame",
    )
    if not os.path.isfile(image_path):
        raise ContinuityError("Could not read the last frame of the clip.")
    return image_path


def concatenate(parts: List[str], output_path: str) -> str:
    """Join clips end to end without re-encoding where possible.

    The parts come from the same pipeline at the same size and frame rate, so
    the streams are compatible and the concat demuxer can copy them. Copying
    rather than re-encoding avoids a second generation of compression loss on
    material that is already soft.
    """
    if not parts:
        raise ContinuityError("Nothing to join.")
    if len(parts) == 1:
        if os.path.abspath(parts[0]) != os.path.abspath(output_path):
            shutil.copyfile(parts[0], output_path)
        return output_path

    handle, list_file = tempfile.mkstemp(suffix=".txt", text=True)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            for part in parts:
                # The concat demuxer takes this quoting literally; a path with
                # a quote in it has to be escaped or the list silently ends.
                fh.write("file '%s'\n" % os.path.abspath(part).replace("'", r"'\''"))
        _run(
            ["-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", output_path],
            "Joining the clips",
        )
    finally:
        try:
            os.unlink(list_file)
        except OSError:
            pass
    return output_path


# Named targets for enlargement. These are output sizes, not a claim about
# how much detail is in them - see upscale().
TARGET_HEIGHTS = {"HD": 720, "QHD": 1440, "4K": 2160, "8K": 4320}


def upscale(video_path: str, output_path: str, target: str = "QHD") -> dict:
    """Enlarge a finished clip to a named output size.

    This does not add detail, and it is important not to let it be described as
    if it does. The card cannot render at QHD or above - the decode alone is
    fifteen times over budget at 4K for a single second - so what is available
    is enlargement of what was rendered: Lanczos resampling, which is a good
    interpolator and still only an interpolator. A 736x416 clip enlarged to
    3840x2160 has exactly as much real detail as it had before, spread over
    twenty-seven times the pixels, and will look soft at full size.

    It is offered because the size is sometimes what is needed regardless -
    upload requirements, a timeline that expects one resolution - and because
    the alternative on this hardware is nothing at all. The return value says
    what was actually done so no caller has to guess.
    """
    if target not in TARGET_HEIGHTS:
        raise ContinuityError(
            "Unknown size %r. Available: %s."
            % (target, ", ".join(TARGET_HEIGHTS))
        )
    if not os.path.isfile(video_path):
        raise ContinuityError("There is no video to enlarge.")

    height = TARGET_HEIGHTS[target]
    source = probe_size(video_path)
    # -2 keeps the aspect ratio and rounds the width to an even number, which
    # h264 with yuv420p requires; -1 can land on an odd width and fail.
    _run(
        [
            "-i", video_path,
            "-vf", "scale=-2:%d:flags=lanczos" % height,
            # "slow" at 2160p is minutes of CPU for a quality difference that
            # interpolated pixels cannot show anyway - there is no real detail
            # here for a better encoder to preserve.
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p",
            # Carry any existing soundtrack across untouched.
            "-c:a", "copy",
            output_path,
        ],
        "Enlarging the clip",
    )
    result = probe_size(output_path)
    return {
        "path": output_path,
        "target": target,
        "from": source,
        "to": result,
        "factor": round(result[1] / source[1], 2) if source[1] else None,
        # Stated in the result itself, so an interface showing "4K" has the
        # correction right beside it.
        "detail": (
            "Enlarged from %dx%d, not rendered at %dx%d. The extra pixels are "
            "interpolated - this is the same picture at a larger size, not a "
            "sharper one."
            % (source[0], source[1], result[0], result[1])
        ),
    }


def probe_size(video_path: str) -> tuple:
    """(width, height) of a video file, read from the file itself."""
    import re as _re

    exe = ffmpeg_path()
    if not exe:
        raise ContinuityError("ffmpeg is not available.")
    done = subprocess.run(
        [exe, "-hide_banner", "-i", video_path],
        capture_output=True, text=True, timeout=60,
    )
    found = _re.search(r"Video:.*?,\s*(\d+)x(\d+)", done.stderr or "")
    if not found:
        raise ContinuityError("Could not read the size of %s." % os.path.basename(video_path))
    return int(found.group(1)), int(found.group(2))


def plan_sequence(total_seconds: float, aspect: str = "16:9", hw=None) -> dict:
    """How many chunks a requested length takes, and what it will cost.

    Returned before anything runs. A number of hours shown up front is a
    decision the user gets to make; the same number discovered afterwards is
    the app having wasted their evening.
    """
    from .hardware import probe
    from .planner import _round_frames, decode_will_fit, estimate_seconds, plan_clip

    # Probed once. Left as None it is re-probed inside every decode check, and
    # a long chain runs hundreds of those - a five minute plan was querying the
    # GPU thousands of times to answer a question that is pure arithmetic.
    hw = hw or probe()

    # The size comes from the shortest possible clip, which is the one case
    # where the planner never has to shrink anything to make it fit - so this
    # is the full tier resolution for this card.
    #
    # Deliberately not taken from a clip of the requested length. The planner
    # shrinks resolution to make a long single pass fit, so asking it about 3
    # seconds returned 576x320 where 2 chunks of the same total length run at
    # 736x416. Length is what chunking is for; resolution is the thing that
    # cannot be recovered afterwards, and softness is the complaint this is
    # meant to answer. So resolution is held and the chain absorbs the length.
    shape = plan_clip(seconds=0.4, aspect=aspect, hw=hw)
    if not shape["possible"]:
        return {
            "possible": False,
            "reason": shape.get("reason") or (
                "This machine cannot decode even the shortest clip at this size."
            ),
            "chunks": 0,
        }

    # Every chunk is rendered at exactly this size. That is not a detail: the
    # clips are joined by stream copy, and clips of different dimensions cannot
    # be joined at all.
    fixed_w, fixed_h, fps = shape["width"], shape["height"], shape["fps"]

    def _longest_at_fixed_size(target: float) -> float:
        """The longest piece <= target that decodes at the sequence's size."""
        frames = _round_frames(target, fps)
        while frames >= 9 and decode_will_fit(fixed_w, fixed_h, frames, hw) is not None:
            frames -= 8
        if frames < 9:
            return 0.0
        return round(frames / fps, 2)

    # Accumulated rather than multiplied out, with the last chunk only as long
    # as what is left. Multiplying gave a 2 second request two 1.7 second
    # chunks and reported 3.4 seconds - longer than was asked for, which is its
    # own kind of not listening - and counted them against a length the
    # renderer then snapped down, so the total reported was one no sequence
    # would ever actually produce.
    # The longest single chunk, found once. Searching from the *request* meant
    # a 100000 second ask started at 2.4 million frames and stepped down eight
    # at a time - about 180 million iterations - to reach the same answer this
    # gets in under two hundred. No chunk can exceed it, so every later search
    # starts at or below the limit and stops immediately.
    max_chunk = _longest_at_fixed_size(min(float(total_seconds), 60.0))
    if max_chunk <= 0:
        return {"possible": False, "chunks": 0,
                "reason": shape.get("reason") or "Nothing could be planned."}

    durations: List[float] = []
    remaining = float(total_seconds)
    while remaining > 0.05 and len(durations) < _MAX_CHUNKS:
        length = _longest_at_fixed_size(min(max_chunk, remaining))
        if length <= 0:
            break
        # A tail this short is the model's 9-frame floor, not a real piece of
        # the request, and it costs a whole pipeline pass - half an hour on
        # this card - to add a third of a second. Dropped, and total_seconds
        # reports what that leaves rather than what was asked for.
        if durations and length < _MIN_TAIL_SECONDS and remaining < _MIN_TAIL_SECONDS:
            break
        durations.append(length)
        # The shortest clip the model accepts is 9 frames. Once less than that
        # is left, another chunk would overshoot rather than finish the job.
        if length > remaining:
            break
        remaining -= length
    if not durations:
        return {"possible": False, "chunks": 0,
                "reason": shape.get("reason") or "Nothing could be planned."}

    # Summed over the real chunk lengths, not multiplied by the first one.
    # shape is deliberately a minimum-length clip - it is there for its
    # resolution - so estimating against it would have quoted a fraction of
    # the true cost, which is the opposite of what an estimate is for.
    estimates = [
        estimate_seconds(
            width=fixed_w, height=fixed_h, steps=shape["steps"],
            seconds=length, fps=fps, hw=hw,
        )
        for length in durations
    ]
    unknown = next((item for item in estimates if item["seconds"] is None), None)
    total_estimate = None if unknown else sum(item["seconds"] for item in estimates)
    bound = unknown["bound"] if unknown else (
        "measured" if all(item["bound"] == "measured" for item in estimates) else "at most"
    )
    chunks = len(durations)

    return {
        "possible": True,
        "chunks": chunks,
        "chunk_seconds": durations[0],
        "chunk_durations": durations,
        "total_seconds": round(sum(durations), 2),
        "requested_seconds": total_seconds,
        "width": shape["width"],
        "height": shape["height"],
        "fps": shape["fps"],
        "steps": shape["steps"],
        "aspect": aspect,
        "estimate_seconds": total_estimate,
        "estimate_bound": bound,
        "estimate_text": unknown["text"] if unknown else _duration_text(total_estimate, chunks, bound),
        # Said plainly rather than left for the user to notice.
        "caveat": (
            "Each clip continues from the last frame of the one before it, so "
            "it moves forward rather than looping. It is a chain of "
            "continuations, not a single unbroken shot, and detail drifts a "
            "little over a long chain."
        ) if chunks > 1 else "",
    }


def _duration_text(seconds: float, chunks: int, bound: str = "at most") -> str:
    if seconds < 90:
        amount = "%d seconds" % round(seconds)
    elif seconds < 5400:
        amount = "%.0f minutes" % (seconds / 60.0)
    else:
        amount = "%.1f hours" % (seconds / 3600.0)
    qualifier = ", at most" if bound == "at most" else ""
    if chunks == 1:
        return "About %s%s - one clip." % (amount, qualifier)
    return "About %s in total%s - %d clips, one after another." % (amount, qualifier, chunks)


def _part(work_dir: str, index: int) -> str:
    return os.path.join(work_dir, "part%04d.mp4" % index)


def resume_dir(prompt: str, plan: dict, aspect: str, seed: Optional[int], guidance_scale: float) -> str:
    """The folder for one request's clips: the same request finds the same folder."""
    import hashlib
    import json as _json
    from app.config import settings

    key = _json.dumps([prompt.strip(), plan["chunk_durations"], plan["width"], plan["height"],
                       plan["fps"], plan["steps"], aspect, seed, guidance_scale], sort_keys=True)
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]
    path = os.path.join(settings.DATA_DIR, "video-work", digest)
    os.makedirs(path, exist_ok=True)
    return path


def generate_sequence(
    prompt: str,
    output_path: str,
    total_seconds: float,
    aspect: str = "16:9",
    seed: Optional[int] = None,
    guidance_scale: float = 3.0,
    progress: Optional[Callable[[str], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> dict:
    """Render a chain of continuing clips and join them into one file.

    A long chain runs for hours or days, so finished clips are kept on disk
    (under DATA_DIR/video-work, one folder per request) rather than in a temp
    folder that vanished with the first failure. Asking again with the same
    prompt, length, shape and seed carries on from the last finished clip. A
    stop request is honoured between clips; nothing already rendered is lost.
    """
    from .ltx_engine import generate

    def note(message: str) -> None:
        if progress:
            progress(message)

    plan = plan_sequence(total_seconds, aspect=aspect)
    if not plan["possible"]:
        raise ContinuityError(plan["reason"])

    note(plan["estimate_text"])
    if plan["caveat"]:
        note(plan["caveat"])

    work_dir = resume_dir(prompt, plan, aspect, seed, guidance_scale)
    parts: List[str] = []
    still: Optional[str] = None
    kept = sum(1 for i in range(plan["chunks"]) if os.path.isfile(_part(work_dir, i)))
    if kept:
        note("Carrying on: %d of %d clips were already rendered." % (kept, plan["chunks"]))
    finished = False
    try:
        for index, length in enumerate(plan["chunk_durations"]):
            part_path = _part(work_dir, index)
            if os.path.isfile(part_path):
                parts.append(part_path)
                continue
            if should_stop and should_stop():
                raise ContinuityError(
                    "Stopped after %d of %d clips. They are kept - ask for the same video again "
                    "to carry on from here." % (len(parts), plan["chunks"]))
            if parts and still is None:
                still = last_frame(parts[-1], os.path.join(work_dir, "still%04d.png" % (index - 1)))
            note("Clip %d of %d." % (index + 1, plan["chunks"]))
            # Rendered under another name and renamed when complete, so a
            # clip cut off half way is never mistaken for a finished one.
            partial = part_path + ".partial.mp4"
            generate(
                prompt=prompt,
                output_path=partial,
                # Every clip after the first starts from the previous clip's
                # final frame. That is what makes this a continuation instead
                # of the same clip repeated, which is what a naive
                # concatenation of identical settings would produce.
                image_path=still,
                # This chunk's own length, not the chain's: the last one is
                # usually shorter, so that the total lands on what was asked
                # for instead of overshooting it.
                seconds=length,
                width=plan["width"],
                height=plan["height"],
                fps=plan["fps"],
                steps=plan["steps"],
                guidance_scale=guidance_scale,
                # A fixed seed across chunks would pull every clip back toward
                # the same motion, which is exactly the loop being avoided.
                seed=None if seed is None else int(seed) + index,
                progress=progress,
            )
            os.replace(partial, part_path)
            parts.append(part_path)
            if index + 1 < len(plan["chunk_durations"]):
                still = last_frame(part_path, os.path.join(work_dir, "still%04d.png" % index))

        note("Joining %d clips." % len(parts))
        concatenate(parts, output_path)
        finished = True
    finally:
        # Kept unless the whole video was made: that is what lets a chain
        # that failed or was stopped on clip 30 of 35 resume at clip 30.
        if finished:
            shutil.rmtree(work_dir, ignore_errors=True)

    return {
        "path": output_path,
        "chunks": plan["chunks"],
        "width": plan["width"],
        "height": plan["height"],
        "fps": plan["fps"],
        "seconds": plan["total_seconds"],
        "aspect": aspect,
        "mode": "continuation" if plan["chunks"] > 1 else "text-to-video",
    }
