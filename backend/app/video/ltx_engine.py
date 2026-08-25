"""Running LTX-Video locally.

Loading uses the components published at Lightricks/LTX-Video. Three things
the model card shows are deliberately not copied.

The card names Lightricks/LTX-Video-0.9.8-dev as the repository. No such
repository exists on the Hub and passing it returns Repository Not Found, so
the published id is used instead.

The card also uses LTXConditionPipeline. In diffusers 0.39 that class builds
its own timesteps and calls retrieve_timesteps without mu, while this
repository's scheduler was written for 0.32 with use_dynamic_shifting set,
which requires it - the pair raises before a single step runs. LTXPipeline
and LTXImageToVideoPipeline both pass mu, so text-to-video and image-to-video
go through those. They read the same weights.

The card's examples pass torch.bfloat16. That needs Ampere; a Turing card
reports compute 7.5 and does not have it, so the precision comes from what the
card reports rather than from the example.

The card also assumes the whole pipeline sits in VRAM. On a small card it does
not, so CPU offload is enabled below a threshold — slower, but the difference
between slow and an out-of-memory error.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Callable, Optional

from .hardware import Hardware, probe
from .planner import evaluate
from .registry import by_id

logger = logging.getLogger(__name__)

MODEL_ID = "ltx-video"

# Above this much free VRAM the pipeline is kept resident, which is faster.
# Below it, layers are moved in as needed. The number is a threshold this code
# chooses, not a figure from the model card, and it is described that way.
RESIDENT_VRAM_GB = 12.0

_pipes: dict = {}
_pipe_lock = threading.Lock()


class VideoError(RuntimeError):
    """A failure worth showing the user verbatim."""


def _resolve_dtype(hw: Hardware, model) -> object:
    """The precision to load at."""
    import torch

    if not hw.has_cuda:
        return torch.float32

    # A model that names a precision gets it, whether or not the card has it
    # in hardware. Preferring float16 here because this card only emulates
    # bfloat16 produced a near-white static clip: fp16 tops out around 65504
    # and this transformer overflows it, so the faster type produces nothing
    # worth having. Emulated and correct beats native and blank.
    required = getattr(model, "required_dtype", None)
    if required:
        return getattr(torch, required)

    return torch.bfloat16 if hw.supports_bfloat16 else torch.float16


def load(for_image: bool = False, progress: Optional[Callable[[str], None]] = None):
    """Load the pipeline once, and reuse it.

    Weights are several gigabytes and loading them takes minutes; doing it per
    request would make every generation feel broken. The lock is there because
    two requests arriving together would otherwise each start a download.
    """
    kind = "image-to-video" if for_image else "text-to-video"

    with _pipe_lock:
        if kind in _pipes:
            return _pipes[kind]

        model = by_id(MODEL_ID)
        hw = probe()
        verdict = evaluate(model, hw)
        if not verdict.runnable:
            raise VideoError(verdict.reason)

        try:
            import torch
            from diffusers import LTXImageToVideoPipeline, LTXPipeline
        except ImportError as exc:
            raise VideoError(
                "The video packages are not installed: %s. Install torch and "
                "diffusers to generate video locally." % exc
            ) from exc

        dtype = _resolve_dtype(hw, model)
        if progress:
            progress(
                "Loading %s at %s. The first run downloads several gigabytes of "
                "weights." % (model.display_name, str(dtype).replace("torch.", ""))
            )

        try:
            cls = LTXImageToVideoPipeline if for_image else LTXPipeline
            # The two share every component, so a second load would fetch
            # nothing new but would put a second copy of 28 GB in memory.
            other = next(iter(_pipes.values()), None)
            if other is not None:
                pipe = cls(**other.components)
            else:
                pipe = cls.from_pretrained(model.hf_repo, torch_dtype=dtype)
        except Exception as exc:
            raise VideoError("Could not load %s: %s" % (model.hf_repo, exc)) from exc

        if hw.vram_free_gb >= RESIDENT_VRAM_GB:
            pipe.to("cuda")
            if progress:
                progress("Pipeline kept in VRAM.")
        else:
            # Sequential offload keeps only the executing layer on the card.
            pipe.enable_sequential_cpu_offload()
            if progress:
                progress(
                    "Only %.1f GB of VRAM is free, so layers are moved onto the "
                    "card as they run. This works but is considerably slower."
                    % hw.vram_free_gb
                )

        # The VAE decode is the step that most often exhausts memory on a small
        # card, because it holds every frame at full resolution at once.
        for opt in ("enable_vae_slicing", "enable_vae_tiling"):
            fn = getattr(pipe, opt, None)
            if callable(fn):
                fn()

        _pipes[kind] = pipe
        return pipe


def _round_to(value: int, base: int) -> int:
    return max(base, int(round(value / base)) * base)


def generate(
    prompt: str,
    output_path: str,
    image_path: Optional[str] = None,
    seconds: float = 1.0,
    # The documented default is 1216x704 at 30 fps. That does not fit in 6 GB,
    # and dropping far below it is what produced washed-out output: the same
    # seed gave mean brightness 238 with 29% of pixels blown out at 704x480,
    # against 172 and 1% at 960x576. Detail comes back with resolution.
    width: int = 960,
    height: int = 576,
    fps: int = 30,
    # 40 over 30 for the same reason. The 8-step figure in the release notes
    # belongs to the distilled models, not to these weights.
    steps: int = 40,
    guidance_scale: float = 3.0,
    seed: Optional[int] = None,
    negative_prompt: str = (
        "worst quality, inconsistent motion, blurry, jittery, distorted, "
        "overexposed, washed out"
    ),
    progress: Optional[Callable[[str], None]] = None,
) -> dict:
    """Generate one clip and write it to output_path.

    Returns what was actually produced, not what was asked for: the frame count
    and dimensions are snapped to what the model accepts, and reporting the
    request back would misdescribe the file on disk.
    """
    import torch
    from diffusers.utils import export_to_video

    pipe = load(for_image=bool(image_path), progress=progress)

    # The architecture is patch-based: dimensions must be multiples of 32, and
    # frame count must be 8n+1. Passing an arbitrary number either errors or is
    # silently corrected, and a silent correction is how a caller ends up
    # believing it got something it did not.
    width = _round_to(width, 32)
    height = _round_to(height, 32)
    frames = max(9, int(seconds * fps))
    frames = ((frames - 1) // 8) * 8 + 1

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    kwargs = dict(
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        num_frames=frames,
        num_inference_steps=steps,
        guidance_scale=guidance_scale,
        generator=generator,
    )

    if image_path:
        from diffusers.utils import load_image

        if not os.path.exists(image_path):
            raise VideoError("No such image: %s" % image_path)
        kwargs["image"] = load_image(image_path)

    if progress:
        progress(
            "Generating %d frames at %dx%d (%.1fs at %d fps), %d steps."
            % (frames, width, height, frames / fps, fps, steps)
        )

    try:
        result = pipe(**kwargs)
    except torch.cuda.OutOfMemoryError as exc:
        torch.cuda.empty_cache()
        raise VideoError(
            "The card ran out of memory at %dx%d for %d frames. A smaller "
            "resolution or fewer frames will fit; this is a hardware limit, "
            "not a setting that can be forced." % (width, height, frames)
        ) from exc
    except Exception as exc:
        raise VideoError("Generation failed: %s" % exc) from exc

    video = result.frames[0]
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    export_to_video(video, output_path, fps=fps)

    return {
        "path": output_path,
        "frames": frames,
        "width": width,
        "height": height,
        "fps": fps,
        "seconds": round(frames / fps, 2),
        "seed": seed,
        "model": MODEL_ID,
        "mode": "image-to-video" if image_path else "text-to-video",
    }
