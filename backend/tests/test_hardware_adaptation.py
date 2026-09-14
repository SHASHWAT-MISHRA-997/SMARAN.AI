"""The app has to fit the machine it is on, without anyone configuring it.

Two separate problems, both of which would show up on someone else's computer
rather than on the one this was written on.

**Estimates came from one card.** Every duration was derived from a single
constant timed on a 6 GB RTX 2060 that was streaming layers off the host
because the model did not fit - the slowest path there is - and then applied
to every machine. An RTX 4090 was told a two second clip would take "under 6.4
hours" when it is minutes. That is not a conservative estimate, it is a wrong
one, and it reads as a broken app.

**A rate measured at one size does not describe another.** Found by measuring
rather than reasoning: on the 6 GB card at 20 steps, a 9-frame clip took 2.73 s
per step and a 41-frame clip about 66 s. Four and a half times the work, twenty
four times the time - once a clip stops fitting comfortably the cost stops
being proportional. A rate timed on a short render therefore predicts about
four minutes for a job that really takes twenty-five, which is the dangerous
direction: the user waits, and it does not finish.

So a measurement only speaks for clips near its own size, and anything further
away falls back to the shipped conservative bound.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.video import calibration  # noqa: E402
from app.video.hardware import Hardware, probe  # noqa: E402
from app.video.planner import estimate_seconds, suggest  # noqa: E402

GPU = "Test GPU 9000"


def machine(vram=6.0, name=GPU, ram=16.0):
    return Hardware(
        has_cuda=True, gpu_name=name, vram_total_gb=vram, vram_free_gb=vram * 0.9,
        compute_capability=(8, 9), supports_bfloat16=True, torch_version="2.14",
        torch_is_cuda_build=True, disk_free_gb=500.0, reason="",
        cpu_cores=8, cpu_threads=16, cpu_name="test", ram_total_gb=ram,
        ram_free_gb=ram * 0.5,
    )


@pytest.fixture(autouse=True)
def isolated_calibration(tmp_path, monkeypatch):
    """Never read or write the real machine's calibration from a test."""
    monkeypatch.setattr(calibration, "_cache", {})
    monkeypatch.setattr(calibration, "_path", lambda: str(tmp_path / "calib.json"))
    yield
    monkeypatch.setattr(calibration, "_cache", None)


# ---------------------------------------------------------------------------
# The machine is actually looked at
# ---------------------------------------------------------------------------

def test_cpu_and_ram_are_detected():
    """RAM is what ran out and caused a segfault, and nothing measured it."""
    hw = probe()
    assert hw.ram_total_gb > 0, "system RAM is not detected"
    assert hw.cpu_threads > 0, "the processor is not detected"
    assert "ram_total_gb" in hw.as_dict()
    assert "cpu_threads" in hw.as_dict()


def test_video_settings_scale_with_the_card():
    """A better card must produce a better picture with no setup at all."""
    small = suggest(machine(vram=6.0))
    large = suggest(machine(vram=24.0))
    assert large["width"] > small["width"]
    assert large["height"] > small["height"]


def test_a_huge_card_is_not_pushed_past_the_model():
    """Beyond what the model was trained for, more pixels is a worse picture -
    the same trap as Stable Diffusion 1.5 above 768."""
    big = suggest(machine(vram=24.0))
    huge = suggest(machine(vram=80.0))
    assert (huge["width"], huge["height"]) == (big["width"], big["height"])


# ---------------------------------------------------------------------------
# No invented numbers for hardware nobody measured
# ---------------------------------------------------------------------------

def test_a_fast_card_is_not_given_a_slow_cards_number():
    """The 6.4 hours. A figure that wrong is worse than admitting ignorance."""
    result = estimate_seconds(width=1280, height=768, steps=40, seconds=2.0,
                              fps=24, hw=machine(vram=24.0))
    assert result["bound"] == "unmeasured"
    assert result["seconds"] is None, (
        "a number is being quoted for a path that has never been timed"
    )
    assert "timed" in result["text"]


def test_the_slow_path_still_gets_its_measured_bound():
    """That constant is honest about the machine it came from."""
    result = estimate_seconds(width=704, height=448, steps=20, seconds=2.0,
                              fps=24, hw=machine(vram=6.0))
    assert result["bound"] == "at most"
    assert result["seconds"] > 0


def test_cpu_only_says_so_rather_than_guessing():
    hw = machine()
    hw.has_cuda = False
    result = estimate_seconds(width=704, height=448, steps=20, seconds=2.0,
                              fps=24, hw=hw)
    assert result["seconds"] is None


# ---------------------------------------------------------------------------
# Measuring this machine
# ---------------------------------------------------------------------------

def test_a_measurement_is_used_once_it_exists():
    units_per_step = 704 * 448 * 41
    calibration.record(GPU, False, 200_000.0, 18, units_per_step=units_per_step)
    result = estimate_seconds(width=704, height=448, steps=20, seconds=2.0,
                              fps=24, hw=machine(vram=6.0))
    assert result["bound"] == "measured"
    assert "measured on this machine" in result["text"]


def test_a_measurement_does_not_speak_for_a_very_different_size():
    """The whole point. 9 frames timed at 2.73 s/step and 41 frames at 66 s -
    stretching the first across the second predicted 4 minutes for a 25 minute
    job, and the user would have been told to expect the wrong thing."""
    calibration.record(GPU, False, 1_018_165.0, 18, units_per_step=736 * 416 * 9)

    near = estimate_seconds(width=736, height=416, steps=20, seconds=9 / 24,
                            fps=24, hw=machine(vram=6.0))
    assert near["bound"] == "measured"

    far = estimate_seconds(width=736, height=416, steps=20, seconds=41 / 24,
                           fps=24, hw=machine(vram=6.0))
    assert far["bound"] == "at most", (
        "a rate timed on a 9 frame clip is being applied to a 41 frame one"
    )


def test_resident_and_offloaded_are_kept_apart():
    """They are different machines as far as throughput goes; one average
    describes neither."""
    units = 704 * 448 * 41
    calibration.record(GPU, False, 200_000.0, 18, units_per_step=units)
    assert calibration.units_per_sec(GPU, True, units) is None
    assert calibration.units_per_sec(GPU, False, units) == 200_000.0


def test_a_repeat_at_the_same_size_replaces_the_old_reading():
    units = 704 * 448 * 41
    calibration.record(GPU, False, 100_000.0, 18, units_per_step=units)
    calibration.record(GPU, False, 300_000.0, 18, units_per_step=units)
    assert calibration.units_per_sec(GPU, False, units) == 300_000.0


def test_different_sizes_are_both_remembered():
    small, large = 736 * 416 * 9, 704 * 448 * 41
    calibration.record(GPU, False, 1_000_000.0, 18, units_per_step=small)
    calibration.record(GPU, False, 200_000.0, 18, units_per_step=large)
    assert calibration.units_per_sec(GPU, False, small) == 1_000_000.0
    assert calibration.units_per_sec(GPU, False, large) == 200_000.0


def test_rubbish_measurements_are_ignored():
    units = 704 * 448 * 41
    calibration.record(GPU, False, 0.0, 18, units_per_step=units)
    calibration.record(GPU, False, 200_000.0, 1, units_per_step=units)
    calibration.record(GPU, False, 200_000.0, 18, units_per_step=0)
    assert calibration.units_per_sec(GPU, False, units) is None


def test_recording_never_deadlocks():
    """record() takes the lock and then calls load(), which takes it again.
    With a plain Lock that hangs the job for ever, after the render succeeded
    and with no error anywhere."""
    import threading

    done = threading.Event()

    def run():
        calibration.record(GPU, False, 200_000.0, 18, units_per_step=1000)
        calibration.units_per_sec(GPU, False, 1000)
        done.set()

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    assert done.wait(timeout=10), "calibration deadlocked"


# ---------------------------------------------------------------------------
# The step timer
# ---------------------------------------------------------------------------

def test_the_timer_ignores_warm_up_steps():
    """The first step carries one-off work and makes the machine look slow."""
    timer = calibration.StepTimer(units_per_step=1000, total_steps=20)
    for _ in range(calibration.WARMUP_STEPS):
        timer.step()
    assert timer.rate() is None


def test_the_timer_needs_enough_steps_before_it_claims_a_rate():
    timer = calibration.StepTimer(units_per_step=1000, total_steps=20)
    for _ in range(calibration.WARMUP_STEPS + 1):
        timer.step()
    assert timer.rate() is None


def test_the_timer_produces_a_rate_from_real_elapsed_time():
    import time as _time

    timer = calibration.StepTimer(units_per_step=1000, total_steps=20)
    for _ in range(calibration.WARMUP_STEPS):
        timer.step()
    for _ in range(calibration.MIN_STEPS):
        _time.sleep(0.01)
        timer.step()
    rate = timer.rate()
    assert rate and rate > 0
    assert timer.samples() >= calibration.MIN_STEPS


def test_the_engine_records_the_size_it_measured_at():
    import inspect

    from app.video import ltx_engine

    source = inspect.getsource(ltx_engine.generate)
    assert "units_per_step=timer.units_per_step" in source, (
        "the measurement is stored without the size it applies to, so it will "
        "be reused for clips it does not describe"
    )
