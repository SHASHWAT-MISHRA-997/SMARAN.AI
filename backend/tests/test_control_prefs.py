"""Settings -> Capabilities switches are enforced where desktop actions run."""
import asyncio

import pytest

from app import control_prefs
from app.desktop_agent import DESKTOP_ACTION_CATALOG, DesktopAgent


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(control_prefs.settings, "DATA_DIR", str(tmp_path))


def run(action, params=None, confirmed=False):
    return asyncio.run(DesktopAgent.execute(action, params or {}, confirmed=confirmed))


def test_switching_computer_use_off_blocks_every_action():
    control_prefs.save({"computer_use_enabled": False})
    out = run("open_url", {"url": "https://example.com"}, confirmed=True)
    assert out["blocked"] and "switched off" in out["error"]


def test_confirmation_can_be_skipped_for_ordinary_changes_but_never_for_power():
    low = next(k for k, v in DESKTOP_ACTION_CATALOG.items()
               if v.get("requires_confirmation") and v.get("risk") == "low" and v.get("category") != "power")
    control_prefs.save({"confirm_changes": False})
    assert not control_prefs.must_confirm(DESKTOP_ACTION_CATALOG[low])
    for power in ("sleep_computer", "restart_computer", "shutdown_computer"):
        assert control_prefs.must_confirm(DESKTOP_ACTION_CATALOG[power])
        out = run(power)
        assert out.get("requires_confirmation") is True and not out.get("success")


def test_confirmation_is_on_by_default():
    assert control_prefs.load() == {"computer_use_enabled": True, "confirm_changes": True}
    low = next(k for k, v in DESKTOP_ACTION_CATALOG.items() if v.get("requires_confirmation"))
    assert run(low).get("requires_confirmation") is True


def test_capabilities_are_checked_not_asserted():
    caps = control_prefs.capabilities()
    assert caps["checks"] and all({"name", "ok", "note"} <= set(c) for c in caps["checks"])
    assert caps["ready"] == all(c["ok"] for c in caps["checks"])
