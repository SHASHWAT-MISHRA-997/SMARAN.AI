"""Deciding what this machine should run, and saying why when it cannot.

The rule throughout: a capability is offered when the evidence says it fits,
refused with the actual numbers when it does not, and marked unknown when
nobody published a requirement. An unknown is never quietly treated as a yes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from .hardware import Hardware, probe
from .registry import MODELS, VideoModel, by_id

logger = logging.getLogger(__name__)


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
# Timed on an RTX 2060 (6 GB, sequential offload): 960x576, 57 frames, 30
# steps, which is 945.6 million pixel-frame-steps. It reached the decode after
# 222 minutes. That is just under 71 thousand per second.
#
# The first figure here was 130 thousand, taken from a shorter run, and it
# quoted two hours for a job that had not finished at three and a half. An
# estimate that optimistic is worse than none: it tells a user who is waiting
# correctly that something has gone wrong.
#
# A second run on the same card settles what that figure is worth. 704x448,
# 41 frames, 20 steps - 258.6 million - finished in 20.3 minutes, which is
# 212 thousand per second, three times the rate of the larger run.
#
# So the work does not scale with the product of those four numbers, even on
# one card: the bigger job is disproportionately slower, because the larger
# the tensors the more the offload thrashes moving them. Two points cannot
# tell us the shape of that, and fitting a curve to two points would dress a
# guess up as a model.
#
# The slower of the two is used deliberately, which makes every estimate an
# upper bound rather than a prediction, and the wording says so. Finishing
# early is a good surprise; being told twenty minutes at minute forty is how
# a user concludes the app is broken - which is the failure this exists to
# prevent. The same reasoning covers a card large enough to run resident: it
# beats the figure by an amount this code does not pretend to know.
# Rounded down from the measured 70,987: at the exact figure the estimate came
# in two seconds under the run it was taken from, and a ceiling that the
# calibration run itself breaches is not a ceiling.
_OFFLOAD_UNITS_PER_SEC = 70_000.0


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
# The 6 to 10 GB row is the only one measured. It read 960x576 at 30 steps,
# which was not a conservative guess but an unrunnable one: on a 6 GB card that
# ran for three hours and forty-two minutes and then died in the VAE decode with
# out of memory. Both clips this card has ever finished were 704x448 at 20
# steps, so that is what the row now says - the settings that are known to
# produce a file here, rather than settings that are known not to.
#
# The other rows remain untested and are extrapolated from that one. They are
# ordered so that a larger card is never asked for less, but none of them
# carries the authority the measured row does.
_TIERS = (
    # (minimum total VRAM GB, width, height, steps, label)
    (16.0, 1280, 768, 40, "16 GB or more"),
    (10.0,  960, 576, 30, "10 to 16 GB"),
    (6.0,   704, 448, 20, "6 to 10 GB"),      # measured
    (4.0,   576, 384, 20, "4 to 6 GB"),
    (0.0,   512, 320, 20, "under 4 GB"),
)

# Peak memory in the decode is set by how many pixels must be held at once -
# every frame, at full resolution - not by the step count, which is all spent
# before the decode begins. That is why a job can survive thousands of steps
# and then die on the last thing it does.
#
# Two runs on the same 6 GB card bracket it. 704x448 for 41 frames, 12.9
# million pixel-frames, decoded and produced a file. 960x576 for 57 frames,
# 31.5 million, ran for three hours and forty-two minutes and then ran out of
# memory in the decode.
#
# The line is drawn between those two points and scaled by card size. This is
# one success and one failure on one card, not a model of the allocator, so it
# sits deliberately close to the success: refusing a job that might have worked
# costs a user seconds, and accepting one that cannot costs them an afternoon.
_DECODE_PIXEL_FRAMES_PER_GB = 2_200_000


# The shapes people ask for, as ratios rather than fixed sizes.
#
# A fixed 16:9 size would be wrong on every card but the one it was written
# for. The tier decides how many pixels this machine can afford; the ratio
# only decides how they are arranged.
ASPECTS = {
    "16:9": 16 / 9,    # landscape, the usual video shape
    "9:16": 9 / 16,    # portrait, for phones
    "1:1": 1.0,        # square
    "4:3": 4 / 3,
}
DEFAULT_ASPECT = "16:9"


def _fit_aspect(width: int, height: int, ratio: float) -> tuple:
    """Re-shape a tier's size to a ratio, keeping roughly its pixel count.

    Keeping the area rather than the width matters: widening 704x448 to 16:9
    by holding the width would drop 48 rows and quietly make the picture
    smaller, while holding the height would add pixels the card has not been
    checked for.
    """
    area = width * height
    new_w = (area * ratio) ** 0.5
    new_h = new_w / ratio
    # The architecture needs multiples of 32; anything else is snapped anyway.
    return max(256, int(round(new_w / 32)) * 32), max(256, int(round(new_h / 32)) * 32)


def plan_clip(seconds: float, aspect: str = DEFAULT_ASPECT,
              hw: Optional[Hardware] = None) -> dict:
    """What this machine can really produce for a requested length and shape.

    Written because a duration control that accepts any number and then fails,
    or silently returns something else, is the kind of thing this codebase has
    been caught doing before. This answers honestly: the settings if it fits,
    and if it does not, what the limit is and the longest clip that would.
    """
    hw = hw or probe()
    base = suggest(hw)
    ratio = ASPECTS.get(aspect, ASPECTS[DEFAULT_ASPECT])
    width, height = _fit_aspect(base["width"], base["height"], ratio)
    fps = base["fps"]

    frames = _round_frames(seconds, fps)

    # Shrink to fit, but not past the point of being worth watching.
    #
    # Shrinking alone would chase any requested length down to 128x64 and then
    # refuse anyway - trading the picture away for a duration nobody can have.
    # Below this floor the answer is that the length is too long, not that the
    # video should be a postage stamp.
    FLOOR = 320
    shrunk_w, shrunk_h = _shrink_to_decode(width, height, frames, hw)
    if min(shrunk_w, shrunk_h) >= FLOOR:
        width, height = shrunk_w, shrunk_h

    refusal = decode_will_fit(width, height, frames, hw)

    longest = None
    if refusal and hw.has_cuda and hw.vram_total_gb > 0:
        # The longest clip that fits at the size actually being offered, which
        # is the number a person can act on.
        budget = hw.vram_total_gb * _DECODE_PIXEL_FRAMES_PER_GB
        max_frames = max(9, int(budget // (width * height)))
        longest = round(((max_frames - 1) // 8 * 8 + 1) / fps, 1)

    estimate = estimate_seconds(width, height, base["steps"], seconds, fps, hw)
    return {
        "possible": refusal is None,
        "width": width, "height": height, "steps": base["steps"], "fps": fps,
        "aspect": aspect if aspect in ASPECTS else DEFAULT_ASPECT,
        "seconds": round(frames / fps, 2),
        "longest_possible_seconds": longest,
        "reason": refusal or base["reason"],
        "estimate": estimate,
    }


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
            fps = 24
            reason = (
                "%s reports %.1f GB of VRAM, which is the %s tier."
                % (hw.gpu_name or "This GPU", hw.vram_total_gb, label)
            )
            # The tier is a starting point; the decode budget is a constraint,
            # and settings this function hands out must survive the check the
            # engine will apply to them. Offering a card something it will then
            # refuse is how a user ends up arguing with the app about its own
            # defaults. Measured against a two second clip, which is the
            # default length and the common case.
            shrunk = _shrink_to_decode(width, height, _round_frames(2, fps), hw)
            if shrunk != (width, height):
                width, height = shrunk
                reason += (
                    " Reduced to %dx%d so the final decode, which holds every "
                    "frame at once, fits in that." % (width, height)
                )
            return {
                "width": width, "height": height, "steps": steps, "fps": fps,
                "tier": label,
                "reason": reason,
            }

    # _TIERS ends at 0.0 so this is unreachable; kept so a future edit that
    # removes that row fails loudly here instead of returning None.
    raise RuntimeError("no tier matched %.1f GB" % hw.vram_total_gb)


def decode_will_fit(
    width: int, height: int, frames: int, hw: Optional[Hardware] = None,
) -> Optional[str]:
    """None if the decode should fit, otherwise why it will not.

    Checked before the work starts rather than discovered by it. The decode is
    the last thing a generation does, so without this a job that cannot
    possibly finish still runs every diffusion step first: the case this was
    written for burned three hours and forty-two minutes before failing, and
    everything needed to predict that was known at the outset.

    Returns a string rather than raising so the caller decides whether an
    unrunnable request is an error or a reason to choose smaller settings.
    """
    hw = hw or probe()
    if not hw.has_cuda or hw.vram_total_gb <= 0:
        # CPU decode spills into system RAM instead of failing outright, so
        # there is no equivalent limit to enforce and inventing one would
        # refuse work that would have completed.
        return None

    budget = hw.vram_total_gb * _DECODE_PIXEL_FRAMES_PER_GB
    needed = float(width) * float(height) * float(frames)
    if needed <= budget:
        return None

    # Say what would fit, at the resolution asked for, so the number is one the
    # user can act on rather than one they have to solve for.
    fits = int(budget // (float(width) * float(height)))
    return (
        "%dx%d for %d frames cannot be decoded in %.1f GB. The final step has "
        "to hold every frame at full resolution at once, and this card ran out "
        "of memory doing that. At %dx%d it can hold about %d frames; a smaller "
        "resolution would allow more. This is a limit of the card, not a "
        "setting that can be forced."
        % (width, height, frames, hw.vram_total_gb, width, height, max(1, fits))
    )


def _shrink_to_decode(width: int, height: int, frames: int, hw: Hardware):
    """The largest version of this shape whose decode fits, aspect preserved.

    Stepping down through 32-pixel multiples rather than solving directly
    because the engine snaps to those anyway, so anything else would be
    rounded back up and could overshoot the budget it was chosen to respect.
    """
    aspect = float(height) / float(width)
    while decode_will_fit(width, height, frames, hw) is not None:
        if width <= 128 or height <= 64:
            # Nothing sensible is left to give back. The engine's own check
            # refuses this with the full explanation rather than this function
            # silently returning something unusable.
            break
        width -= 32
        height = max(64, int(round(width * aspect / 32.0)) * 32)
    return width, height


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

    # A rate this machine produced itself, if it has ever finished a render.
    #
    # The shipped constant was timed on a 6 GB card streaming layers from
    # system memory - the slowest path there is - and applying it to hardware
    # that holds the model in VRAM quoted an RTX 4090 "under 6.4 hours" for
    # two seconds of video. Wrong by orders of magnitude, in the direction that
    # makes people close the app.
    resident = hw.vram_total_gb >= RESIDENT_VRAM_GB
    measured = None
    try:
        from . import calibration

        # The size is passed, not just the machine. A rate timed on a short
        # clip does not describe a long one: on the card this was built
        # against, four and a half times the frames cost twenty-four times the
        # time, so an unqualified rate under-predicted a 25 minute job as 4.
        measured = calibration.units_per_sec(
            hw.gpu_name, resident,
            units_per_step=float(width) * float(height) * float(frames),
        )
    except Exception:  # noqa: BLE001
        logger.debug("no calibration available", exc_info=True)

    predicted = units / (measured or _OFFLOAD_UNITS_PER_SEC)

    if measured:
        # Measured here, so it is quoted as a figure rather than a ceiling.
        return {
            "seconds": round(predicted),
            "bound": "measured",
            "text": (
                "About %s, measured on this machine rather than estimated from "
                "another one." % _human(predicted)
            ),
        }

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

    if resident:
        # Deliberately not a number. The only timing that exists is from a card
        # streaming layers off the host, and this card does not do that, so
        # scaling that figure here produced "under 6.4 hours" for a job an RTX
        # 4090 finishes in minutes. A wrong number is worse than none: it reads
        # as a broken app. The first render measures this machine and every
        # estimate after it is real.
        return {
            "seconds": None,
            "bound": "unmeasured",
            "text": (
                "This card holds the whole model in VRAM, which is much faster "
                "than the machine the shipped figure was timed on - quoting it "
                "here would be wrong by hours. This run is being timed instead: "
                "a real estimate in seconds or minutes appears after the first "
                "few steps, and from the next run onwards it is known before "
                "you start."
            ),
        }

    return {
        "seconds": round(predicted),
        "bound": "at most",
        "text": (
            "Should finish within about %s, and often sooner. The model does "
            "not fit in %.1f GB, so layers are streamed onto the card as they "
            "run, which is what makes it slow. It is working even while "
            "nothing appears to change."
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
