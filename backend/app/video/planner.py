"""Deciding what this machine should run, and saying why when it cannot.

The rule throughout: a capability is offered when the evidence says it fits,
refused with the actual numbers when it does not, and marked unknown when
nobody published a requirement. An unknown is never quietly treated as a yes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .hardware import Hardware, probe
from .registry import MODELS, VideoModel, by_id


# Weights are not the whole cost. Activations, the text encoder and the VAE all
# want room, and a plan that budgets only for the weights is a plan that runs
# out part way through. This is a margin, not a measurement, and it is named as
# one wherever it reaches the user.
VRAM_HEADROOM_GB = 1.5


@dataclass
class Verdict:
    model_id: str
    display_name: str
    runnable: bool
    confidence: str        # "stated" | "unknown"
    reason: str
    dtype: Optional[str]
    needs_gb: Optional[float]
    have_gb: float


def _dtype_for(hw: Hardware) -> str:
    """The precision this card can actually use.

    bfloat16 arrived with Ampere. The model card's examples all pass
    torch.bfloat16, and following them on a Turing card either errors or falls
    back to something far slower, so the choice is made from the reported
    compute capability rather than copied from the example.
    """
    if not hw.has_cuda:
        return "float32"
    return "bfloat16" if hw.supports_bfloat16 else "float16"


def evaluate(model: VideoModel, hw: Hardware) -> Verdict:
    dtype = _dtype_for(hw)
    have = hw.vram_free_gb if hw.has_cuda else 0.0

    if not hw.has_cuda:
        return Verdict(
            model.id, model.display_name, False, "stated",
            hw.reason or "No usable GPU.", None, model.min_vram_gb, have,
        )

    if model.min_vram_gb is None:
        return Verdict(
            model.id, model.display_name, False, "unknown",
            (
                "Its publisher does not state a memory requirement, so whether "
                "it fits in %.1f GB is unknown. It is not offered rather than "
                "guessed at." % have
            ),
            dtype, None, have,
        )

    needed = model.min_vram_gb + VRAM_HEADROOM_GB
    if needed <= have:
        return Verdict(
            model.id, model.display_name, True, "stated",
            (
                "Its publisher states %.1f GB; %.1f GB is free, leaving room "
                "for the %.1f GB margin this allows for activations."
                % (model.min_vram_gb, have, VRAM_HEADROOM_GB)
            ),
            dtype, needed, have,
        )

    return Verdict(
        model.id, model.display_name, False, "stated",
        (
            "Its publisher states a minimum of %.1f GB. This card has %.1f GB "
            "free. That gap is not something settings can close."
            % (model.min_vram_gb, have)
        ),
        dtype, needed, have,
    )


def plan(capability: str = "text-to-video", hw: Optional[Hardware] = None) -> dict:
    """Every model for a capability, each with a verdict and a reason."""
    hw = hw or probe()
    candidates = [m for m in MODELS if capability in m.capabilities]
    verdicts = [evaluate(m, hw) for m in candidates]

    # Smallest stated requirement first: on a modest card the one that fits is
    # the one worth defaulting to.
    runnable = sorted(
        (v for v in verdicts if v.runnable),
        key=lambda v: v.needs_gb if v.needs_gb is not None else 1e9,
    )

    return {
        "capability": capability,
        "hardware": hw.as_dict(),
        "recommended": runnable[0].model_id if runnable else None,
        "candidates": [v.__dict__ for v in verdicts],
        "note": (
            "Memory figures are the publishers' own, not measurements taken on "
            "this machine."
        ),
    }


# Output size and step count scaled to the machine it will run on.
#
# These were fixed at 960x576 and 40 steps for everyone, so a 6 GB card was
# asked for exactly what a 24 GB card was asked for. It still produced a video
# - offloading makes it fit - but it took far longer than that card needed to,
# and a strong machine was never offered anything better than a weak one.
#
# Keyed on total VRAM rather than free VRAM: total is what the device *is*,
# free is whatever happens to be open this second and would make the same
# machine give different answers on different days. The runtime offload
# decision in ltx_engine still uses free VRAM, which is the right measure for
# that question.
#
# The boundaries are chosen here, not published by any model author, and are
# deliberately conservative: the cost of aiming slightly low is a faster video,
# and the cost of aiming high is a job that crawls or dies.
_TIERS = (
    # (minimum total VRAM GB, width, height, steps, label)
    (16.0, 1280, 768, 50, "16 GB or more"),
    (10.0, 1152, 640, 40, "10 to 16 GB"),
    (6.0,   960, 576, 30, "6 to 10 GB"),
    (4.0,   704, 448, 25, "4 to 6 GB"),
    (0.0,   512, 320, 20, "under 4 GB"),
)


def suggest(hw: Optional[Hardware] = None) -> dict:
    """Defaults suited to this machine, with the reason stated."""
    hw = hw or probe()

    if not hw.has_cuda:
        # No usable GPU: the smallest thing that could finish, and honest that
        # it will be slow rather than quietly attempting a large render.
        return {
            "width": 512, "height": 320, "steps": 20, "fps": 24,
            "tier": "no GPU",
            "reason": (
                "No CUDA GPU was detected, so this runs on the processor. "
                "The smallest settings are used; expect it to be slow."
            ),
        }

    for minimum, width, height, steps, label in _TIERS:
        if hw.vram_total_gb >= minimum:
            return {
                "width": width, "height": height, "steps": steps, "fps": 24,
                "tier": label,
                "reason": (
                    "%s reports %.1f GB of VRAM, which is the %s tier."
                    % (hw.gpu_name or "This GPU", hw.vram_total_gb, label)
                ),
            }

    # _TIERS ends at 0.0 so this is unreachable; kept so a future edit that
    # removes that row fails loudly here instead of returning None.
    raise RuntimeError("no tier matched %.1f GB" % hw.vram_total_gb)
