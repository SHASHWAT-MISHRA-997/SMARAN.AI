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
def test_local_health_ignores_broken_system_proxy(monkeypatch, tmp_path):
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Health(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')

        def log_message(self, *args):
            pass

    monkeypatch.setattr(desktop.urllib.request, 'getproxies',
                        lambda: {'http': 'http://127.0.0.1:1'})
    monkeypatch.setattr(desktop.urllib.request, 'proxy_bypass', lambda host: False)
    monkeypatch.setattr(desktop.urllib.request, '_opener', None)
    with ThreadingHTTPServer(('127.0.0.1', 0), Health) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_port
            runtime = tmp_path / 'runtime.json'
            runtime.write_text(json.dumps({'port': port}))
            monkeypatch.setattr(desktop, '_runtime_file', lambda: str(runtime))
            assert desktop._wait_until_ready(port, timeout=1)
            assert desktop._existing_instance() == port
        finally:
            server.shutdown()
            thread.join(timeout=2)
