"""Choosing the shape and the length of a clip, and being told the truth.

Two things were asked for and neither existed: a choice between landscape and
portrait, and a duration control that means what it says. The size was fixed
landscape for everyone - wrong for anything made for a phone - and a duration
could be typed in, accepted, and then either fail minutes later or quietly
return something shorter.

The honest part matters more than the feature. This card physically cannot
decode a five minute clip: the final decode step holds every frame at full
resolution at once, and five minutes is about 172 times more than 6 GB holds.
So the answer is given *before* anything starts, with the longest clip that
would actually fit at that size - not a spinner that runs for hours and fails.

There is also a test here for a mistake made while writing this: the new route
function was called plan(), which shadowed `from .planner import plan` at the
top of the module, so /capabilities silently started calling the wrong
function. Nothing failed loudly; the endpoint simply returned the wrong shape.
"""

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.video import routes  # noqa: E402
from app.video.planner import ASPECTS, _fit_aspect, plan_clip  # noqa: E402


def test_no_route_shadows_the_planner_helpers_it_imports():
    """A route named after something the module imported breaks that import.

    routes.py does `from .planner import plan` and /capabilities calls it. A
    route function defined later with the same name rebinds it at module level,
    and every later call reaches the route instead. Python says nothing.
    """
    assert routes.plan.__module__ == "app.video.planner", (
        "routes.plan is no longer the planner function - something later in "
        "the module has rebound the name"
    )


def test_capabilities_still_answers():
    result = asyncio.run(routes.capabilities())
    assert "recommended" in result and "candidates" in result


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("aspect", sorted(ASPECTS))
def test_every_offered_aspect_produces_that_shape(aspect):
    """An offered choice has to actually change the output."""
    result = plan_clip(seconds=2.0, aspect=aspect)
    wanted = ASPECTS[aspect]
    got = result["width"] / result["height"]
    # Sizes are rounded to a multiple of 32 for the model, so the ratio lands
    # near the request rather than exactly on it.
    assert abs(got - wanted) / wanted < 0.12, (
        f"{aspect} asked for ratio {wanted:.3f}, got "
        f"{result['width']}x{result['height']} = {got:.3f}"
    )


def test_portrait_and_landscape_are_not_the_same_picture():
    wide = plan_clip(seconds=2.0, aspect="16:9")
    tall = plan_clip(seconds=2.0, aspect="9:16")
    assert wide["width"] > wide["height"], "16:9 is not landscape"
    assert tall["height"] > tall["width"], "9:16 is not portrait"


def test_reshaping_keeps_roughly_the_same_pixel_count():
    """The tier's size was measured to fit. A reshape must not blow past it."""
    for aspect in ASPECTS:
        r = plan_clip(seconds=2.0, aspect=aspect)
        base = plan_clip(seconds=2.0, aspect="16:9")
        assert r["width"] * r["height"] <= base["width"] * base["height"] * 1.3


def test_sizes_are_multiples_of_32():
    """The model's own constraint; an odd size errors inside diffusers."""
    for aspect in ASPECTS:
        r = plan_clip(seconds=2.0, aspect=aspect)
        assert r["width"] % 32 == 0 and r["height"] % 32 == 0


def test_fit_aspect_never_returns_something_degenerate():
    for ratio in (16 / 9, 9 / 16, 1.0, 4 / 3):
        w, h = _fit_aspect(704, 448, ratio)
        assert w >= 256 and h >= 256
        assert w % 32 == 0 and h % 32 == 0


# ---------------------------------------------------------------------------
# Length
# ---------------------------------------------------------------------------


def test_an_impossible_length_is_refused_before_anything_starts():
    """Five minutes was asked for. It cannot be decoded here.

    The wrong answer is to accept it, run for hours, and fail. The wrong answer
    is also to silently return two seconds. The right one is to say no now.
    """
    result = plan_clip(seconds=300.0, aspect="16:9")
    assert result["possible"] is False
    assert result["reason"], "refused without saying why"


def test_a_refusal_says_what_would_fit_instead():
    result = plan_clip(seconds=300.0, aspect="16:9")
    longest = result["longest_possible_seconds"]
    assert longest is not None, "refused without offering a length that works"
    assert longest > 0
    # And that offer has to be true, not a guess.
    assert plan_clip(seconds=longest, aspect="16:9")["possible"] is True, (
        f"offered {longest}s as the longest possible, but it is refused too"
    )


def test_a_length_that_fits_is_not_quietly_shortened():
    """The duration the user picks is the duration that gets rendered."""
    result = plan_clip(seconds=1.5, aspect="16:9")
    if result["possible"]:
        # Frames land on the model's 8n+1 grid, so the realised length lands
        # near the request rather than exactly on it - but never far below.
        assert result["seconds"] >= 1.5 - (1.0 / result["fps"]) * 8


def test_the_answer_is_immediate():
    """It is a calculation, not a trial run. Anything slow here is a bug."""
    import time

    started = time.time()
    plan_clip(seconds=300.0, aspect="16:9")
    assert time.time() - started < 2.0


# ---------------------------------------------------------------------------
# The request carries the choice through to the job
# ---------------------------------------------------------------------------


def test_generate_request_accepts_an_aspect():
    req = routes.GenerateRequest(prompt="a lantern", aspect="9:16")
    assert req.aspect == "9:16"


def test_a_request_without_an_aspect_is_still_valid():
    """Every existing caller, including the chat path, omits it."""
    req = routes.GenerateRequest(prompt="a lantern")
    assert req.aspect is None


def test_a_named_resolution_wins_over_an_aspect():
    """Naming both is a contradiction; the explicit size is more specific.

    Pinned because the opposite - reshaping a size the user typed in - would be
    the app overriding a direct instruction.
    """
    import inspect

    source = inspect.getsource(routes._run)
    assert "chose_size and req.aspect" in source, (
        "the aspect is applied without checking whether the caller named a size"
    )
