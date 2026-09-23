"""Restart, shut down, sleep and check for updates - by voice, and never unasked.

The owner's rule: "sab kuch mere se puch kai" - every system action is asked
first. So each phrase here must reach its action, and the action must refuse
to run until a spoken yes arrives as `confirmed=True`.
"""
import asyncio
import sys

import pytest

from app.desktop_agent import DesktopAgent, detect_desktop_intent


@pytest.mark.parametrize("said, action", [
    ("restart the computer", "restart_computer"),
    ("restart my laptop", "restart_computer"),
    ("pc restart kar do", "restart_computer"),
    ("laptop ko restart karo", "restart_computer"),
    ("shut down the pc", "shutdown_computer"),
    ("turn off my computer", "shutdown_computer"),
    ("laptop band kar do", "shutdown_computer"),
    ("computer band karo", "shutdown_computer"),
    ("put the laptop to sleep", "sleep_computer"),
    ("sleep the computer", "sleep_computer"),
    ("laptop ko sleep mode mein daal do", "sleep_computer"),
    ("check for updates", "check_updates"),
    ("check for windows updates", "check_updates"),
    ("updates check karo", "check_updates"),
    ("koi update hai kya", "check_updates"),
    ("are there any updates", "check_updates"),
    ("cancel the shutdown", "cancel_shutdown"),
    ("shutdown cancel karo", "cancel_shutdown"),
    ("restart roko", "cancel_shutdown"),
])
def test_each_phrase_reaches_its_action(said, action):
    intent = detect_desktop_intent(said)
    assert intent is not None, said
    assert intent["action"] == action, (said, intent)


@pytest.mark.parametrize("said", [
    "don't restart the computer",
    "how do I restart my laptop",
    "why does my pc shut down by itself",
])
def test_talking_about_it_is_not_asking_for_it(said):
    assert detect_desktop_intent(said) is None


@pytest.mark.parametrize("action", [
    "restart_computer", "shutdown_computer", "sleep_computer", "check_updates",
])
def test_nothing_runs_without_a_yes(action, monkeypatch):
    ran = []
    monkeypatch.setattr("app.desktop_agent._run_host_cmd", lambda cmd, **kw: ran.append(cmd) or (True, ""))
    monkeypatch.setattr("os.startfile", lambda *a, **k: ran.append(a), raising=False)
    result = asyncio.run(DesktopAgent.execute(action, {}, confirmed=False))
    assert result["success"] is False
    assert result["requires_confirmation"] is True
    assert ran == []


def test_linux_power_commands_keep_a_delay_and_run_without_a_shell(monkeypatch):
    calls = []

    def fake(cmd, **kwargs):
        calls.append((cmd, kwargs.get("shell", True)))
        return True, ""

    monkeypatch.setattr("app.desktop_agent._run_host_cmd", fake)
    monkeypatch.setattr(sys, "platform", "linux")
    assert DesktopAgent._action_restart_computer({})["success"]
    assert DesktopAgent._action_shutdown_computer({})["success"]
    assert DesktopAgent._action_sleep_computer({})["success"]
    assert DesktopAgent._action_cancel_shutdown({})["success"]
    assert calls == [
        (["shutdown", "-r", "+1"], False),
        (["shutdown", "-h", "+1"], False),
        (["systemctl", "suspend"], False),
        (["shutdown", "-c"], False),
    ]


def test_check_updates_opens_the_updater_and_installs_nothing(monkeypatch):
    opened = []
    if sys.platform == "win32":
        monkeypatch.setattr("os.startfile", lambda target: opened.append(target))
        result = DesktopAgent._action_check_updates({})
        assert result["success"] is True
        assert opened == ["ms-settings:windowsupdate-action"]
