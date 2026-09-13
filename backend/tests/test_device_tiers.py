"""Generation settings follow the machine, not a single hardcoded guess.

Width, height and step count were fixed at 960x576 and 40 steps for everyone.
A 6 GB card was therefore asked for exactly what a 24 GB card was asked for:
it still produced a video, because the engine offloads layers to make it fit,
but it took far longer than that card needed - and a strong machine was never
offered anything better than a weak one.

These pin the shape of the tiering rather than the exact numbers, so the
figures can be retuned without rewriting the tests, but the guarantees cannot
quietly disappear.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.video.hardware import Hardware  # noqa: E402
from app.video.planner import suggest  # noqa: E402


def gpu(total_gb, name="Test GPU"):
    return Hardware(
        has_cuda=True,
        gpu_name=name,
        vram_total_gb=total_gb,
        # Deliberately low: the tier must come from what the card *is*, not
        # from whatever happens to be free at this instant.
        vram_free_gb=0.5,
        compute_capability=(7, 5),
        supports_bfloat16=False,
        torch_version="2.14.0+cu126",
        torch_is_cuda_build=True,
        disk_free_gb=100.0,
    )


def test_a_bigger_card_is_asked_for_more_than_a_smaller_one():
    small = suggest(gpu(6.0))
    large = suggest(gpu(24.0))
    assert large["width"] > small["width"]
    assert large["height"] > small["height"]
    assert large["steps"] >= small["steps"]


def test_the_tier_comes_from_total_vram_not_free_vram():
    """Free VRAM swings minute to minute; the same machine must not drift."""
    card = gpu(24.0)
    card.vram_free_gb = 0.1
    assert suggest(card)["tier"] == suggest(gpu(24.0))["tier"]


def test_a_machine_with_no_gpu_still_gets_usable_settings():
    cpu_only = Hardware(
        has_cuda=False, gpu_name="", vram_total_gb=0.0, vram_free_gb=0.0,
        compute_capability=None, supports_bfloat16=False,
        torch_version="2.14.0+cpu", torch_is_cuda_build=False, disk_free_gb=50.0,
    )
    out = suggest(cpu_only)
    assert out["width"] > 0 and out["height"] > 0 and out["steps"] > 0
    # It must say so rather than silently attempting a large render.
    assert "processor" in out["reason"].lower() or "no cuda" in out["reason"].lower()


@pytest.mark.parametrize("total", [1.0, 4.0, 6.0, 8.0, 12.0, 16.0, 24.0, 80.0])
def test_every_size_of_card_gets_an_answer(total):
    out = suggest(gpu(total))
    for key in ("width", "height", "steps", "fps", "tier", "reason"):
        assert key in out, "%s missing for a %s GB card" % (key, total)
    assert 128 <= out["width"] <= 1280
    assert 128 <= out["height"] <= 1280
    assert 1 <= out["steps"] <= 100


def test_the_reason_names_the_card_so_a_user_can_tell_why():
    out = suggest(gpu(6.0, name="NVIDIA GeForce RTX 2060"))
    assert "RTX 2060" in out["reason"]
    assert "6.0" in out["reason"]


def test_settings_never_exceed_what_the_request_model_accepts():
    """suggest() feeds GenerateRequest, whose bounds would reject bad values."""
    from app.video.routes import GenerateRequest

    for total in (0.5, 6.0, 24.0, 48.0):
        out = suggest(gpu(total))
        GenerateRequest(prompt="x", width=out["width"], height=out["height"],
                        steps=out["steps"], fps=out["fps"])
