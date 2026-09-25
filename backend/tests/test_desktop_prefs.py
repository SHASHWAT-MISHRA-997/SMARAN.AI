"""Settings -> General (Desktop) switches are applied, not just stored."""
import sys

import pytest

from app import desktop_prefs as d


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(d.settings, "DATA_DIR", str(tmp_path))
    yield
    d.keep_awake.set(False)
    d.hotkey.stop()


def test_version_is_live_not_saved():
    from app.updates import APP_VERSION
    d.save({"keep_awake": False})
    assert d.status()["version"] == APP_VERSION


def test_startup_is_refused_outside_the_installed_app(monkeypatch):
    monkeypatch.setattr(d, "installed", lambda: False)
    out = d.save({"run_on_startup": True})
    assert out["errors"] and "installed app" in out["errors"][0]
    assert d.load()["run_on_startup"] is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows registry")
def test_startup_entry_is_written_and_removed(monkeypatch):
    monkeypatch.setattr(d, "installed", lambda: True)
    monkeypatch.setattr(d, "RUN_NAME", "SMARAN.AI.test")
    try:
        assert not d.save({"run_on_startup": True})["errors"]
        assert d.startup_registered()
    finally:
        d.save({"run_on_startup": False})
    assert not d.startup_registered()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows power request")
def test_keep_awake_is_held_and_released():
    d.save({"keep_awake": True})
    assert d.keep_awake.active and d.status()["keep_awake_active"]
    d.save({"keep_awake": False})
    assert not d.keep_awake.active


@pytest.mark.parametrize("text,ok", [("Ctrl+Alt+Space", True), ("ctrl + shift + k", True), ("Alt+F9", True),
                                     ("Space", False), ("Ctrl+Alt+Nope", False)])
def test_hotkey_parsing(text, ok):
    if ok:
        mods, key = d.parse_hotkey(text)
        assert mods and key
    else:
        with pytest.raises(ValueError):
            d.parse_hotkey(text)


def test_a_bad_hotkey_is_reported_and_not_saved():
    out = d.save({"quick_entry_shortcut": "Space"})
    assert out["errors"]
    assert d.load()["quick_entry_shortcut"] == "Ctrl+Alt+Space"
