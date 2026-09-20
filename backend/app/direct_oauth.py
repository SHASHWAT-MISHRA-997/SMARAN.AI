"""Direct provider sign-in. Provider tokens never become local session tokens."""
import asyncio
import base64
import hashlib
import os
import secrets
import time
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

GOOGLE_DESKTOP_CLIENT_ID = "656427300466-d1fetqra2pv352klkociveaem72kvpdr.apps.googleusercontent.com"
GITHUB_CLIENT_ID = "Ov23livgXVI30gGhq3wQ"
LOOPBACK = {"localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"}


def desktop_client_id():
    return os.environ.get("SMARAN_GOOGLE_DESKTOP_CLIENT_ID", GOOGLE_DESKTOP_CLIENT_ID).strip()


def github_client_id():
    return os.environ.get("SMARAN_GITHUB_CLIENT_ID", GITHUB_CLIENT_ID).strip()


async def provider_json(client, method, url, **kwargs):
    try:
        reply = await client.request(method, url, **kwargs)
        data = reply.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "The sign-in provider could not be reached. Please retry.")
    if reply.status_code >= 400:
        raise HTTPException(401, "The provider could not verify this sign-in. Please retry.")
    return data


async def github_identity(client, token):
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    user = await provider_json(client, "GET", "https://api.github.com/user", headers=headers)
    emails = await provider_json(client, "GET", "https://api.github.com/user/emails", headers=headers)
    verified = [e for e in emails if e.get("verified") and e.get("email")]
    if not user.get("id") or not verified:
        raise HTTPException(401, "GitHub did not return a verified email address.")
    email = next((e["email"] for e in verified if e.get("primary")), verified[0]["email"])
    return {"email": email.strip().lower(), "name": user.get("name") or user.get("login"),
            "picture": user.get("avatar_url"), "sub": str(user["id"]), "provider": "github"}


SITE = os.getenv("SMARAN_SITE_ORIGIN", "https://smaran-ai.netlify.app").rstrip("/")

# Asked once and remembered, because it is the same answer every time for a
# given deployment and this sits in front of a button someone is waiting on.
_site_github: dict = {}


async def site_holds_github_secret():
    """Can the site finish a GitHub sign-in for us?

    If it can, GitHub is one tap - open the browser, authorise, done. If it
    cannot, the device-code flow still works with no secret anywhere, so the
    fallback is a working sign-in rather than a broken one, and that is why
    this is a question rather than an assumption.
    """
    if "answer" in _site_github and time.monotonic() < _site_github["until"]:
        return _site_github["answer"]
    answer = False
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            reply = await client.get(f"{SITE}/api/github/config")
            answer = bool(reply.status_code == 200 and reply.json().get("configured"))
    except Exception:
        # Offline, or the site is down. The device flow needs github.com and
        # nothing else, so it is the better bet from here.
        answer = False
    # A "no" is rechecked sooner: it is the answer that changes the moment the
    # secret is configured, and nobody should have to restart the app for it.
    _site_github.update(answer=answer, until=time.monotonic() + (3600 if answer else 120))
    return answer


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
        return {"google_client_id": web_client_id(), "google_desktop_client_id": desktop_client_id(),
                "github_client_id": github_client_id()}

    @router.post("/{provider}/start")
    async def start(provider: str, request: Request, response: Response):
        if provider not in {"google", "github"}:
            raise HTTPException(404, "Unknown sign-in provider.")
        prune()
        if len(pending) >= 64:
            raise HTTPException(429, "Too many pending sign-ins. Please retry shortly.")
        if request.headers.get("sec-fetch-site") == "cross-site":
            raise HTTPException(403, "Start sign-in from SMARAN.AI.")
        ticket = secrets.token_urlsafe(32)
        flow = {"provider": provider, "expires": time.monotonic() + 600,
                "lock": asyncio.Lock(), "status": "pending"}
        result = {"ticket": ticket, "expires_in": 600, "interval": 2}
        if provider == "google":
            if not desktop_client_id():
                raise HTTPException(503, "Google desktop sign-in is not configured.")
            if request.url.hostname not in LOOPBACK or not request.client or request.client.host not in LOOPBACK:
                raise HTTPException(400, "Open SMARAN.AI on this computer using localhost to sign in with Google.")
            verifier = secrets.token_urlsafe(48)
            state = secrets.token_urlsafe(32)
            redirect = str(request.base_url).rstrip("/") + "/api/auth/direct/google/callback"
            flow.update(verifier=verifier, state=state, redirect=redirect, client_id=desktop_client_id())
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
            result["url"] = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
                "client_id": flow["client_id"], "redirect_uri": redirect, "response_type": "code",
                "scope": "openid email profile", "state": state, "code_challenge": challenge,
                "code_challenge_method": "S256", "prompt": "select_account"})
        elif await site_holds_github_secret():
            # The same one-tap path the phone takes. GitHub OAuth Apps have no
            # PKCE, so the token exchange needs a secret and cannot happen
            # here; the site does it and hands back an identity sealed against
            # the challenge below. Only this process holds the verifier that
            # opens it, so the answer is useless to anything else that sees it
            # go past on loopback.
            if request.url.hostname not in LOOPBACK or not request.client or request.client.host not in LOOPBACK:
                raise HTTPException(400, "Open SMARAN.AI on this computer using localhost to sign in with GitHub.")
            verifier = secrets.token_urlsafe(48)
            state = secrets.token_urlsafe(32)
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
            redirect = (str(request.base_url).rstrip("/")
                        + "/api/auth/direct/github/callback?state=" + quote(state))
            flow.update(verifier=verifier, state=state)
            result["url"] = f"{SITE}/api/github/start?" + urlencode({
                "challenge": challenge, "redirect": redirect})
        else:
            if not github_client_id():
                raise HTTPException(503, "GitHub sign-in is not configured.")
            async with httpx.AsyncClient(timeout=15) as client:
                data = await provider_json(client, "POST", "https://github.com/login/device/code",
                    data={"client_id": github_client_id(), "scope": "read:user user:email"},
                    headers={"Accept": "application/json"})
            if data.get("error") or not data.get("device_code"):
                raise HTTPException(503, "GitHub Device Flow is unavailable for this application.")
            interval = max(5, int(data.get("interval", 5)))
            expiry = min(900, int(data.get("expires_in", 900)))
            flow.update(device_code=data["device_code"], client_id=github_client_id(),
                        interval=interval, next_poll=time.monotonic() + interval,
                        expires=time.monotonic() + expiry)
            # GitHub does not send verification_uri_complete, but its device
            # page reads ?code= - so the person taps once and confirms, rather
            # than copying eight characters between two apps by hand. The bare
            # URL is still shown as the fallback if the prefill is ignored.
            verify = data.get("verification_uri") or "https://github.com/login/device"
            result.update(url=f"{verify}?code={quote(data['user_code'])}",
                          plain_url=verify, user_code=data["user_code"],
                          interval=interval, expires_in=expiry)
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
                        "client_id": flow["client_id"], "code": code, "code_verifier": flow["verifier"],
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
        return HTMLResponse("<!doctype html><html><title>SMARAN.AI sign-in</title><body><h1>SMARAN.AI</h1><p>" + message + "</p></body></html>",
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @router.get("/github/callback", response_class=HTMLResponse)
    async def github_callback(state: str = "", result: str = "", error: str = ""):
        """The site hands the sealed identity back here, on loopback.

        The seal is opened by presenting the verifier, which never left this
        process - so anything that reads this URL off the machine still cannot
        turn it into a sign-in.
        """
        prune()
        flow = next((f for f in pending.values()
                     if f.get("state") == state and state and f["provider"] == "github"), None)
        if flow is None:
            raise HTTPException(400, "Invalid or expired sign-in state.")
        async with flow["lock"]:
            if flow["status"] != "pending":
                raise HTTPException(400, "This sign-in callback was already used.")
            flow["status"] = "processing"
            try:
                if error or not result:
                    raise HTTPException(401, "GitHub sign-in was cancelled. Please try again.")
                async with httpx.AsyncClient(timeout=15) as client:
                    identity = await provider_json(client, "POST", f"{SITE}/api/github/exchange",
                                                   json={"sealed": result, "verifier": flow["verifier"]})
                user = identity.get("user") or {}
                if not user.get("email") or not str(user.get("id", "")).startswith("github_"):
                    raise HTTPException(401, "GitHub did not return a verified email address.")
                flow.update(status="complete", claims={
                    "email": user["email"].strip().lower(), "name": user.get("username"),
                    "picture": user.get("avatar"), "sub": user["id"][len("github_"):],
                    "provider": "github"})
            except (HTTPException, TypeError, ValueError, KeyError) as exc:
                flow.update(status="error",
                            error=getattr(exc, "detail", "GitHub returned an invalid identity."))
            finally:
                flow.pop("verifier", None)
        message = ("Sign-in completed. Return to SMARAN.AI." if flow["status"] == "complete"
                   else "Sign-in could not finish. Return to SMARAN.AI and try again.")
        return HTMLResponse(
            "<!doctype html><html><title>SMARAN.AI sign-in</title><body><h1>SMARAN.AI</h1><p>"
            + message + "</p></body></html>",
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @router.post("/poll")
    async def poll(body: PollRequest, response: Response, request: Request, db=Depends(get_db)):
        flow = entry(body.ticket)
        response.headers["Cache-Control"] = "no-store"
        async with flow["lock"]:
            if body.ticket not in pending:
                raise HTTPException(410, "This sign-in has already completed.")
            # Only the device-code flow is polled from here. The browser flow
            # is finished by /github/callback, and has no device code to ask
            # about - reading next_poll on one of those raised a KeyError that
            # surfaced as a 500 on the first poll after the button was pressed.
            if ("device_code" in flow and flow["status"] == "pending"
                    and time.monotonic() >= flow["next_poll"]):
                flow["next_poll"] = time.monotonic() + flow["interval"]
                async with httpx.AsyncClient(timeout=15) as client:
                    data = await provider_json(client, "POST", "https://github.com/login/oauth/access_token",
                        data={"client_id": flow["client_id"], "device_code": flow["device_code"],
                              "grant_type": "urn:ietf:params:oauth:grant-type:device_code"},
                        headers={"Accept": "application/json"})
                    error = data.get("error")
                    if error == "slow_down":
                        flow["interval"] += 5
                        flow["next_poll"] = time.monotonic() + flow["interval"]
                    elif error and error != "authorization_pending":
                        flow.update(status="error", error="GitHub sign-in was denied or expired. Please start again.")
                    elif data.get("access_token"):
                        flow.update(status="complete", claims=await github_identity(client, data["access_token"]))
                        flow.pop("device_code", None)
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
