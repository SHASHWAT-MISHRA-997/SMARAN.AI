"""The desktop window must not grant media access to a foreign page."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('audit_desktop', Path(__file__).resolve().parents[2] / 'desktop_app.py')
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


@pytest.mark.parametrize('requested,trusted,allowed', [
    ('http://127.0.0.1:3003/', 'http://127.0.0.1:3003', True),
    ('https://LOCALHOST:443/path', 'https://localhost/', True),
    ('http://127.0.0.1:3004', 'http://127.0.0.1:3003', False),
    ('https://127.0.0.1:3003', 'http://127.0.0.1:3003', False),
    ('http://127.0.0.1.evil.test:3003', 'http://127.0.0.1:3003', False),
    ('http://127.0.0.1:3003@evil.test', 'http://127.0.0.1:3003', False),
    ('http://localhost:0', 'http://localhost', False),
    ('data:text/html,test', 'http://127.0.0.1:3003', False),
    ('http://[invalid', 'http://127.0.0.1:3003', False),
    (None, 'http://127.0.0.1:3003', False),
])
def test_media_origin(requested, trusted, allowed):
    assert desktop._same_media_origin(requested, trusted) is allowed


def test_linux_uses_browser_without_importing_unbundled_gui(monkeypatch):
    import builtins
    original_import = builtins.__import__
    def guarded_import(name, *args, **kwargs):
        assert name != 'webview', 'Linux browser launch must not import GTK/Qt bindings'
        return original_import(name, *args, **kwargs)
    opened = []
    monkeypatch.setattr(desktop.sys, 'platform', 'linux')
    monkeypatch.setattr(builtins, '__import__', guarded_import)
    monkeypatch.setattr(desktop, '_open_browser_window', lambda url: opened.append(url) or False)
    assert desktop._open_window('http://127.0.0.1:3003/') is False
    assert opened == ['http://127.0.0.1:3003/']


def test_port_probe_rejects_an_existing_loopback_listener():
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as existing:
        existing.bind(('127.0.0.1', 0))
        existing.listen()
        occupied = existing.getsockname()[1]
        assert desktop._find_free_port(occupied) != occupied
