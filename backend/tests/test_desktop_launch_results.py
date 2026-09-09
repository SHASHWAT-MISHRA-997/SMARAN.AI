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
