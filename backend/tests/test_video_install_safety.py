"""Exercise installer failures without importing or changing real user packages."""
import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def installer(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "isolated_video_install", Path(__file__).parents[1] / "app/video/install.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "packages_dir", lambda: str(tmp_path / "live"))
    return module


def prepare(installer):
    live = Path(installer.packages_dir())
    live.mkdir()
    (live / "old.txt").write_text("working")
    staging = Path(installer.staging_dir())
    staging.mkdir()
    (staging / installer.COMPLETE_MARKER).write_text("complete")
    (staging / "new.txt").write_text("replacement")
    return live, staging


def test_loaded_packages_are_never_replaced(installer):
    live, staging = prepare(installer)
    installer._activated_directory = str(live.resolve())
    assert not installer.promote_staged()
    assert (live / "old.txt").read_text() == "working"
    assert staging.exists()


def test_failed_promotion_restores_working_copy(installer, monkeypatch):
    live, staging = prepare(installer)
    rename = installer.os.rename

    def fail_staging(source, destination):
        if source == str(staging):
            raise PermissionError("locked")
        return rename(source, destination)

    monkeypatch.setattr(installer.os, "rename", fail_staging)
    assert not installer.promote_staged()
    assert (live / "old.txt").read_text() == "working"
    assert staging.exists()


def test_unfinished_install_never_promotes(installer):
    live, staging = prepare(installer)
    (staging / installer.COMPLETE_MARKER).unlink()
    assert not installer.promote_staged()
    assert (live / "old.txt").exists()


def test_retry_preserves_completed_download(installer):
    _, staging = prepare(installer)
    assert installer.start()["started"] is False
    assert installer._state["restart_required"] is True
    assert (staging / "new.txt").exists()


def test_unexpected_worker_failure_is_terminal(installer, monkeypatch):
    def fail(_):
        raise OSError("disk full")
    monkeypatch.setattr(installer, "_install", fail)
    installer._state["status"] = "running"
    installer._run()
    assert installer._state["status"] == "failed"
    assert "disk full" in installer._state["error"]


def test_partial_dependencies_are_not_reported_as_installed(installer, monkeypatch):
    def import_package(name):
        if name == "diffusers":
            raise ImportError("missing dependency")
    monkeypatch.setattr(installer.importlib, "import_module", import_package)
    assert installer._package_error() == "diffusers: missing dependency"


def test_binary_load_error_is_reported_without_crashing_status(installer, monkeypatch):
    def import_package(name):
        raise OSError("DLL load failed")
    monkeypatch.setattr(installer.importlib, "import_module", import_package)
    monkeypatch.setattr(installer, "_python_that_can_install", lambda: None)
    result = installer.status()
    assert result["installed"] is False
    assert result["can_install"] is False


def test_progress_counts_received_bytes_not_unfinished_file_sizes(installer, monkeypatch):
    commands = []
    class FailedDownload:
        stdout = ["Downloading first.whl\n", "Progress 100 of 100\n",
                  "Downloading second.whl\n", "Progress 30 of 80\n",
                  "Downloading retry.whl\n", "Progress 20 of 50\n",
                  "ERROR: connection lost\n"]
        returncode = 1
        def wait(self):
            return self.returncode
    def popen(command, **kwargs):
        commands.append(command)
        return FailedDownload()
    monkeypatch.setattr(installer, "_python_that_can_install", lambda: "fixture-python")
    monkeypatch.setattr(installer.subprocess, "Popen", popen)
    installer._run()
    assert installer._state["downloaded_bytes"] == 150
    assert installer._state["status"] == "failed"
    assert "connection lost" in installer._state["error"]
    assert installer.staging_dir() in commands[0]
    assert installer.packages_dir() not in commands[0]
    assert not (Path(installer.staging_dir()) / installer.COMPLETE_MARKER).exists()
