"""Models the user puts in their own characters folder.

Amarya still ships. This is the folder beside her: somewhere to drop a model
you hold the rights to, read from your own machine and never sent anywhere.

The listing walks a directory the user controls and turns folder names into
URLs, which is the part worth pinning down - a name is not a path, and a
directory that is not a model should be ignored rather than half-listed.
"""

import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import main as app_main            # noqa: E402


@pytest.fixture()
def characters(tmp_path, monkeypatch):
    """Point the listing at an empty folder under the test's own directory."""
    folder = tmp_path / "characters"
    folder.mkdir()
    monkeypatch.setattr(app_main, "_CHARACTER_DIR", str(folder))
    return folder


def listed(*, loop=None):
    import asyncio
    return asyncio.run(app_main.list_user_characters())


def test_a_fresh_install_lists_nothing(characters):
    result = listed()
    assert result["characters"] == []
    # The folder is reported so the app can tell someone where to put a model.
    assert result["folder"] == str(characters)


def test_a_folder_holding_a_model_is_offered(characters):
    (characters / "Rin").mkdir()
    (characters / "Rin" / "model.pmx").write_bytes(b"PMX ")

    entry = listed()["characters"][0]
    assert entry["id"] == "Rin"
    assert entry["name"] == "Rin"
    assert entry["file"] == "/api/characters/files/Rin/model.pmx"


def test_a_folder_with_no_pmx_is_skipped(characters):
    (characters / "notes").mkdir()
    (characters / "notes" / "readme.txt").write_text("nothing to load")
    assert listed()["characters"] == []


def test_a_loose_pmx_is_not_a_character(characters):
    # A PMX dropped straight into the folder has no directory for its textures,
    # so it would load untextured. Only a folder will do for that format.
    (characters / "stray.pmx").write_bytes(b"PMX ")
    assert listed()["characters"] == []


def test_a_loose_vrm_is_a_character(characters):
    # A VRM is the opposite case: it carries its own textures, so a single file
    # is complete and asking for a folder around it would be pointless
    # ceremony. This is the file VRoid Studio exports.
    (characters / "Aiko.vrm").write_bytes(b"glTF")
    entry = listed()["characters"][0]
    # Shown without the suffix - "Aiko.vrm" is not a name anyone wants in a
    # picker - while the id stays the filename so it round-trips.
    assert entry["name"] == "Aiko"
    assert entry["id"] == "Aiko.vrm"
    assert entry["file"] == "/api/characters/files/Aiko.vrm"


def test_a_vrm_wins_over_a_pmx_in_the_same_folder(characters):
    # Both would load, but only the VRM is certain to have its textures and a
    # standard expression set beside it.
    (characters / "Both").mkdir()
    (characters / "Both" / "model.pmx").write_bytes(b"PMX ")
    (characters / "Both" / "model.vrm").write_bytes(b"glTF")
    assert listed()["characters"][0]["file"].endswith("model.vrm")


def test_an_unrelated_loose_file_is_ignored(characters):
    (characters / "notes.txt").write_text("not a character")
    (characters / "photo.png").write_bytes(b"\x89PNG")
    assert listed()["characters"] == []


def test_a_name_with_spaces_survives_as_a_url(characters):
    (characters / "My Model").mkdir()
    (characters / "My Model" / "a.pmx").write_bytes(b"PMX ")
    entry = listed()["characters"][0]
    # The name is shown as typed; the URL is encoded.
    assert entry["name"] == "My Model"
    assert entry["file"] == "/api/characters/files/My%20Model/a.pmx"


def test_a_name_that_looks_like_a_path_is_encoded_not_obeyed(characters):
    """A folder cannot climb out of the characters directory through its name.

    A user could not normally create this, but the listing must not be the
    thing that turns a name into a traversal - so the separators are encoded
    rather than passed through.
    """
    odd = characters / "up..down"
    odd.mkdir()
    (odd / "m.pmx").write_bytes(b"PMX ")
    entry = listed()["characters"][0]
    assert entry["file"].startswith("/api/characters/files/")
    assert "/../" not in entry["file"]


def test_the_first_model_is_chosen_and_the_order_is_stable(characters):
    (characters / "Two").mkdir()
    for name in ("b.pmx", "a.pmx"):
        (characters / "Two" / name).write_bytes(b"PMX ")
    assert listed()["characters"][0]["file"].endswith("/a.pmx")


def test_several_folders_come_back_in_a_predictable_order(characters):
    for name in ("zeta", "Alpha", "mid"):
        (characters / name).mkdir()
        (characters / name / "m.pmx").write_bytes(b"PMX ")
    names = [c["name"] for c in listed()["characters"]]
    assert names == ["Alpha", "mid", "zeta"]


def test_an_unreadable_folder_is_an_empty_list_not_a_crash(tmp_path, monkeypatch):
    # The folder is the user's; it can be deleted while the app is running.
    monkeypatch.setattr(app_main, "_CHARACTER_DIR", str(tmp_path / "gone"))
    assert listed()["characters"] == []


def test_nothing_is_written_by_listing(characters):
    (characters / "Rin").mkdir()
    (characters / "Rin" / "model.pmx").write_bytes(b"PMX ")
    before = sorted(os.listdir(characters))
    listed()
    assert sorted(os.listdir(characters)) == before
