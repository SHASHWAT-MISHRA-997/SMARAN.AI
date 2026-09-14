"""What image this machine should render, chosen from what it can actually do.

The image path used to ask for 384x384 and refuse to go past 512, on every
machine, whatever card was in it. That cap is where "the images look blurry"
came from: it was not the model failing, it was being asked for a sixth of the
pixels the card could manage.

The sizes here come from running it rather than guessing. On the 6 GB RTX 2060
this was written against, Stable Diffusion 1.5 at 20 steps measured:

    512 x 512     7.1 s    peak 2.08 GB
    640 x 640     9.8 s    peak 2.50 GB
    768 x 768    15.3 s    peak 3.25 GB
    896 x 896    52.3 s    peak 4.46 GB
    1024 x 1024 339.2 s    peak 6.30 GB

There is a cliff, and it is not gradual: 768 is fifteen seconds, and 1024 is
five and a half minutes because 6.30 GB does not fit in a 6 GB card and the
driver starts moving memory back and forth to finish at all. So the tiers below
stop a long way short of "whatever did not crash" - a size that technically
completes in five minutes is not a size anyone wants by default.

Two things deliberately not done here:

  * Nothing claims 4K. Stable Diffusion 1.5 was trained at 512 and starts
    duplicating heads and limbs well before 1024 - past its training size the
    failure is compositional, not a memory error, so a bigger number would
    produce a worse picture. Large output is enlargement, and enlarge() says so.

  * Steps and guidance follow the model rather than a fixed setting. The
    turbo models need 1-4 steps at guidance 0 and produce fog at 20; SD 1.5
    needs 20-30 at guidance ~7.5 and produces noise at 2. One global default
    guarantees that one of them is wrong.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# (minimum FREE VRAM in GB, longest side, steps)
#
# Derived from the measured peaks above plus about 20% headroom, and the unit
# matters: these are compared against *free* VRAM, not the size of the card.
# Written first as card capacities and then fed free VRAM, they refused 768 -
# which peaks at 3.25 GB - on a machine with 4.4 GB free, and quietly produced
# a smaller picture than it could have.
_TIERS = (
    (7.0, 1024, 28),
    (5.0, 896, 26),
    (3.9, 768, 25),
    (3.0, 640, 22),
    (2.5, 512, 20),
)

# Past this, Stable Diffusion 1.5 starts drawing a second head or a third leg.
# It was trained at 512, and beyond roughly 768 the failure stops being about
# memory and becomes compositional - so a machine with VRAM to spare still gets
# a worse picture by asking for more. Raising it is possible with
# LOCAL_IMAGE_SIZE, deliberately not by default.
_SD15_CEILING = 768
_CPU_SIZE = 384
_CPU_STEPS = 12

# The model's own constraint: sizes must be multiples of 8.
_MULTIPLE = 8

ASPECTS = {"1:1": 1.0, "16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3, "3:4": 3 / 4}
DEFAULT_ASPECT = "1:1"

# Enlargement targets, by longest side. Named after what people ask for, and
# described as enlargement everywhere they appear.
TARGETS = {"HD": 1280, "QHD": 2560, "4K": 3840, "8K": 7680}


def _round(value: int) -> int:
    return max(256, int(round(value / _MULTIPLE)) * _MULTIPLE)


def _turbo(model_id: str) -> bool:
    """Whether this is a distilled few-step model.

    Checked by name because the pipeline does not report it, and getting it
    wrong is not subtle: 20 steps through a turbo model is a grey blur, and 2
    steps through SD 1.5 is noise.
    """
    name = (model_id or "").lower()
    return "turbo" in name or "lcm" in name or "lightning" in name


def probe_vram_gb() -> float:
    """Free VRAM in GB, or 0.0 when there is no usable CUDA device."""
    try:
        import torch

        if not torch.cuda.is_available():
            return 0.0
        free, _total = torch.cuda.mem_get_info()
        return free / (1024 ** 3)
    except Exception:  # noqa: BLE001
        logger.debug("could not read VRAM", exc_info=True)
        return 0.0


def plan(model_id: str, aspect: str = DEFAULT_ASPECT,
         vram_gb: Optional[float] = None) -> dict:
    """Size, steps and guidance for one image on this machine."""
    if vram_gb is None:
        vram_gb = probe_vram_gb()

    longest, steps = _CPU_SIZE, _CPU_STEPS
    for needs, size, tier_steps in _TIERS:
        if vram_gb >= needs:
            longest, steps = size, tier_steps
            break

    # A model is only as large as it was trained to be, whatever the card has.
    name = (model_id or "").lower()
    if "xl" not in name and "sd-3" not in name and "flux" not in name:
        longest = min(longest, _SD15_CEILING)

    ratio = ASPECTS.get(aspect, ASPECTS[DEFAULT_ASPECT])
    if ratio >= 1:
        width, height = longest, longest / ratio
    else:
        width, height = longest * ratio, longest

    if _turbo(model_id):
        # Distilled models are built for this and are ruined by more.
        steps, guidance = 4, 0.0
    else:
        guidance = 7.5

    return {
        "width": _round(int(width)),
        "height": _round(int(height)),
        "steps": steps,
        "guidance": guidance,
        "aspect": aspect,
        "vram_gb": round(vram_gb, 2),
        "model": model_id,
        "turbo": _turbo(model_id),
    }


def enlarge(image, target: str):
    """Enlarge a finished image to a named size. Returns (image, description).

    Lanczos, which is a good interpolator and only an interpolator. The picture
    holds exactly the detail it was rendered with, spread over more pixels. It
    is offered because the size is sometimes required regardless - a print, an
    upload that rejects anything smaller - and the description is returned
    alongside so that no screen can show "4K" without the qualification.
    """
    from PIL import Image

    if target not in TARGETS:
        raise ValueError("Unknown size %r. Available: %s."
                         % (target, ", ".join(TARGETS)))

    want = TARGETS[target]
    source_w, source_h = image.size
    longest = max(source_w, source_h)
    if longest >= want:
        return image, ("Already %dx%d, which is at or above %s."
                       % (source_w, source_h, target))

    scale = want / float(longest)
    size = (_round(int(source_w * scale)), _round(int(source_h * scale)))
    bigger = image.resize(size, Image.LANCZOS)
    return bigger, (
        "Enlarged from %dx%d to %dx%d. It was rendered at the smaller size - "
        "the extra pixels are interpolated, so this is the same picture larger, "
        "not a sharper one." % (source_w, source_h, size[0], size[1])
    )


def available_model() -> str:
    """The image model to use: whichever is already on disk, else SD 1.5.

    The default used to be a model that was not downloaded, while a perfectly
    good one sat in the cache unused - so the first image anyone asked for
    began with a multi-gigabyte download they had not agreed to, on a machine
    that did not need it.
    """
    override = os.getenv("LOCAL_IMAGE_MODEL")
    if override:
        return override

    candidates = (
        "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "stabilityai/sd-turbo",
    )
    hub = os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")
    for repo in candidates:
        folder = os.path.join(hub, "models--" + repo.replace("/", "--"))
        if os.path.isdir(folder) and any(
            name.endswith((".safetensors", ".bin"))
            for _root, _dirs, files in os.walk(folder) for name in files
        ):
            return repo
    return candidates[0]
