"""Nothing reachable from the network without a credential.

The backend listens on every interface, because the paired phone reaches it
over Wi-Fi. A caller on this computer is the owner. A caller from anywhere
else was supposed to present a session or a pairing token - but that was left
to each route, and 159 of 274 did not ask. From another device on the same
Wi-Fi, with nothing at all, one could run commands and write files through
/api/agent/run, install and execute plugins, add MCP servers (which start
local programs), send messages through /api/office, switch off the app lock,
and publish or delete the owner's sites.

This turns it around: every /api/ and /ws/ request from off this machine must
carry a valid pairing token or session, except a short list of routes that
exist to obtain one or check their own secret. A route added tomorrow is
covered without anyone remembering to protect it.

It sits behind OriginGuard, which still stops foreign web pages on this
computer; this stops other computers.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional
from urllib.parse import parse_qs

from starlette.concurrency import run_in_threadpool

_LOOPBACK = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "testclient"})

#: Reachable without a credential, because they are how one is obtained or
#: they verify their own. Exact paths, or prefixes ending in "/".
PUBLIC = (
    "/api/auth/",                       # sign in, register, recover: each checks its own input
    "/api/companion/pairing/claim",     # the one-time code shown on this screen
    "/api/companion/sync",              # these four check the pairing token themselves
    "/api/companion/commands",
    "/api/companion/from-device",
    "/api/companion/status",
    "/api/agent/gateway/webhook/",      # verifies X-Webhook-Secret
    "/api/ping",
    "/api/test/ping",
    "/health",
)


def is_public(path: str) -> bool:
    return any(path == p or (p.endswith("/") and path.startswith(p)) for p in PUBLIC)


def _header(scope, name: bytes) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("latin-1").strip()
    return ""


def _cookie(scope, name: str) -> str:
    raw = _header(scope, b"cookie")
    for part in raw.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value.strip()
    return ""


def credentials(scope) -> tuple:
    """(pairing token, session token) presented by a request, either may be empty."""
    query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
    paired = _header(scope, b"x-companion-token") or (query.get("companion_token") or [""])[0]
    session = ""
    auth = _header(scope, b"authorization")
    if auth.startswith("Bearer "):
        session = auth[7:].strip()
    session = session or _cookie(scope, "session_token") or (query.get("token") or [""])[0]
    return paired.strip(), session.strip()


def _valid(paired: str, session: str) -> bool:
    from app.database import SessionLocal
    from app.models import PairedDevice, User

    db = SessionLocal()
    try:
        if paired and db.query(PairedDevice).filter(PairedDevice.token == paired).first():
            return True
        if session:
            user = db.query(User).filter(User.session_token == session).first()
            if user and user.session_expires and user.session_expires > datetime.now():
                return True
        return False
    finally:
        db.close()


class LanGuard:
    """ASGI middleware: off this machine, no credential, no API."""

    def __init__(self, app, validate=None):
        self.app = app
        self._validate = validate or _valid

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope.get("path") or ""
        guarded = path.startswith("/api/") or path.startswith("/ws/") or path == "/ws"
        client = (scope.get("client") or ("", 0))[0]
        if not guarded or client in _LOOPBACK or is_public(path):
            return await self.app(scope, receive, send)

        paired, session = credentials(scope)
        if (paired or session) and await run_in_threadpool(self._validate, paired, session):
            return await self.app(scope, receive, send)

        if kind == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        body = json.dumps({"detail": "Sign in, or pair this device, to use SMARAN.AI from another computer."}).encode()
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
