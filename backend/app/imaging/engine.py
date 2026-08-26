"""Generating images locally.

The hardware probe is the video module's — the question "what can this card
do" has one answer, and asking it twice would be two places to get it wrong.

Two lessons from the video work are applied here rather than relearned. A
model that names a precision gets it, because choosing the faster type on a
card that only emulates the right one produced a blank frame. And dimensions
are snapped to what the architecture accepts and reported back as produced,
because a silent correction is how a caller ends up believing it got something
it did not.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Callable, Optional

from app.video.hardware import Hardware, probe

from .registry import ImageModel, by_id

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "sd15"

# Above this much free VRAM the pipeline stays resident, which is faster.
# Below it, layers move in as they run. This threshold is chosen here, not
# published by anyone, and is described that way.
RESIDENT_VRAM_GB = 9.0

_pipes: dict = {}
_lock = threading.Lock()


class ImageError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def evaluate(model: ImageModel, hw: Hardware) -> dict:
    """Whether this card can run it, with the numbers behind the answer."""
    if not hw.has_cuda:
        return {"runnable": False, "reason": hw.reason or "No usable GPU."}

    if model.min_vram_gb is None:
        return {
            "runnable": False,
            "reason": "No memory requirement is recorded, so it is not offered.",
        }

    have = hw.vram_free_gb
    if model.min_vram_gb <= have:
        return {
            "runnable": True,
            "reason": "Needs about %.1f GB; %.1f GB is free."
                      % (model.min_vram_gb, have),
            "offloaded": model.download_gb is not None and model.download_gb > have,
        }
    return {
        "runnable": False,
        "reason": "Needs about %.1f GB and %.1f GB is free."
                  % (model.min_vram_gb, have),
    }


def _dtype(hw: Hardware):
    import torch

    if not hw.has_cuda:
        return torch.float32
    # float16 is right for these: unlike the video transformer, SD's UNet does
    # not overflow it, and it halves both the download and the memory.
    return torch.float16


def load(model_id: str = DEFAULT_MODEL,
         progress: Optional[Callable[[str], None]] = None):
    with _lock:
        if model_id in _pipes:
            return _pipes[model_id]

        model = by_id(model_id)
        if not model:
            raise ImageError("No image model called %r." % model_id)

        hw = probe()
        verdict = evaluate(model, hw)
        if not verdict["runnable"]:
            raise ImageError(verdict["reason"])

        try:
            import torch
            from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline
        except ImportError as exc:
            raise ImageError(
                "The image packages are not installed: %s. They come with the "
                "video packages; fetch those and this works too." % exc
            ) from exc

        dtype = _dtype(hw)
        if progress:
            progress(
                "Loading %s. The first run downloads about %.1f GB."
                % (model.display_name, model.download_gb or 0)
            )

        cls = StableDiffusionXLPipeline if model.id == "sdxl" else StableDiffusionPipeline
        try:
            pipe = cls.from_pretrained(
                model.hf_repo,
                torch_dtype=dtype,
                # Ask for the fp16 files rather than downloading fp32 and
                # casting: same result, half the download.
                variant="fp16",
                use_safetensors=True,
                # These models ship a checker that returns black frames for
                # false positives. Silently handing back a black image and
                # calling it a result is the failure this project keeps
                # removing, so it is off and the reason is recorded.
                safety_checker=None,
                requires_safety_checker=False,
            )
        except Exception as exc:
            raise ImageError("Could not load %s: %s" % (model.hf_repo, exc)) from exc

        if hw.vram_free_gb >= RESIDENT_VRAM_GB:
            pipe.to("cuda")
            if progress:
                progress("Pipeline kept in VRAM.")
        else:
            pipe.enable_model_cpu_offload()
            if progress:
                progress(
                    "Only %.1f GB of VRAM is free, so parts are moved onto the "
                    "card as they run. Slower, but it fits." % hw.vram_free_gb
                )

        for opt in ("enable_vae_slicing", "enable_vae_tiling", "enable_attention_slicing"):
            fn = getattr(pipe, opt, None)
            if callable(fn):
                fn()

        _pipes[model_id] = pipe
        return pipe


def _round_to(value: int, base: int = 8) -> int:
    return max(base, int(round(value / base)) * base)


def generate(
    prompt: str,
    output_path: str,
    model_id: str = DEFAULT_MODEL,
    width: Optional[int] = None,
    height: Optional[int] = None,
    steps: int = 28,
    guidance_scale: float = 7.0,
    seed: Optional[int] = None,
    negative_prompt: str = "blurry, low quality, distorted, watermark, text",
    progress: Optional[Callable[[str], None]] = None,
) -> dict:
    """Make one image. Returns what was produced, not what was asked for."""
    import torch

    model = by_id(model_id)
    if not model:
        raise ImageError("No image model called %r." % model_id)

    pipe = load(model_id, progress)

    # These are latent models with an 8x downsample: dimensions must be
    # multiples of 8, and going far below the size a model was trained at
    # degrades it badly, which is why the default comes from the model.
    size = model.default_size
    width = _round_to(width or size)
    height = _round_to(height or size)

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))

    if progress:
        progress("Generating %dx%d, %d steps." % (width, height, steps))

    try:
        result = pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            generator=generator,
        )
    except torch.cuda.OutOfMemoryError as exc:
        torch.cuda.empty_cache()
        raise ImageError(
            "The card ran out of memory at %dx%d. A smaller size will fit; "
            "this is a hardware limit, not a setting that can be forced."
            % (width, height)
        ) from exc
    except Exception as exc:
        raise ImageError("Generation failed: %s" % exc) from exc

    image = result.images[0]
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    image.save(output_path)

    return {
        "path": output_path,
        "width": width,
        "height": height,
        "steps": steps,
        "guidance_scale": guidance_scale,
        "seed": seed,
        "model": model_id,
    }
