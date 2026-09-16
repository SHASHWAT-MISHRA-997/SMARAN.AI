"""Every decision a large card would take, exercised without owning one.

This cannot prove how fast an RTX 4090 is. Nothing here claims to. What it can
prove - and what actually carries the risk - is that the code paths a large
card takes are reachable, produce sane values, and cannot crash, divide by
zero, or hand back something nonsensical on hardware nobody here has.

The distinction matters. The remaining unknown on high-end hardware is the
*speed*, and speed is the one thing the app no longer guesses: an untimed path
says so rather than quoting a figure, and the first render measures the machine
it is on. So the worst case on a 4090 is a first run that says "this is being
timed" - not a wrong number, and not a crash.

The failure this guards against is the one that already happened once: settings
derived from one 6 GB card, applied to hardware it was never measured on, with
nobody able to try it.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import image_plan  # noqa: E402
from app.video import calibration  # noqa: E402
from app.video.continuity import plan_sequence  # noqa: E402
from app.video.hardware import Hardware  # noqa: E402
from app.video.planner import decode_will_fit, estimate_seconds, plan_clip, suggest  # noqa: E402

# Real cards, with their published memory. The names are labels for the test
# output; only the numbers are used.
CARDS = [
    ("RTX 2060 (the measured one)", 6.0, 16.0),
    ("RTX 4070", 12.0, 32.0),
    ("RTX 4080", 16.0, 32.0),
    ("RTX 4090", 24.0, 64.0),
    ("RTX 5090", 32.0, 64.0),
    ("RTX 6000 Ada", 48.0, 128.0),
    ("H100", 80.0, 256.0),
]


def card(vram, ram=64.0, name="Test GPU"):
    return Hardware(
        has_cuda=True, gpu_name=name, vram_total_gb=vram, vram_free_gb=vram * 0.92,
        compute_capability=(8, 9), supports_bfloat16=True, torch_version="2.14",
        torch_is_cuda_build=True, disk_free_gb=500.0, reason="",
        cpu_cores=16, cpu_threads=32, cpu_name="test", ram_total_gb=ram,
        ram_free_gb=ram * 0.6,
    )


def test_sequence_preserves_unmeasured_time_and_selected_hardware(monkeypatch):
    """Sequence planning summed unknown times and reprobed a different machine."""
    from app.video import planner
    chosen = card(24)
    calls = []

    def untimed(width, height, steps, seconds, fps, hw=None):
        calls.append(hw)
        return {'seconds': None, 'bound': 'unmeasured', 'text': 'Not timed yet.'}

    monkeypatch.setattr(planner, 'estimate_seconds', untimed)
    result = plan_sequence(2, hw=chosen)
    assert result['possible']
    assert result['estimate_seconds'] is None
    assert result['estimate_bound'] == 'unmeasured'
    assert 'Not timed yet.' in result['estimate_text']
    assert calls and all(hardware is chosen for hardware in calls)


def test_chat_duration_guard_accepts_unknown_timing():
    """The chat consumer also compared unknown timing with a numeric limit."""
    import ast
    tree = ast.parse((BACKEND / 'app/main.py').read_text(encoding='utf-8'))
    guards = [node.test for node in ast.walk(tree) if isinstance(node, ast.If)
              and any(isinstance(part, ast.Name) and part.id == 'CHAT_VIDEO_AUTOSTART_LIMIT_SECONDS'
                      for part in ast.walk(node.test))]
    assert len(guards) == 1
    expression = compile(ast.Expression(guards[0]), 'chat-duration-guard', 'eval')
    for seconds, should_pause in [(None, False), (10, False), (200, True)]:
        assert eval(expression, {'shape': {'estimate_seconds': seconds},
                                 'CHAT_VIDEO_AUTOSTART_LIMIT_SECONDS': 100}) is should_pause


@pytest.fixture(autouse=True)
def isolated_calibration(tmp_path, monkeypatch):
    """No test may read or write the real machine's measurements."""
    monkeypatch.setattr(calibration, "_cache", {})
    monkeypatch.setattr(calibration, "_path", lambda: str(tmp_path / "calib.json"))
    yield
    monkeypatch.setattr(calibration, "_cache", None)


# ---------------------------------------------------------------------------
# Nothing falls over
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("label,vram,ram", CARDS)
def test_video_settings_are_sane_on_every_card(label, vram, ram):
    hw = card(vram, ram, label)
    plan = suggest(hw)
    assert plan["width"] > 0 and plan["height"] > 0, label
    assert plan["width"] % 32 == 0 and plan["height"] % 32 == 0, label
    assert plan["steps"] > 0 and plan["fps"] > 0, label
    # The suggested size has to be decodable at the model's shortest clip.
    #
    # Not at an arbitrary duration: this first asserted that two seconds fit,
    # which fails on every card including the one the tier was measured on.
    # That is by design - suggest() returns a starting resolution, and fitting
    # a requested length is plan_clip's job, which shrinks, or plan_sequence's,
    # which chunks. Both are covered below. The invariant here is only that the
    # starting point is not itself impossible.
    assert decode_will_fit(plan["width"], plan["height"], 9, hw) is None, label


@pytest.mark.parametrize("label,vram,ram", CARDS)
def test_a_clip_can_be_planned_on_every_card(label, vram, ram):
    hw = card(vram, ram, label)
    for aspect in ("16:9", "9:16", "1:1"):
        result = plan_clip(seconds=2.0, aspect=aspect, hw=hw)
        assert result["possible"] is True, "%s %s: %s" % (label, aspect, result.get("reason"))
        assert result["seconds"] > 0


@pytest.mark.parametrize("label,vram,ram", CARDS)
def test_a_sequence_can_be_planned_on_every_card(label, vram, ram):
    hw = card(vram, ram, label)
    plan = plan_sequence(5.0, aspect="16:9", hw=hw)
    assert plan["possible"] is True, label
    assert plan["chunks"] >= 1
    assert plan["total_seconds"] > 0
    assert len(plan["chunk_durations"]) == plan["chunks"]


@pytest.mark.parametrize("label,vram,ram", CARDS)
def test_images_can_be_planned_on_every_card(label, vram, ram):
    for model in (image_plan.LADDER[0]["repo"], image_plan.LADDER[1]["repo"]):
        plan = image_plan.plan(model, "16:9", vram_gb=vram * 0.92)
        assert plan["width"] % 8 == 0 and plan["height"] % 8 == 0, label
        assert plan["steps"] > 0
        assert isinstance(plan["offloaded"], bool)


# ---------------------------------------------------------------------------
# Bigger is never worse
# ---------------------------------------------------------------------------

def test_a_bigger_card_never_gets_a_smaller_video():
    sizes = [suggest(card(v))["width"] * suggest(card(v))["height"]
             for _, v, _ in CARDS]
    assert sizes == sorted(sizes), "a larger card produced a smaller frame: %r" % sizes


def test_a_bigger_card_never_needs_more_chunks():
    chunks = [plan_sequence(5.0, "16:9", hw=card(v))["chunks"] for _, v, _ in CARDS]
    assert chunks == sorted(chunks, reverse=True), (
        "a larger card was given more chunks for the same clip: %r" % chunks
    )


def test_a_bigger_card_never_gets_a_smaller_image():
    sdxl = image_plan.LADDER[0]["repo"]
    widths = [image_plan.plan(sdxl, "1:1", vram_gb=v * 0.92)["width"]
              for _, v, _ in CARDS]
    assert widths == sorted(widths), widths


def test_video_resolution_stops_at_the_models_ceiling():
    """Past what LTX-Video was trained for, more pixels is a worse picture.
    A 48 GB card must not be pushed beyond a 24 GB one just because it can."""
    big = suggest(card(24.0))
    huge = suggest(card(80.0))
    assert (huge["width"], huge["height"]) == (big["width"], big["height"])


# ---------------------------------------------------------------------------
# No invented numbers where nothing was measured
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("label,vram,ram", [c for c in CARDS if c[1] >= 12.0])
def test_a_large_card_is_told_it_is_being_timed_rather_than_given_a_figure(
        label, vram, ram):
    hw = card(vram, ram, label)
    plan = suggest(hw)
    result = estimate_seconds(width=plan["width"], height=plan["height"],
                              steps=plan["steps"], seconds=2.0, fps=plan["fps"], hw=hw)
    assert result["bound"] == "unmeasured", label
    assert result["seconds"] is None, (
        "%s is being quoted a duration measured on a 6 GB card" % label
    )
    assert result["text"].strip()


def test_the_first_render_on_a_large_card_makes_the_estimate_real():
    """The whole point of the self-calibration: unknown once, then measured."""
    hw = card(24.0, name="RTX 4090")
    plan = suggest(hw)
    units_per_step = float(plan["width"]) * float(plan["height"]) * 49

    before = estimate_seconds(width=plan["width"], height=plan["height"],
                              steps=plan["steps"], seconds=2.0, fps=plan["fps"], hw=hw)
    assert before["bound"] == "unmeasured"

    calibration.record(hw.gpu_name, True, 4_000_000.0, 18,
                       units_per_step=units_per_step)

    after = estimate_seconds(width=plan["width"], height=plan["height"],
                             steps=plan["steps"], seconds=49 / plan["fps"],
                             fps=plan["fps"], hw=hw)
    assert after["bound"] == "measured"
    assert after["seconds"] and after["seconds"] > 0


def test_a_large_card_holds_the_model_in_vram_rather_than_streaming_it():
    """Which is the difference between seconds and minutes, and is reported."""
    sdxl = image_plan.LADDER[0]["repo"]
    assert image_plan.plan(sdxl, "1:1", vram_gb=22.0)["offloaded"] is False
    assert image_plan.plan(sdxl, "1:1", vram_gb=4.4)["offloaded"] is True


# ---------------------------------------------------------------------------
# Absurd inputs must not produce absurd answers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("vram", [0.0, 0.5, 1.0, 200.0, 1000.0])
def test_extreme_vram_figures_do_not_break_planning(vram):
    hw = card(vram)
    plan = suggest(hw)
    assert plan["width"] > 0 and plan["height"] > 0
    image = image_plan.plan(image_plan.LADDER[1]["repo"], "1:1", vram_gb=vram)
    assert image["width"] >= 256


def test_a_card_reporting_nothing_still_plans_something():
    """mem_get_info can fail on a driver that will not answer."""
    hw = card(0.0)
    hw.vram_free_gb = 0.0
    plan = plan_clip(seconds=2.0, aspect="16:9", hw=hw)
    assert "possible" in plan
    assert plan.get("width", 0) > 0
