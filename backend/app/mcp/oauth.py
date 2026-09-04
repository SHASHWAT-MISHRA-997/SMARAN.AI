"""Signing in to a hosted MCP server.

A hosted server does not take an API key. It answers the first request with

    HTTP 401
    WWW-Authenticate: Bearer resource_metadata="https://…/.well-known/…"

and expects the client to go and find out who issues tokens for it, register
itself, send the person to a browser to approve, and come back with a code.
Until this existed, SMARAN.AI could only send fixed headers, so every hosted
server answered 401 and there was nothing to be done about it.

WHAT THIS IMPLEMENTS

The MCP authorization spec (2025-06-18), which is a subset of:

    RFC 9728  protected resource metadata - who issues tokens for this server
    RFC 8414  authorization server metadata - where its endpoints are
    RFC 7591  dynamic client registration - getting a client_id with no signup
    RFC 7636  PKCE, S256 - so an intercepted code is useless
    RFC 8707  the resource parameter - so the token is bound to this server

Checked against a real one before it was written. Higgsfield answers:

    resource               https://mcp.higgsfield.ai/mcp
    authorization_servers  https://clerk.higgsfield.ai, …
    registration_endpoint  https://clerk.higgsfield.ai/oauth/register
    code_challenge_methods S256
    grant_types            authorization_code, refresh_token

WHAT IT DELIBERATELY DOES NOT DO

It does not invent a client secret. `token_endpoint_auth_methods_supported`
includes "none", and a desktop app cannot keep a secret - it ships to everyone
who installs it. This registers as a public client and relies on PKCE, which is
what PKCE is for.

It does not send the person anywhere except a page the authorization server
itself named. The redirect is 127.0.0.1 on a port opened for the moment it
takes, and the callback is checked against the state that was sent - a reply
carrying somebody else's state is discarded rather than exchanged.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

#: How long to wait for somebody to finish signing in before giving up.
APPROVAL_TIMEOUT = 300

#: Refresh this many seconds before a token actually expires, so a request is
#: never made with one that dies in flight.
EXPIRY_MARGIN = 60


def _store_path() -> str:
    from app.config import settings

    return os.path.join(settings.DATA_DIR, "mcp_oauth.json")


def _read_store() -> Dict[str, Any]:
    try:
        with open(_store_path(), "r", encoding="utf-8") as handle:
            return json.load(handle) or {}
    except (OSError, ValueError):
        return {}


def _write_store(data: Dict[str, Any]) -> None:
    path = _store_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        # Tokens are credentials. Owner-only where the platform supports it.
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError as exc:
        logger.warning("Could not save the MCP sign-in: %s", exc)


def resource_metadata_url(www_authenticate: str, mcp_url: str) -> Optional[str]:
    """The metadata URL a 401 pointed at, or the well-known default.

    The header is the server telling us where to look. RFC 9728 also defines a
    default location, so a server that answers 401 without the parameter is
    still reachable rather than a dead end.
    """
    found = re.search(r'resource_metadata="([^"]+)"', www_authenticate or "")
    if found:
        return found.group(1)
    parts = urllib.parse.urlsplit(mcp_url)
    path = parts.path.rstrip("/")
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, "/.well-known/oauth-protected-resource" + path, "", ""))


async def _get_json(url: str) -> Optional[Dict[str, Any]]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"accept": "application/json"})
        if response.status_code == 200:
            return response.json()
    except Exception as exc:  # noqa: BLE001 - a missing document is an answer
        logger.info("MCP OAuth: %s did not answer (%s)", url, exc)
    return None


async def discover(mcp_url: str, www_authenticate: str = "") -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Find who issues tokens for this server, and where their endpoints are.

    Returns (resource metadata, authorization server metadata).
    """
    where = resource_metadata_url(www_authenticate, mcp_url)
    resource = await _get_json(where) if where else None
    if not resource:
        raise RuntimeError(
            "This server asked for a sign-in but published no resource metadata at %s, "
            "so there is no way to find out who issues its tokens." % where)

    servers = resource.get("authorization_servers") or []
    if not servers:
        raise RuntimeError("This server's metadata names no authorization server.")

    # Both spellings, because an authorization server may publish either. The
    # OAuth one is what the MCP spec names; the OpenID one is what a great many
    # real deployments actually serve.
    for issuer in servers:
        base = str(issuer).rstrip("/")
        for probe in (base + "/.well-known/oauth-authorization-server",
                      base + "/.well-known/openid-configuration"):
            meta = await _get_json(probe)
            if meta and meta.get("authorization_endpoint") and meta.get("token_endpoint"):
                return resource, meta
    raise RuntimeError(
        "None of the authorization servers named (%s) published usable metadata."
        % ", ".join(str(s) for s in servers))


async def register(auth_meta: Dict[str, Any], redirect_uri: str,
                   client_name: str = "SMARAN.AI") -> Dict[str, Any]:
    """Get a client_id without anybody having to sign up for one.

    A public client: no secret is requested and none is kept. A desktop
    application cannot hold a secret - it is on every machine that installs it -
    and PKCE is what replaces it.
    """
    import httpx

    endpoint = auth_meta.get("registration_endpoint")
    if not endpoint:
        raise RuntimeError(
            "This authorization server does not register clients automatically, so a "
            "client ID has to be obtained from them by hand.")

    body = {
        "client_name": client_name,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(endpoint, json=body)
    if response.status_code not in (200, 201):
        raise RuntimeError("Registration was refused (HTTP %s): %s"
                           % (response.status_code, response.text[:200]))
    return response.json()


class _Callback(BaseHTTPRequestHandler):
    """The one page the browser comes back to."""

    result: Dict[str, str] = {}

    def do_GET(self) -> None:  # noqa: N802 - the base class names it
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        _Callback.result = {k: v[0] for k, v in query.items()}
        ok = "code" in _Callback.result
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write((
            "<!doctype html><meta charset='utf-8'>"
            "<body style=\"background:#09090b;color:#e4e4e7;font:15px system-ui;"
            "display:grid;place-items:center;height:100vh;margin:0\">"
            "<div style='text-align:center'><p style='font-size:19px;font-weight:700'>%s</p>"
            "<p style='color:#a1a1aa'>%s</p></div>"
            % (("Signed in." if ok else "That did not complete."),
               ("You can close this tab and go back to SMARAN.AI." if ok
                else "Nothing was saved. Try again from SMARAN.AI."))
        ).encode("utf-8"))

    def log_message(self, *_args: Any) -> None:
        """Quiet. The server's own log is not the app's log."""


def _authorize_in_browser(auth_meta: Dict[str, Any], client_id: str, resource: str,
                          scopes: str) -> Tuple[str, str, str]:
    """Send the person to approve, and wait for the code to come back.

    Returns (code, verifier, redirect_uri).
    """
    # PKCE. The verifier never leaves this process; only its hash is sent with
    # the authorization request, so a stolen code cannot be exchanged.
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)

    # Port 0: the operating system picks one that is free. A fixed port is a
    # collision waiting to happen and a thing for other software to squat on.
    server = HTTPServer(("127.0.0.1", 0), _Callback)
    redirect_uri = "http://127.0.0.1:%d/callback" % server.server_port
    _Callback.result = {}

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        # RFC 8707. Sent whether or not the server says it understands it, as
        # the MCP spec requires: it binds the token to this server so it cannot
        # be replayed at another one.
        "resource": resource,
    }
    if scopes:
        params["scope"] = scopes

    url = auth_meta["authorization_endpoint"] + "?" + urllib.parse.urlencode(params)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        webbrowser.open(url)
        deadline = time.time() + APPROVAL_TIMEOUT
        while time.time() < deadline and not _Callback.result:
            time.sleep(0.25)
    finally:
        server.shutdown()
        server.server_close()

    answer = dict(_Callback.result)
    _Callback.result = {}
    if not answer:
        raise RuntimeError("Nobody finished signing in within %d seconds." % APPROVAL_TIMEOUT)
    if answer.get("error"):
        raise RuntimeError("The sign-in was refused: %s"
                          % (answer.get("error_description") or answer["error"]))
    # A reply carrying a different state is not our reply.
    if answer.get("state") != state:
        raise RuntimeError("The sign-in came back with the wrong state and was discarded.")
    if not answer.get("code"):
        raise RuntimeError("The sign-in came back without a code.")
    return answer["code"], verifier, redirect_uri


async def _token_request(auth_meta: Dict[str, Any], form: Dict[str, str]) -> Dict[str, Any]:
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(auth_meta["token_endpoint"], data=form,
                                     headers={"content-type": "application/x-www-form-urlencoded"})
    if response.status_code != 200:
        raise RuntimeError("The token request failed (HTTP %s): %s"
                          % (response.status_code, response.text[:200]))
    return response.json()


def _remember(mcp_url: str, auth_meta: Dict[str, Any], client_id: str,
              resource: str, tokens: Dict[str, Any]) -> None:
    store = _read_store()
    entry = store.get(mcp_url, {})
    entry.update({
        "client_id": client_id,
        "resource": resource,
        "token_endpoint": auth_meta["token_endpoint"],
        "authorization_endpoint": auth_meta["authorization_endpoint"],
        "access_token": tokens.get("access_token"),
        "token_type": tokens.get("token_type") or "Bearer",
        "expires_at": (time.time() + float(tokens["expires_in"])) if tokens.get("expires_in") else None,
    })
    # A refresh token is only replaced when a new one is issued. Public clients
    # get rotated refresh tokens, but a server that does not rotate sends none
    # on refresh, and overwriting with nothing would sign the person out.
    if tokens.get("refresh_token"):
        entry["refresh_token"] = tokens["refresh_token"]
    store[mcp_url] = entry
    _write_store(store)


async def sign_in(mcp_url: str, www_authenticate: str = "") -> str:
    """Take somebody through signing in, and return the access token."""
    resource_meta, auth_meta = await discover(mcp_url, www_authenticate)
    resource = resource_meta.get("resource") or mcp_url
    scopes = " ".join(resource_meta.get("scopes_supported") or [])

    store = _read_store()
    client_id = (store.get(mcp_url) or {}).get("client_id")

    # Registration happens once per server and is remembered, so approving a
    # second time does not create a second client.
    if not client_id:
        # The redirect has to be known before registering, and the port is not
        # known until the callback server is listening - so registration uses a
        # loopback URI with a placeholder port, which is what native clients
        # are permitted to do (RFC 8252 section 7.3).
        registered = await register(auth_meta, "http://127.0.0.1/callback")
        client_id = registered.get("client_id")
        if not client_id:
            raise RuntimeError("Registration returned no client_id.")
        store.setdefault(mcp_url, {})["client_id"] = client_id
        _write_store(store)

    import asyncio
    code, verifier, redirect_uri = await asyncio.to_thread(
        _authorize_in_browser, auth_meta, client_id, resource, scopes)

    tokens = await _token_request(auth_meta, {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": verifier,
        "resource": resource,
    })
    if not tokens.get("access_token"):
        raise RuntimeError("The authorization server returned no access token.")
    _remember(mcp_url, auth_meta, client_id, resource, tokens)
    return tokens["access_token"]


async def token_for(mcp_url: str) -> Optional[str]:
    """A usable access token for this server, refreshing it if it has expired.

    Returns None when nobody has signed in yet, or when the refresh failed -
    the caller then knows to ask rather than to retry for ever.
    """
    entry = (_read_store()).get(mcp_url)
    if not entry or not entry.get("access_token"):
        return None

    expires_at = entry.get("expires_at")
    if not expires_at or time.time() < float(expires_at) - EXPIRY_MARGIN:
        return entry["access_token"]

    if not entry.get("refresh_token"):
        return None
    try:
        tokens = await _token_request(
            {"token_endpoint": entry["token_endpoint"]},
            {"grant_type": "refresh_token",
             "refresh_token": entry["refresh_token"],
             "client_id": entry["client_id"],
             "resource": entry.get("resource") or mcp_url},
        )
    except Exception as exc:  # noqa: BLE001 - an expired session is not a crash
        logger.info("MCP OAuth: could not refresh %s (%s)", mcp_url, exc)
        return None

    _remember(mcp_url,
              {"token_endpoint": entry["token_endpoint"],
               "authorization_endpoint": entry.get("authorization_endpoint", "")},
              entry["client_id"], entry.get("resource") or mcp_url, tokens)
    return tokens.get("access_token")


def signed_in(mcp_url: str) -> bool:
    entry = (_read_store()).get(mcp_url) or {}
    return bool(entry.get("access_token") or entry.get("refresh_token"))


def sign_out(mcp_url: str) -> None:
    """Forget the tokens for one server. The client registration stays."""
    store = _read_store()
    entry = store.get(mcp_url)
    if not entry:
        return
    for key in ("access_token", "refresh_token", "expires_at"):
        entry.pop(key, None)
    store[mcp_url] = entry
    _write_store(store)
