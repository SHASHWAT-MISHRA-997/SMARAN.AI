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
from app.video.planner import RESIDENT_VRAM_GB, estimate_seconds, suggest  # noqa: E402


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


def cpu_only():
    return Hardware(
        has_cuda=False, gpu_name="", vram_total_gb=0.0, vram_free_gb=0.0,
        compute_capability=None, supports_bfloat16=False,
        torch_version="2.14.0+cpu", torch_is_cuda_build=False, disk_free_gb=50.0,
    )


def test_the_estimate_reproduces_the_run_it_was_measured_from():
    """The calibration run: 960x576, 57 frames, 30 steps on a 6 GB card ran
    222 minutes before the decode. If a change makes that come out as twenty
    minutes, the constant is broken and users are being told a comforting lie.

    An earlier constant quoted two hours for this and was wrong by ninety
    minutes, which is why the window below is not generous at the low end.
    """
    out = estimate_seconds(width=960, height=576, steps=30, seconds=2, fps=30,
                           hw=gpu(6.0))
    assert out["seconds"] is not None
    minutes = out["seconds"] / 60.0
    assert 190 <= minutes <= 260, "estimated %.0f min for a 222 min run" % minutes


def test_a_longer_or_larger_job_is_never_estimated_as_quicker():
    base = dict(width=704, height=448, steps=20, seconds=2, fps=30, hw=gpu(6.0))
    baseline = estimate_seconds(**base)["seconds"]
    for bigger in ("width", "height", "steps", "seconds"):
        harder = dict(base)
        harder[bigger] = base[bigger] * 2
        assert estimate_seconds(**harder)["seconds"] > baseline, bigger


def test_a_card_that_holds_the_model_is_promised_no_more_than_the_slow_one():
    """A large card is given the measured figure as a ceiling, not a forecast.
    Quoting it a faster time would mean inventing a speedup nobody measured."""
    small = estimate_seconds(width=960, height=576, steps=30, seconds=2, fps=30,
                             hw=gpu(RESIDENT_VRAM_GB - 1))
    large = estimate_seconds(width=960, height=576, steps=30, seconds=2, fps=30,
                             hw=gpu(RESIDENT_VRAM_GB + 1))
    assert large["bound"] == "at most"
    assert small["bound"] == "about"
    assert large["seconds"] <= small["seconds"]


def test_an_untimed_machine_is_told_so_rather_than_given_a_number():
    out = estimate_seconds(width=512, height=320, steps=20, seconds=2, fps=24,
                           hw=cpu_only())
    assert out["seconds"] is None
    assert out["bound"] == "unknown"


def test_the_estimate_says_something_a_person_can_act_on():
    for total in (6.0, 24.0):
        text = estimate_seconds(width=960, height=576, steps=30, seconds=2,
                                fps=30, hw=gpu(total))["text"]
        assert any(unit in text for unit in ("second", "minute", "hour")), text


def test_the_estimate_counts_the_frames_the_engine_will_really_make():
    """Frame count is snapped to 8n+1, so 2 s at 30 fps is 57 frames, not 60.
    Estimating against 60 would quote a time for a clip nobody is making."""
    from app.video.planner import _round_frames

    assert _round_frames(2, 30) == 57
    assert (_round_frames(2, 30) - 1) % 8 == 0


def test_the_offload_threshold_is_shared_with_the_engine():
    """The user is told 'this is slow because it does not fit'. That claim is
    only true if the same threshold decided to offload."""
    from app.video import ltx_engine

    assert ltx_engine.RESIDENT_VRAM_GB is RESIDENT_VRAM_GB


def test_the_suggested_settings_can_actually_be_decoded_on_that_card():
    """The point of the whole tier table.

    It once handed a 6 GB card 960x576, which spent three hours and forty-two
    minutes reaching a decode that could not fit. Settings this code chooses
    for a machine must survive the check that machine will apply to them.
    """
    from app.video.planner import _round_frames, decode_will_fit

    for total in (1.0, 4.0, 6.0, 8.0, 12.0, 16.0, 24.0, 80.0):
        card = gpu(total)
        picked = suggest(card)
        frames = _round_frames(2, picked["fps"])
        refusal = decode_will_fit(picked["width"], picked["height"], frames, card)
        assert refusal is None, "%.0f GB is offered settings it will refuse: %s" % (
            total, refusal,
        )


def test_the_configuration_that_really_worked_is_still_allowed():
    """704x448 for 41 frames produced a file on this 6 GB card, twice. A
    tightened limit that rejects it has been tightened past the evidence."""
    from app.video.planner import decode_will_fit

    assert decode_will_fit(704, 448, 41, gpu(6.0)) is None


def test_the_configuration_that_ran_out_of_memory_is_now_refused():
    """960x576 for 57 frames is the run that failed after 222 minutes."""
    from app.video.planner import decode_will_fit

    refusal = decode_will_fit(960, 576, 57, gpu(6.0))
    assert refusal is not None
    # The message has to leave the user somewhere to go, not just say no.
    assert "frames" in refusal and "6.0 GB" in refusal


def test_a_card_with_no_cuda_is_not_given_a_vram_limit():
    """CPU decode spills into system RAM rather than failing, so enforcing a
    VRAM budget there would refuse work that would have completed."""
    from app.video.planner import decode_will_fit

    assert decode_will_fit(1280, 768, 121, cpu_only()) is None


def test_a_job_started_with_only_a_prompt_still_gets_real_settings():
    """The chat path builds GenerateRequest(prompt=...) and nothing else.

    When width, height and steps became optional, only the HTTP route filled
    them in, so that caller handed None to the engine and every video asked
    for in chat died on the first arithmetic done with them. The defaults must
    be applied on the path every job shares, not on one of the two entrances.
    """
    import time

    from app.video.routes import GenerateRequest, _jobs, _run

    req = GenerateRequest(prompt="a paper boat in the rain")
    assert req.width is None and req.height is None and req.steps is None

    # Both real callers register the record before starting the thread.
    _jobs["testjob"] = {
        "id": "testjob", "status": "running", "messages": [], "result": None,
        "error": None, "started": time.time(), "updated": time.time(),
    }

    seen = {}

    def fake_generate(**kwargs):
        seen.update(kwargs)
        raise RuntimeError("stop here; the engine itself is not under test")

    import app.video.ltx_engine as engine

    original, engine.generate = engine.generate, fake_generate
    try:
        _run("testjob", req, "unused.mp4")
    finally:
        engine.generate = original

    for key in ("width", "height", "steps"):
        assert isinstance(seen.get(key), int) and seen[key] > 0, (
            "%s reached the engine as %r" % (key, seen.get(key))
        )

    # And the user is told how long it will take before the slow part starts.
    assert _jobs["testjob"]["messages"], "the job said nothing before working"
    del _jobs["testjob"]


def test_settings_never_exceed_what_the_request_model_accepts():
    """suggest() feeds GenerateRequest, whose bounds would reject bad values."""
    from app.video.routes import GenerateRequest

    for total in (0.5, 6.0, 24.0, 48.0):
        out = suggest(gpu(total))
        GenerateRequest(prompt="x", width=out["width"], height=out["height"],
                        steps=out["steps"], fps=out["fps"])
