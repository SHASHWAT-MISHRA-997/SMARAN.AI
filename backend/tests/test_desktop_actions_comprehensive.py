"""Comprehensive regressions for desktop actions.

Guards against:
1. False deletion claims: _action_delete_file and _action_delete_folder previously
   passed invalid PowerShell enum strings ('UIOption.OnlyErrorDialogs' instead of
   'OnlyErrorDialogs'), which failed silently in PowerShell while reporting success.
2. Unconfirmed system power mutations: shutdown, restart, sleep, and lock must
   require confirmation and obey destructive action policy.
3. System file protection: deletion must reject paths outside safe user directories.
"""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.desktop_agent import DesktopAgent


def test_delete_file_actually_removes_file(tmp_path, monkeypatch):
    """Deleting a file must actually delete it, not just report success."""
    # Ensure tmp_path is recognized as safe for this test
    monkeypatch.setattr("app.desktop_agent._is_safe_path", lambda p: True)
    f = tmp_path / "test_target.txt"
    f.write_text("content to be deleted", encoding="utf-8")
    assert f.exists()

    result = DesktopAgent._action_delete_file({"path": str(f)})
    assert result["success"] is True
    assert not f.exists(), "delete_file reported success but the file still exists on disk"


def test_delete_folder_actually_removes_folder(tmp_path, monkeypatch):
    """Deleting a folder must actually remove the directory and its contents."""
    monkeypatch.setattr("app.desktop_agent._is_safe_path", lambda p: True)
    folder = tmp_path / "test_dir"
    folder.mkdir()
    (folder / "file.txt").write_text("sub-file", encoding="utf-8")
    assert folder.is_dir()

    result = DesktopAgent._action_delete_folder({"path": str(folder)})
    assert result["success"] is True
    assert not folder.exists(), "delete_folder reported success but the folder still exists on disk"


def test_delete_system_file_refused():
    """Attempting to delete files outside user safe roots must be refused."""
    sys_path = r"C:\Windows\System32\drivers\etc\hosts" if sys.platform == "win32" else "/etc/hosts"
    result = DesktopAgent._action_delete_file({"path": sys_path})
    assert result["success"] is False
    assert "system files" in result["error"].lower()


@pytest.mark.parametrize("action_id", [
    "shutdown_computer",
    "restart_computer",
    "sleep_computer",
    "lock_computer",
    "delete_file",
    "delete_folder",
    "empty_recycle_bin",
])
def test_destructive_actions_require_confirmation(action_id):
    """Destructive actions must never execute without explicit confirmation."""
    import asyncio
    result = asyncio.run(DesktopAgent.execute(action_id, {}, confirmed=False))
    assert result["success"] is False
    assert result.get("requires_confirmation") is True


@pytest.mark.parametrize("action_id", [
    "shutdown_computer",
    "restart_computer",
    "sleep_computer",
    "lock_computer",
    "delete_file",
    "delete_folder",
    "empty_recycle_bin",
])
def test_destructive_actions_blocked_by_policy(action_id):
    """Security setting blocking destructive actions must stop execution even if confirmed."""
    import asyncio
    result = asyncio.run(DesktopAgent.execute(action_id, {"allow_destructive": "block"}, confirmed=True))
    assert result["success"] is False
    assert result.get("blocked") is True


def test_shutdown_and_restart_dispatch_correct_commands(monkeypatch):
    """Verify exact host command arguments for shutdown and restart."""
    commands_run = []

    def fake_run_host_cmd(cmd, **kwargs):
        commands_run.append(cmd)
        return True, ""

    monkeypatch.setattr("app.desktop_agent._run_host_cmd", fake_run_host_cmd)

    if sys.platform == "win32":
        res_shut = DesktopAgent._action_shutdown_computer({})
        assert res_shut["success"] is True
        assert commands_run[-1] == ["shutdown", "/s", "/t", "15"]

        res_rest = DesktopAgent._action_restart_computer({})
        assert res_rest["success"] is True
        assert commands_run[-1] == ["shutdown", "/r", "/t", "15"]

        res_cancel = DesktopAgent._action_cancel_shutdown({})
        assert res_cancel["success"] is True
        assert commands_run[-1] == ["shutdown", "/a"]


def test_media_and_volume_handlers_execute():
    """Media and volume actions dispatch correctly on Windows."""
    if sys.platform == "win32":
        for action in [
            "media_play_pause",
            "media_stop",
            "media_next",
            "media_previous",
            "volume_up",
            "volume_down",
        ]:
            handler = getattr(DesktopAgent, f"_action_{action}")
            result = handler({})
            assert result["success"] is True


def test_take_device_control_action_executes():
    """take_device_control opens session and reports screen state."""
    result = DesktopAgent._action_take_device_control({})
    assert result["success"] is True
    assert "session_token" in result
    assert "message" in result


def test_press_key_action_executes():
    """press_key simulates enter key successfully on Windows."""
    if sys.platform == "win32":
        result = DesktopAgent._action_press_key({"key": "enter"})
        assert result["success"] is True
        assert result["key"] == "enter"

    bad = DesktopAgent._action_press_key({"key": "nonexistent_key"})
    assert bad["success"] is False


def test_device_control_and_input_intents():
    """Verify natural language phrases for control and input map to desktop actions."""
    from app.desktop_agent import detect_desktop_intent

    assert detect_desktop_intent("control lo apne mai")["action"] == "take_device_control"
    assert detect_desktop_intent("mera device control karo")["action"] == "take_device_control"
    assert detect_desktop_intent("laptop control karo")["action"] == "take_device_control"
    assert detect_desktop_intent("pc control karo")["action"] == "take_device_control"
    assert detect_desktop_intent("click karo") == {"action": "mouse_click", "params": {"button": "left"}}
    assert detect_desktop_intent("right click karo") == {"action": "mouse_click", "params": {"button": "right"}}
    assert detect_desktop_intent("double click karo") == {"action": "mouse_click", "params": {"button": "double"}}
    assert detect_desktop_intent("scroll down") == {"action": "mouse_scroll", "params": {"delta": "-240"}}
    assert detect_desktop_intent("scroll up") == {"action": "mouse_scroll", "params": {"delta": "240"}}
    assert detect_desktop_intent("press enter") == {"action": "press_key", "params": {"key": "enter"}}
    assert detect_desktop_intent("screen dekho")["action"] == "read_screen_state"

