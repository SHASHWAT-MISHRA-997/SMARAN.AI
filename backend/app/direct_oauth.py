"""Direct provider sign-in. Provider tokens never become local session tokens."""
import asyncio
import base64
import hashlib
import logging
import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

GOOGLE_DESKTOP_CLIENT_ID = "656427300466-d1fetqra2pv352klkociveaem72kvpdr.apps.googleusercontent.com"
LOOPBACK = {"localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"}
logger = logging.getLogger(__name__)


def desktop_client_id():
    return os.environ.get("SMARAN_GOOGLE_DESKTOP_CLIENT_ID", GOOGLE_DESKTOP_CLIENT_ID).strip()


def desktop_client_secret():
    """Google requires the desktop client's secret to finish sign-in.

    Without it the token endpoint answers "client_secret is missing" after
    the person has already chosen an account. Baked in at build time
    (app/oauth_config.py) or given in the environment; never logged.
    """
    value = os.environ.get("SMARAN_GOOGLE_DESKTOP_CLIENT_SECRET", "").strip()
    if value:
        return value
    try:
        from app.oauth_config import GOOGLE_DESKTOP_CLIENT_SECRET
    except ImportError:
        return ""
    return str(GOOGLE_DESKTOP_CLIENT_SECRET or "").strip()


async def provider_json(client, method, url, **kwargs):
    try:
        reply = await client.request(method, url, **kwargs)
        data = reply.json()
    except httpx.HTTPError as exc:
        logger.warning("OAuth provider request failed %s (%s)", method, type(exc).__name__)
        raise HTTPException(502, "The sign-in provider could not be reached. Please retry.")
    except ValueError:
        logger.warning("OAuth provider returned a non-JSON response for %s", method)
        raise HTTPException(502, "The sign-in provider could not be reached. Please retry.")
    if reply.status_code >= 400:
        # Provider responses can contain tokens or account identifiers. Keep
        # the diagnostic useful without ever logging the response body.
        logger.warning("OAuth provider rejected %s with HTTP %s (%s)",
                       method, reply.status_code,
                       data.get("error") if isinstance(data, dict) else "unknown")
        raise HTTPException(401, "The provider could not verify this sign-in. Please retry.")
    return data


class PollRequest(BaseModel):
    ticket: str = Field(min_length=32, max_length=200)


def make_router(get_db, finish_login, web_client_id):
    router = APIRouter(prefix="/api/auth/direct", tags=["sign-in"])
    pending = {}

    def prune():
        now = time.monotonic()
        for ticket in list(pending):
            if pending[ticket]["expires"] <= now:
                pending.pop(ticket, None)

    def entry(ticket):
        prune()
        flow = pending.get(ticket)
        if flow is None:
            raise HTTPException(410, "Sign-in expired. Please start again.")
        return flow

    @router.get("/config")
    async def config(response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"google_client_id": web_client_id(), "google_desktop_client_id": desktop_client_id()}

    @router.post("/{provider}/start")
    async def start(provider: str, request: Request, response: Response):
        # Google is the only provider here now. GitHub was removed because
        # finishing one of its sign-ins needs a client secret that an app
        # installed on someone else's machine cannot hold - the alternatives
        # were a device code typed by hand or a secret parked on the website,
        # and neither is worth it next to an account made on this machine.
        if provider != "google":
            raise HTTPException(404, "Unknown sign-in provider.")
        prune()
        if len(pending) >= 64:
            raise HTTPException(429, "Too many pending sign-ins. Please retry shortly.")
        if request.headers.get("sec-fetch-site") == "cross-site":
            raise HTTPException(403, "Start sign-in from SMARAN.AI.")
        if not desktop_client_id() or not desktop_client_secret():
            # Said before the browser opens, not after an account is chosen.
            raise HTTPException(503, "Google sign-in is not set up in this build. "
                                     "Use a SMARAN.AI account on this computer for now.")
        if request.url.hostname not in LOOPBACK or not request.client or request.client.host not in LOOPBACK:
            raise HTTPException(400, "Open SMARAN.AI on this computer using localhost to sign in with Google.")
        ticket = secrets.token_urlsafe(32)
        flow = {"provider": provider, "expires": time.monotonic() + 600,
                "lock": asyncio.Lock(), "status": "pending"}
        result = {"ticket": ticket, "expires_in": 600, "interval": 2}
        verifier = secrets.token_urlsafe(48)
        state = secrets.token_urlsafe(32)
        redirect = str(request.base_url).rstrip("/") + "/api/auth/direct/google/callback"
        flow.update(verifier=verifier, state=state, redirect=redirect, client_id=desktop_client_id())
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        result["url"] = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": flow["client_id"], "redirect_uri": redirect, "response_type": "code",
            "scope": "openid email profile", "state": state, "code_challenge": challenge,
            "code_challenge_method": "S256", "prompt": "select_account"})
        pending[ticket] = flow
        response.headers["Cache-Control"] = "no-store"
        return result

    @router.get("/google/callback", response_class=HTMLResponse)
    async def callback(state: str = "", code: str = "", error: str = ""):
        prune()
        flow = next((f for f in pending.values() if f.get("state") == state and state), None)
        if flow is None:
            raise HTTPException(400, "Invalid or expired sign-in state.")
        async with flow["lock"]:
            if flow["status"] != "pending":
                raise HTTPException(400, "This sign-in callback was already used.")
            flow["status"] = "processing"
            try:
                if error or not code:
                    raise HTTPException(401, "Google sign-in was cancelled. Please try again.")
                async with httpx.AsyncClient(timeout=15) as client:
                    tokens = await provider_json(client, "POST", "https://oauth2.googleapis.com/token", data={
                        "client_id": flow["client_id"], "client_secret": desktop_client_secret(),
                        "code": code, "code_verifier": flow["verifier"],
                        "redirect_uri": flow["redirect"], "grant_type": "authorization_code"})
                    if not tokens.get("id_token"):
                        raise HTTPException(401, "Google did not return an identity token.")
                    claims = await provider_json(client, "GET", "https://oauth2.googleapis.com/tokeninfo",
                                                 params={"id_token": tokens["id_token"]})
                if (claims.get("aud") != flow["client_id"] or
                    claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"} or
                    claims.get("email_verified") not in (True, "true") or
                    not claims.get("sub") or not claims.get("email") or
                    float(claims.get("exp", 0)) <= time.time()):
                    raise HTTPException(401, "Google could not verify this account for SMARAN.AI.")
                flow.update(status="complete", claims={**claims, "provider": "google"})
            except (HTTPException, TypeError, ValueError) as exc:
                flow.update(status="error", error=getattr(exc, "detail", "Google returned an invalid identity."))
            finally:
                flow.pop("verifier", None)
        message = "Sign-in completed. Return to SMARAN.AI." if flow["status"] == "complete" else "Sign-in could not finish. Return to SMARAN.AI and try again."
        heading = "Google sign-in complete" if flow["status"] == "complete" else "Google sign-in could not finish"
        html = f"""<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\">
    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
    <title>SMARAN.AI sign-in</title>
    <style>
      :root {{ color-scheme: dark; font-family: system-ui, sans-serif; }}
      body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #070709; color: #f4f4f5; }}
      main {{ width: min(420px, calc(100vw - 48px)); box-sizing: border-box; padding: 32px; border: 1px solid #7f1d1d; border-radius: 20px; background: #111114; text-align: center; box-shadow: 0 0 48px rgba(239,68,68,.16); }}
      h1 {{ margin: 0 0 10px; font-size: 22px; }}
      p {{ margin: 0 0 24px; color: #d4d4d8; line-height: 1.5; }}
      button {{ border: 0; border-radius: 10px; padding: 11px 18px; background: #dc2626; color: white; font: inherit; cursor: pointer; }}
    </style>
  </head>
  <body><main><h1>{heading}</h1><p>{message}</p><button type=\"button\" onclick=\"window.close()\">Close this window</button></main></body>
</html>"""
        return HTMLResponse(html, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @router.post("/poll")
    async def poll(body: PollRequest, response: Response, request: Request, db=Depends(get_db)):
        flow = entry(body.ticket)
        response.headers["Cache-Control"] = "no-store"
        async with flow["lock"]:
            if body.ticket not in pending:
                raise HTTPException(410, "This sign-in has already completed.")
            # Nothing is asked of a provider here any more. Google's flow is
            # finished by its callback, so polling only reports what that
            # callback has already decided.
            if flow["status"] == "error":
                pending.pop(body.ticket, None)
                raise HTTPException(401, flow["error"])
            if flow["status"] != "complete":
                return {"status": "pending", "interval": flow.get("interval", 2)}
            pending.pop(body.ticket, None)
            return {"status": "complete", **finish_login(flow["claims"], response, request, db)}

    # Sign-ins in flight. Exposed so tests can read one without reaching into a
    # closure; it is never mutated from outside.
    router.pending = pending

    @router.post("/cancel")
    async def cancel(body: PollRequest):
        pending.pop(body.ticket, None)
        return {"cancelled": True}

    return router
