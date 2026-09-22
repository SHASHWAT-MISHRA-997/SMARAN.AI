"""Requests from web pages that are not SMARAN.AI are refused.

A caller on this computer is treated as the owner (main.get_current_user), and
that is right for the app's own window. It was also true of every website the
owner visited. Browsers enforce CORS only on requests that need a preflight: a
"simple" POST - text/plain, no custom headers - is sent anyway, and so is any
WebSocket. /api/terminal/run parses its body as JSON whatever the content type,
so a page on any site could send it a command, the backend saw a loopback
caller, and the command ran. A WebSocket to /ws/voice/live would stream voice
through the owner's Gemini key the same way.

Two checks, in front of everything, HTTP and WebSocket alike:

- Host. The request must be addressed to this machine - localhost, a loopback
  or private address, or this computer's own name. A public domain that
  resolves to 127.0.0.1 (DNS rebinding) is a web page pretending to be local.

- Origin. Browsers send it on every cross-site POST and every WebSocket, and a
  page cannot forge it. When present it must be SMARAN.AI's own: loopback
  origins for a caller on this machine; for a caller on the local network (the
  paired phone) the private-network origins too. Tools that send no Origin -
  curl, the CLI, the VS Code extension - are unaffected; they are not web pages.
"""

from __future__ import annotations

import re
import socket
from typing import Iterable

_LOOPBACK_CLIENTS = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "testclient"})

# Origins a page on this computer may have: the app's own window, the Vite dev
# server, and the Android WebView (https://localhost, capacitor://localhost).
_LOOPBACK_ORIGIN = re.compile(
    r"^(https?|capacitor)://(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$", re.I)
# The paired phone's WebView, and a browser on the local network.
_PRIVATE_ORIGIN = re.compile(
    r"^(https?|capacitor)://(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|"
    r"192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$", re.I)
_PRIVATE_HOST = re.compile(
    r"^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|"
    r"172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|testserver)$", re.I)

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _own_names() -> set:
    names = {"localhost"}
    try:
        host = socket.gethostname().lower()
        names |= {host, host + ".local", socket.getfqdn().lower()}
    except OSError:
        pass
    return names


_OWN_NAMES = _own_names()


def _header(headers: Iterable, name: bytes) -> str:
    for key, value in headers:
        if key.lower() == name:
            return value.decode("latin-1").strip()
    return ""


def host_allowed(host_header: str) -> bool:
    host = host_header.lower()
    if host.startswith("["):
        host = host[1:host.find("]")] if "]" in host else host
    else:
        host = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    return bool(host) and (bool(_PRIVATE_HOST.match(host)) or host in _OWN_NAMES)


def origin_allowed(origin: str, client_host: str) -> bool:
    if not origin:
        return True
    if origin == "null":
        return False
    if client_host in _LOOPBACK_CLIENTS:
        return bool(_LOOPBACK_ORIGIN.match(origin))
    return bool(_PRIVATE_ORIGIN.match(origin))


class OriginGuard:
    """ASGI middleware: refuse requests addressed or sent by a foreign page."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        headers = scope.get("headers") or []
        client = (scope.get("client") or ("", 0))[0] or ""
        host = _header(headers, b"host")
        origin = _header(headers, b"origin")
        method = scope.get("method", "GET").upper()

        refused = ""
        if host and not host_allowed(host):
            refused = "This address is not SMARAN.AI."
        elif kind == "websocket" or method not in _SAFE_METHODS:
            if not origin_allowed(origin, client):
                refused = "Requests from other websites are not accepted."

        if not refused:
            return await self.app(scope, receive, send)

        if kind == "websocket":
            await send({"type": "websocket.close", "code": 4403})
            return
        body = ('{"detail": "%s"}' % refused).encode()
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
