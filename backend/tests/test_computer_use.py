"""Tests for Windows and Linux Computer Use actions and control session integration.

Verifies:
- mouse_click (left, right, double click, coordinate handling)
- mouse_scroll (up and down scroll delta handling)
- read_screen_state (resolution, cursor, foreground window)
- Linux X11 and Wayland platform handling
- Control session check: a stopped session prevents actions from executing
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.desktop_agent import DesktopAgent, DESKTOP_ACTION_CATALOG
from app import control_session


def test_computer_use_catalog_entries():
    assert "mouse_click" in DESKTOP_ACTION_CATALOG
    assert "mouse_scroll" in DESKTOP_ACTION_CATALOG
    assert "read_screen_state" in DESKTOP_ACTION_CATALOG

    assert DESKTOP_ACTION_CATALOG["mouse_click"]["category"] == "input"
    assert DESKTOP_ACTION_CATALOG["mouse_scroll"]["category"] == "input"
    assert DESKTOP_ACTION_CATALOG["read_screen_state"]["category"] == "system"


def test_mouse_click_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    events = []

    mock_user32 = MagicMock()
    mock_user32.SetCursorPos = lambda x, y: events.append(("pos", x, y)) or 1
    mock_user32.mouse_event = lambda flags, x, y, data, extra: events.append(("click", flags)) or None

    with patch("ctypes.windll.user32", mock_user32):
        res = DesktopAgent._action_mouse_click({"x": 100, "y": 200, "button": "left"})
        assert res["success"] is True
        assert ("pos", 100, 200) in events
        assert res["button"] == "left"

        # Right click
        res_r = DesktopAgent._action_mouse_click({"button": "right"})
        assert res_r["success"] is True
        assert res_r["button"] == "right"

        # Double click
        res_d = DesktopAgent._action_mouse_click({"button": "double"})
        assert res_d["success"] is True
        assert res_d["button"] == "double"


def test_mouse_click_invalid_coordinates(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    res = DesktopAgent._action_mouse_click({"x": "not_a_number", "y": "abc"})
    assert res["success"] is False
    assert "Invalid" in res["error"]


def test_mouse_scroll_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    scroll_events = []

    mock_user32 = MagicMock()
    mock_user32.mouse_event = lambda flags, x, y, data, extra: scroll_events.append((flags, data)) or None

    with patch("ctypes.windll.user32", mock_user32):
        res = DesktopAgent._action_mouse_scroll({"delta": 240})
        assert res["success"] is True
        assert res["delta"] == 240
        assert (0x0800, 240) in scroll_events

        res_down = DesktopAgent._action_mouse_scroll({"delta": -120})
        assert res_down["success"] is True
        assert (0x0800, -120) in scroll_events


def test_read_screen_state_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    res = DesktopAgent._action_read_screen_state({})
    assert res["success"] is True
    state = res["state"]
    assert state["platform"] == "win32"
    assert state["screen_size"] is not None
    assert "width" in state["screen_size"]
    assert "height" in state["screen_size"]
    assert state["screen_size"]["width"] > 0
    assert state["screen_size"]["height"] > 0


def test_linux_wayland_honesty(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")

    res_click = DesktopAgent._action_mouse_click({"button": "left"})
    assert res_click["success"] is False
    assert "Wayland" in res_click["error"]

    res_scroll = DesktopAgent._action_mouse_scroll({"delta": 120})
    assert res_scroll["success"] is False
    assert "Wayland" in res_scroll["error"]

    res_state = DesktopAgent._action_read_screen_state({})
    assert res_state["success"] is True
    assert res_state["state"]["display_server"] == "wayland"
    assert "restricted" in res_state["state"]["note"].lower()


def test_control_session_stop_blocks_action():
    import asyncio

    async def _run():
        token = control_session.begin("automated testing")
        assert control_session.is_running(token) is True

        # Stop session
        control_session.stop(token)
        assert control_session.is_running(token) is False

        # Dispatch action under stopped session
        outcome = await DesktopAgent.execute("mouse_scroll", {"delta": 100, "control_session": token})
        assert outcome["success"] is False
        assert outcome["stopped"] is True
        assert "stopped" in outcome["error"].lower()

    asyncio.run(_run())
