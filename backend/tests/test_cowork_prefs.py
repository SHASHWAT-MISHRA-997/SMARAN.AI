"""Settings -> Cowork is enforced: Dispatch, trusted folders, browser, artifacts."""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from app import cowork_prefs


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(cowork_prefs.settings, "DATA_DIR", str(tmp_path / "data"))
    return tmp_path


def test_defaults_are_the_users_own_folder_not_a_developers():
    prefs = cowork_prefs.load()
    assert prefs["cowork_files_path"] == str(Path.home() / "SMARAN" / "Cowork")


@pytest.mark.parametrize("folder", ["C:\\", "/", "relative/path", ""])
def test_unsafe_folders_are_refused(folder):
    with pytest.raises(ValueError):
        cowork_prefs.save({"trusted_folders": [folder]})


def test_system_and_home_folders_are_refused():
    import os
    for folder in (os.environ.get("SystemRoot", r"C:\Windows"), str(Path.home())):
        with pytest.raises(ValueError):
            cowork_prefs.save({"cowork_files_path": folder})


def test_trusted_folder_checks_every_path(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    cowork_prefs.save({"trusted_folders": [str(work)]})
    assert cowork_prefs.in_trusted_folder(str(work / "a.txt"))
    assert cowork_prefs.in_trusted_folder(str(work / "a.txt"), str(work / "sub" / "b.txt"))
    assert not cowork_prefs.in_trusted_folder(str(work / "a.txt"), str(tmp_path / "elsewhere.txt"))
    assert not cowork_prefs.in_trusted_folder(str(work / ".." / "escape.txt"))


def test_trusted_folders_skip_the_question_but_deleting_still_asks(tmp_path):
    from app.desktop_agent import DesktopAgent
    work = tmp_path / "work"
    work.mkdir()
    (work / "a.txt").write_text("x")
    cowork_prefs.save({"trusted_folders": [str(work)]})
    outside = asyncio.run(DesktopAgent.execute("move_file", {"source": str(work / "a.txt"),
                                                             "destination": str(tmp_path / "c.txt")}))
    assert outside.get("requires_confirmation") and (work / "a.txt").exists()
    moved = asyncio.run(DesktopAgent.execute("move_file", {"source": str(work / "a.txt"),
                                                           "destination": str(work / "b.txt")}))
    assert not moved.get("requires_confirmation") and (work / "b.txt").exists()
    (work / "a.txt").write_text("x")
    deleting = asyncio.run(DesktopAgent.execute("delete_file", {"path": str(work / "a.txt")}))
    assert deleting.get("requires_confirmation")


def test_dispatch_off_stops_work_both_ways():
    from app import companion
    cowork_prefs.save({"dispatch_enabled": False})
    with pytest.raises(HTTPException) as refused:
        companion._require_dispatch()
    assert refused.value.status_code == 403
    assert companion.notify_paired_devices("hello") == 0


def test_artifacts_are_copied_with_readable_names(tmp_path):
    out = tmp_path / "abc123.png"
    out.write_bytes(b"png")
    cowork_prefs.save({"cowork_files_path": str(tmp_path / "Cowork")})
    kept = cowork_prefs.keep_artifact(str(out), "Images", "A red fox in the snow!")
    assert kept and Path(kept).parent.name == "Images" and "a-red-fox-in-the-snow" in Path(kept).name
    assert Path(kept).read_bytes() == b"png"
