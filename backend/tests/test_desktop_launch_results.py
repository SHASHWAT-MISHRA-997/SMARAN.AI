from urllib.parse import parse_qs, urlparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import desktop_agent as desktop


def test_browser_rejection_is_not_success(monkeypatch):
    monkeypatch.setattr(desktop.webbrowser, 'open', lambda url: False)
    for action, params in [
        ('open_url', {'url': 'https://example.com'}),
        ('open_website', {'name': 'youtube'}),
        ('search_youtube', {'query': 'a & b'}),
    ]:
        assert not getattr(desktop.DesktopAgent, '_action_' + action)(params)['success']


def test_youtube_query_preserves_special_characters(monkeypatch):
    urls = []
    monkeypatch.setattr(desktop.webbrowser, 'open', lambda url: urls.append(url) or True)
    desktop.DesktopAgent._action_search_youtube({'query': 'हिंदी & music #1'})
    assert parse_qs(urlparse(urls[0]).query)['search_query'] == ['हिंदी & music #1']


def test_linux_launch_uses_installed_executable_without_shell(monkeypatch):
    monkeypatch.setattr(desktop.sys, 'platform', 'linux')
    monkeypatch.setattr(desktop.shutil, 'which', lambda name: '/usr/bin/kcalc' if name == 'kcalc' else None)
    calls = []
    monkeypatch.setattr(desktop.subprocess, 'Popen', lambda *a, **kw: calls.append((a, kw)))
    assert desktop.DesktopAgent._action_open_application({'name': 'calculator'})['success']
    assert calls == [((['/usr/bin/kcalc'],), {'shell': False})]


def test_linux_unknown_app_does_not_invoke_windows_start(monkeypatch):
    monkeypatch.setattr(desktop.sys, 'platform', 'linux')
    monkeypatch.setattr(desktop.shutil, 'which', lambda name: None)
    def forbidden(*args, **kwargs):
        raise AssertionError('must not launch')
    monkeypatch.setattr(desktop.subprocess, 'Popen', forbidden)
    assert not desktop.DesktopAgent._action_open_application({'name': 'missing;echo hello'})['success']


def test_windows_literal_typing_does_not_reescape_inserted_braces(monkeypatch):
    monkeypatch.setattr(desktop.sys, 'platform', 'win32')
    sent = []
    monkeypatch.setattr(desktop.DesktopAgent, '_send_keys', lambda text, desc: sent.append(text) or {'success': True})
    desktop.DesktopAgent._action_type_text({'text': 'a+b{c}'})
    assert sent == ['a{+}b{{}c{}}']


def test_wayland_typing_reports_missing_authorized_session(monkeypatch):
    monkeypatch.setattr(desktop.sys, 'platform', 'linux')
    monkeypatch.setenv('XDG_SESSION_TYPE', 'wayland')
    assert not desktop.DesktopAgent._action_type_text({'text': 'hello'})['success']


# ---- a launch is reported as observed, not as assumed ----------------------
#
# Every launcher used to spawn a process and return {"success": True,
# "message": "Launched X."} on the very next line. Popen returning means a
# process was created; it says nothing about whether the application survived.


class _Process:
    """A spawned process whose fate we control."""

    def __init__(self, code):
        self._code = code

    def poll(self):
        return self._code


def test_a_running_application_is_confirmed():
    result = desktop.DesktopAgent._confirm_launch(_Process(None), "Notepad", settle=0)
    assert result["success"] is True
    assert result["confirmed"] is True


def test_an_application_that_dies_immediately_is_a_failure():
    # Blocked by policy, missing a dependency, refusing to start: all of these
    # used to report success identically to a working launch.
    result = desktop.DesktopAgent._confirm_launch(_Process(3), "Paint", settle=0)
    assert result["success"] is False
    assert result["exit_code"] == 3
    assert "3" in result["error"]


def test_a_starter_that_hands_off_is_success_but_not_confirmed():
    # A launcher exiting 0 is normal when it hands off to an existing window.
    # That is not a failure, and it is not proof the application is up either.
    result = desktop.DesktopAgent._confirm_launch(_Process(0), "Chrome", settle=0)
    assert result["success"] is True
    assert result["confirmed"] is False


def test_a_path_with_no_process_admits_it_cannot_confirm():
    result = desktop.DesktopAgent._confirm_launch(None, "Settings", settle=0)
    assert result["success"] is True
    assert result["confirmed"] is False
    assert "cannot confirm" in result["message"]


def test_polling_failure_does_not_become_a_launch_failure():
    class Unpollable:
        def poll(self):
            raise OSError("handle gone")

    result = desktop.DesktopAgent._confirm_launch(Unpollable(), "Terminal", settle=0)
    # Not being able to read the state is not evidence the application failed.
    assert result["success"] is True
    assert result["confirmed"] is False


def test_a_missing_browser_is_reported_missing_rather_than_launched(monkeypatch):
    # `Popen("start chrome", shell=True)` returned 0 on a machine with no
    # Chrome, because `start` is a cmd builtin that succeeds regardless.
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)
    result = desktop.DesktopAgent._launch_windows_browser("chrome", "Chrome")
    assert result["success"] is False
    assert "not appear to be installed" in result["error"]


def test_a_present_browser_is_spawned_without_a_shell(monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: r"C:\chrome.exe")
    seen = {}

    def fake_popen(argv, **kwargs):
        seen["argv"] = argv
        seen["kwargs"] = kwargs
        return _Process(None)

    monkeypatch.setattr(desktop.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(desktop.DesktopAgent, "_LAUNCH_SETTLE_SECONDS", 0)
    result = desktop.DesktopAgent._launch_windows_browser("chrome", "Chrome")
    assert result["success"] is True and result["confirmed"] is True
    # No shell, and a real path rather than a string for cmd to interpret.
    assert seen["kwargs"].get("shell") is False
    assert seen["argv"] == [r"C:\chrome.exe"]


def test_a_browser_that_cannot_start_is_not_reported_as_launched(monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: r"C:\chrome.exe")

    def refuse(*args, **kwargs):
        raise OSError("access denied")

    monkeypatch.setattr(desktop.subprocess, "Popen", refuse)
    result = desktop.DesktopAgent._launch_windows_browser("chrome", "Chrome")
    assert result["success"] is False
    assert "access denied" in result["error"]
