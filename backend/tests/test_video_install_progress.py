"""What the installer reports while it works, and what stopping it does.

The numbers on this panel describe a download that takes the better part of an
hour, so an invented one is worse than none. Everything here is about the
difference between "not known yet" and "zero", and about a cancel that stops
the download rather than the label.
"""
import importlib.util
import sys
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def installer(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "isolated_video_progress", Path(__file__).parents[1] / "app/video/install.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "packages_dir", lambda: str(tmp_path / "live"))
    return module


# ---- speed ----------------------------------------------------------------

def test_speed_is_unknown_rather_than_zero_before_anything_arrives(installer):
    """A speed of zero reads as a stalled download."""
    assert installer._speed_bytes_per_second() is None


def test_speed_is_still_unknown_from_a_single_sample(installer):
    installer._state["samples"] = [(1000.0, 0)]
    assert installer._speed_bytes_per_second() is None


def test_speed_is_measured_over_the_window(installer):
    installer._state["samples"] = [(1000.0, 0), (1010.0, 20_000_000)]
    assert installer._speed_bytes_per_second() == pytest.approx(2_000_000)


def test_a_sample_pair_too_close_together_is_not_a_measurement(installer):
    """Two counts a tenth of a second apart give a wild figure."""
    installer._state["samples"] = [(1000.0, 0), (1000.2, 5_000_000)]
    assert installer._speed_bytes_per_second() is None


def test_old_samples_age_out_so_one_slow_patch_is_not_permanent(installer, monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(installer.time, "time", lambda: clock["now"])
    for step in range(0, 60, 5):
        clock["now"] = 1000.0 + step
        with installer._lock:
            installer._record_progress(step * 1_000_000)
    oldest = installer._state["samples"][0][0]
    assert clock["now"] - oldest <= installer.SPEED_WINDOW_SECONDS


# ---- what status() publishes ----------------------------------------------

def test_speed_and_eta_are_absent_until_they_are_known(installer):
    reported = installer.status()
    assert reported["bytes_per_second"] is None
    assert reported["current_eta_seconds"] is None


def test_eta_is_only_offered_for_a_file_whose_size_is_known(installer):
    installer._state.update(status="running", current_bytes=1_000_000,
                            current_total=0,
                            samples=[(1000.0, 0), (1010.0, 10_000_000)])
    # An indeterminate download reports its speed and refuses to guess an end.
    assert installer.status()["bytes_per_second"] is not None
    assert installer.status()["current_eta_seconds"] is None


def test_eta_is_computed_from_the_measured_rate(installer):
    installer._state.update(status="running", current_bytes=10_000_000,
                            current_total=110_000_000,
                            samples=[(1000.0, 0), (1010.0, 10_000_000)])
    # 100 MB left at 1 MB/s.
    assert installer.status()["current_eta_seconds"] == 100


def test_the_phase_says_which_work_this_is(installer):
    assert installer.status()["phase"] is None
    installer._state["phase"] = "packages"
    assert installer.status()["phase"] == "packages"


def test_disk_space_is_reported_with_what_is_required(installer):
    reported = installer.status()
    assert reported["required_free_gb"] == installer.REQUIRED_FREE_GB
    assert reported["free_space_gb"] is None or reported["free_space_gb"] > 0


def test_free_space_is_measured_on_a_directory_that_does_not_exist_yet(installer):
    """The staging directory is asked about before it is created."""
    missing = str(Path(installer.packages_dir()) / "not" / "there" / "yet")
    assert installer.free_space_gb(missing) is not None


# ---- refusing to start ----------------------------------------------------

def test_an_install_with_no_room_fails_before_downloading_anything(installer, monkeypatch):
    monkeypatch.setattr(installer, "free_space_gb", lambda _path: 0.5)
    started = []
    monkeypatch.setattr(installer.subprocess, "Popen",
                        lambda *a, **k: started.append(a) or (_ for _ in ()).throw(
                            AssertionError("pip must not be started")))
    installer._install()
    assert installer._state["status"] == "failed"
    assert "disk space" in installer._state["error"].lower()
    assert "0.5" in installer._state["error"], "it should say how much is free"
    assert started == []


def test_an_unmeasurable_drive_does_not_block_the_install(installer, monkeypatch):
    """None means 'could not tell', which is not the same as 'no room'."""
    monkeypatch.setattr(installer, "free_space_gb", lambda _path: None)
    monkeypatch.setattr(installer, "_python_that_can_install", lambda: None)
    installer._install()
    # Stopped for the missing interpreter, not for disk space.
    assert "disk space" not in (installer._state["error"] or "").lower()


# ---- cancelling -----------------------------------------------------------

class FakePip:
    """A pip that keeps producing output until it is told to stop."""

    def __init__(self):
        self.terminated = False
        self.killed = False
        self.returncode = 0

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        if not self.terminated:
            raise subprocess.TimeoutExpired("pip", timeout or 0)
        return 0


def test_cancelling_nothing_says_so(installer):
    assert installer.cancel()["cancelled"] is False


def test_cancelling_stops_the_download_itself(installer):
    """Not a flag: the point of cancel is that the bytes stop arriving."""
    pip = FakePip()
    installer._state["status"] = "running"
    installer._process = pip

    result = installer.cancel()

    assert result["cancelled"] is True
    assert pip.terminated, "the pip process must be stopped"
    assert installer._cancelled.is_set()


def test_a_pip_that_ignores_terminate_is_killed(installer):
    pip = FakePip()

    def stubborn():
        raise subprocess.TimeoutExpired("pip", 10)
    pip.wait = lambda timeout=None: stubborn()

    installer._state["status"] = "running"
    installer._process = pip
    installer.cancel()
    assert pip.killed


def test_a_cancelled_install_is_not_reported_as_a_failure(installer, monkeypatch):
    """It is also not reported as done, which would promote a partial copy."""
    installer._state["status"] = "running"
    installer._cancelled.set()
    # The staging directory a cancelled run leaves behind.
    staging = Path(installer.staging_dir())
    staging.mkdir(parents=True)
    (staging / "half.txt").write_text("partial")

    removed = []
    monkeypatch.setattr(installer, "_discard_later", removed.append)

    class Finished:
        returncode = 0
        stdout = iter(())

        def wait(self):
            return 0

    monkeypatch.setattr(installer.subprocess, "Popen", lambda *a, **k: Finished())
    monkeypatch.setattr(installer, "_python_that_can_install", lambda: "python")
    monkeypatch.setattr(installer, "free_space_gb", lambda _p: 100.0)

    installer._install()

    assert installer._state["status"] == "cancelled"
    assert installer._state["error"] is None
    assert not (staging / installer.COMPLETE_MARKER).exists(), \
        "a cancelled install must never be marked complete"
    assert removed, "the half-written staging directory should be discarded"


# ---- what a real 4.76 GB install exposed ----------------------------------

@pytest.mark.parametrize("line,expected", [
    ("  Using cached torch-2.6.0%2Bcu126-cp314-win_amd64.whl (2.5 GB)", 2_500_000_000),
    ("  Using cached numpy-2.1.0-cp314-win_amd64.whl (12.6 MB)", 12_600_000),
    ("  Using cached six-1.16.0-py2.py3-none-any.whl (11 kB)", 11_000),
])
def test_a_wheel_served_from_the_cache_counts_as_progress(installer, line, expected):
    """A real install came entirely from pip's cache and showed 0% throughout.

    pip transfers nothing for these and prints no byte counter, so the only
    figure available is the size in the line itself.
    """
    match = installer._CACHED.match(line)
    assert match, line
    size = float(match.group(2)) * installer._UNIT_BYTES[match.group(3)]
    assert size == expected


def test_a_downloading_line_is_not_read_as_a_cached_one(installer):
    assert installer._CACHED.match("  Downloading torch-2.6.0.whl (2.5 GB)") is None


def test_cached_bytes_move_the_bar_without_being_called_a_download(installer):
    installer._state.update(status="running", cached_bytes=1_600_000_000,
                            downloaded_bytes=0, current_bytes=0)
    reported = installer.status()
    assert reported["downloaded_bytes"] == 0, "nothing was transferred"
    assert reported["cached_bytes"] == 1_600_000_000
    assert reported["obtained_bytes"] == 1_600_000_000
    assert reported["approx_percent"] == 50, "a cached install must not sit at 0%"


def test_an_install_is_not_called_failed_when_the_old_copy_is_still_loaded(
        installer, monkeypatch, tmp_path):
    """The defect a real 4.76 GB install exposed.

    pip finished and every file was in place, but the check that follows
    imports these packages - and this process already had an older torch in
    sys.modules, so it measured the old copy against the new one and reported
    a working install as broken.
    """
    monkeypatch.setitem(sys.modules, "torch", object())
    monkeypatch.setattr(installer, "free_space_gb", lambda _p: 100.0)
    monkeypatch.setattr(installer, "_python_that_can_install", lambda: "python")
    monkeypatch.setattr(installer, "promote_staged", lambda: True)
    monkeypatch.setattr(installer, "ensure_on_path", lambda: True)
    # The import check would fail here, exactly as it did on the real machine.
    monkeypatch.setattr(
        installer, "_package_error",
        lambda: "torchvision: operator torchvision::nms does not exist")

    class Finished:
        returncode = 0
        stdout = iter(("Successfully installed torch-2.6.0",))

        def wait(self):
            return 0

    monkeypatch.setattr(installer.subprocess, "Popen", lambda *a, **k: Finished())

    installer._install()

    assert installer._state["status"] == "done", installer._state["error"]
    assert installer._state["restart_required"] is True
    assert installer._state["error"] is None


def test_the_check_still_runs_when_nothing_was_loaded_first(installer, monkeypatch):
    """The guard above must not switch the verification off for everyone."""
    for name in ("torch", "torchvision", "diffusers", "transformers",
                 "accelerate", "sentencepiece"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setattr(installer, "free_space_gb", lambda _p: 100.0)
    monkeypatch.setattr(installer, "_python_that_can_install", lambda: "python")
    monkeypatch.setattr(installer, "promote_staged", lambda: True)
    monkeypatch.setattr(installer, "ensure_on_path", lambda: True)
    monkeypatch.setattr(installer, "_package_error", lambda: "torch: not found")

    class Finished:
        returncode = 0
        stdout = iter(())

        def wait(self):
            return 0

    monkeypatch.setattr(installer.subprocess, "Popen", lambda *a, **k: Finished())

    installer._install()
    assert installer._state["status"] == "failed"
    assert "could not be loaded" in installer._state["error"]


def test_starting_again_clears_a_previous_cancellation(installer, monkeypatch):
    installer._cancelled.set()
    monkeypatch.setattr(installer.threading, "Thread",
                        lambda *a, **k: type("T", (), {"start": lambda self: None})())
    installer.start()
    assert not installer._cancelled.is_set()
    assert installer._state["phase"] == "packages"
    assert installer._state["samples"] == []
