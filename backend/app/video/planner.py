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

# Above this much VRAM the whole pipeline is kept on the card, which is far
# faster. Below it, layers are streamed on as they execute.
#
# It lives here rather than in ltx_engine because two different questions need
# it and they need different measures of "how much". ltx_engine asks "can I
# keep this resident right now?" and so uses *free* VRAM. estimate_seconds()
# asks "will this machine ever run resident?", which is a property of the card
# and so uses *total* - otherwise the same machine would quote wildly
# different times depending on what else happened to be open.
RESIDENT_VRAM_GB = 12.0

# How much work this gets through per second, measured rather than assumed.
#
# One clip was timed end to end on an RTX 2060 (6 GB, sequential offload):
# 960x576, 57 frames, 30 steps. That is 945.6 million pixel-frame-steps, and
# it took over two hours, which is roughly 130 thousand per second.
#
# Work really does scale with the product of those four numbers - halving the
# steps halves the diffusion loop, halving the area halves the work per step -
# so extrapolating along them is sound. Extrapolating to a *different class of
# card* is not, which is why a machine fast enough to run resident is given
# this figure as an upper bound rather than a prediction: it will beat it,
# by an amount this code does not pretend to know.
_OFFLOAD_UNITS_PER_SEC = 130_000.0


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


def _round_frames(seconds: float, fps: int) -> int:
    """The frame count the engine will actually use.

    Estimating against the requested length rather than the real one would
    quote a time for a clip nobody is making: the architecture needs 8n+1
    frames, so 2 seconds at 30 fps is 57 frames, not 60.
    """
    frames = max(9, int(seconds * fps))
    return ((frames - 1) // 8) * 8 + 1


def estimate_seconds(
    width: int,
    height: int,
    steps: int,
    seconds: float,
    fps: int,
    hw: Optional[Hardware] = None,
) -> dict:
    """Roughly how long a generation will take, and how much to trust it.

    A job that reports only "running" is indistinguishable from a job that has
    hung. This one takes over two hours on a 6 GB card for under two seconds
    of video, and with nothing else on screen the only rational conclusion a
    user can draw is that the app is broken. It is not - but being right is no
    use if nothing says so.

    Deliberately coarse. It is derived from one timed run on one card, and the
    caller is told which kind of number it is getting rather than being handed
    a precise-looking figure that is not.
    """
    hw = hw or probe()
    frames = _round_frames(seconds, fps)
    units = float(width) * float(height) * float(frames) * float(steps)
    predicted = units / _OFFLOAD_UNITS_PER_SEC

    if not hw.has_cuda:
        # No measurement exists for CPU-only, and a made-up one would be worse
        # than none: it would be wrong by an unknown factor in an unknown
        # direction. Say so instead.
        return {
            "seconds": None,
            "bound": "unknown",
            "text": (
                "This runs on the processor, which has not been timed here. "
                "Expect hours rather than minutes."
            ),
        }

    if hw.vram_total_gb >= RESIDENT_VRAM_GB:
        return {
            "seconds": round(predicted),
            "bound": "at most",
            "text": (
                "Should take under %s. This card is large enough to hold the "
                "model in VRAM, which is considerably faster than the machine "
                "this estimate was measured on, so it should beat that "
                "comfortably." % _human(predicted)
            ),
        }

    return {
        "seconds": round(predicted),
        "bound": "about",
        "text": (
            "Expect roughly %s. The model does not fit in %.1f GB, so layers "
            "are streamed onto the card as they run, which is what makes it "
            "slow. It is working even while nothing appears to change."
            % (_human(predicted), hw.vram_total_gb)
        ),
    }


def _human(secs: float) -> str:
    """A duration a person can act on: whether to wait, or come back later."""
    if secs < 90:
        return "%d seconds" % round(secs)
    minutes = secs / 60.0
    if minutes < 90:
        return "%d minutes" % round(minutes)
    hours = minutes / 60.0
    # "1.5 hours" reads better than "90 minutes" at this end of the scale, and
    # rounding to whole hours would turn 2.4 hours into "2 hours".
    return "%.1f hours" % hours
