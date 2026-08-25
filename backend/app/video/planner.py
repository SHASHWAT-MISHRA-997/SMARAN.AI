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
