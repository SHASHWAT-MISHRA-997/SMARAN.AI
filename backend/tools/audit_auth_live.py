"""Drive every /api/auth route against a running backend and check what matters.

Thirteen routes that had never been exercised outside unit tests. Status codes
are not the interesting part: what matters is that a wrong password is refused,
that logging out actually ends the session, that changing a password retires the
old one, and that a forgotten-password request does not tell an attacker which
accounts exist.

Run with the backend up on 127.0.0.1:8000:

    python backend/tools/audit_auth_live.py

Every account this creates is deleted again at the end, including on failure.
A driver that leaves rows behind is how the database reached 107 users.
"""

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("SMARAN_AUDIT_BASE", "http://127.0.0.1:8000")
BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

RUN = secrets.token_hex(4)
MARK = "audit_%s" % RUN          # every account this run creates starts with this
results = []


def call(method, path, body=None, token=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8", "replace")
            try:
                return response.status, json.loads(raw)
            except ValueError:
                return response.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw
    except urllib.error.URLError as exc:
        return 0, {"error": str(exc.reason)}


def check(name, passed, detail):
    results.append({"check": name, "passed": bool(passed), "detail": detail})
    print("%-4s %-52s %s" % ("PASS" if passed else "FAIL", name, detail))
    return bool(passed)


def cleanup():
    """Remove every account this run created, whatever happened above."""
    try:
        from app.database import SessionLocal
        from app.models import AuditLog, ChatSession, User, UserMemory
    except Exception as exc:                                  # pragma: no cover
        print("cleanup skipped, could not import models: %s" % exc)
        return
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.username.like(MARK + "%")).all()
        ids = [u.id for u in users]
        if ids:
            db.query(AuditLog).filter(AuditLog.user_id.in_(ids)).delete(
                synchronize_session=False)
            db.query(UserMemory).filter(UserMemory.user_id.in_(ids)).delete(
                synchronize_session=False)
            db.query(ChatSession).filter(ChatSession.user_id.in_(ids)).delete(
                synchronize_session=False)
            for user in users:
                db.delete(user)
            db.commit()
        print("\ncleanup: removed %d account(s) created by this run" % len(ids))
        left = db.query(User).filter(User.username.like(MARK + "%")).count()
        print("cleanup: %d remaining (must be 0)" % left)
    finally:
        db.close()


def main():
    status, _ = call("GET", "/api/ping")
    if status == 0:
        print("backend is not answering on %s - start it first" % BASE)
        return 2

    user = MARK
    # Not a .invalid / .test address: EmailStr rejects those reserved TLDs
    # outright, so every endpoint answered 422 and the checks below were
    # comparing validation errors to each other rather than real behaviour.
    email = "%s@smaran.ai" % MARK
    password = "Aud!t-" + secrets.token_urlsafe(12)
    changed = "Chg!t-" + secrets.token_urlsafe(12)

    # ---- registration -----------------------------------------------------
    status, body = call("POST", "/api/auth/register",
                        {"username": user, "email": email, "password": password})
    token = body.get("access_token") if isinstance(body, dict) else None
    check("register creates an account and returns a token",
          status == 200 and bool(token), "status=%s token=%s" % (status, bool(token)))

    status, body = call("POST", "/api/auth/register",
                        {"username": user, "email": email, "password": password})
    check("the same email cannot register twice",
          status == 400, "status=%s" % status)

    status, body = call("POST", "/api/auth/register",
                        {"username": MARK + "_weak", "email": "w_%s@smaran.ai" % MARK,
                         "password": "123"})
    # 422 is Pydantic refusing it in the field validator, which is the
    # stricter and more informative answer. Either is a refusal.
    check("a trivially weak password is refused",
          status in (400, 422), "status=%s" % status)

    # ---- identity ---------------------------------------------------------
    status, body = call("GET", "/api/auth/me", token=token)
    check("the token identifies the account that registered",
          status == 200 and isinstance(body, dict) and body.get("username") == user,
          "status=%s username=%s" % (status, (body or {}).get("username")))

    status, body = call("GET", "/api/auth/me", token="not-a-real-token-" + RUN)
    got = (body or {}).get("username") if isinstance(body, dict) else None
    check("a forged token does not return the real account",
          got != user, "username=%s" % got)

    # ---- login ------------------------------------------------------------
    status, body = call("POST", "/api/auth/login",
                        {"email": email, "password": password})
    login_token = body.get("access_token") if isinstance(body, dict) else None
    check("login with the correct password succeeds",
          status == 200 and bool(login_token), "status=%s" % status)

    status, body = call("POST", "/api/auth/login",
                        {"email": email, "password": password + "-wrong"})
    check("login with the WRONG password is refused",
          status in (400, 401, 403), "status=%s" % status)

    status, body = call("POST", "/api/auth/login",
                        {"email": "nobody-%s@smaran.ai" % RUN, "password": password})
    check("login as a nonexistent account is refused",
          status in (400, 401, 403, 404), "status=%s" % status)

    # ---- account enumeration ---------------------------------------------
    known_status, known = call("POST", "/api/auth/forgot-password", {"email": email})
    unknown_status, unknown = call("POST", "/api/auth/forgot-password",
                      {"email": "nobody-%s@smaran.ai" % RUN})
    # This driver speaks from 127.0.0.1, so it is the owner. The owner is meant
    # to be able to reset a password on their own machine - there is no mail
    # server - and therefore does see a difference between a real address and an
    # unknown one. That is not the leak.
    #
    # The leak is the same endpoint answering an untrusted caller on the LAN,
    # which is not reachable from here because every request from this process
    # is loopback. It is covered from a 192.168.x.x client in
    # tests/test_password_reset_is_not_a_takeover.py.
    has_token = "reset_token" in (known if isinstance(known, dict) else {})
    check("the owner's own machine still gets a usable reset token",
          known_status == 200 and has_token,
          "status=%s token present=%s" % (known_status, has_token))

    check("an address with no account yields no token, even locally",
          "reset_token" not in (unknown if isinstance(unknown, dict) else {}),
          "status=%s" % unknown_status)

    # ---- tokens that must not be accepted ---------------------------------
    status, _ = call("POST", "/api/auth/reset-password",
                     {"token": "bogus-" + RUN, "new_password": changed})
    check("reset-password rejects a bogus token",
          status >= 400, "status=%s" % status)

    status, _ = call("POST", "/api/auth/verify-email", {"token": "bogus-" + RUN})
    check("verify-email rejects a bogus token",
          status >= 400, "status=%s" % status)

    # ---- changing a password ---------------------------------------------
    status, _ = call("POST",
                     "/api/auth/change-password?current_password=%s&new_password=%s"
                     % ("definitely-not-it", changed), token=login_token)
    check("change-password refuses without the current password",
          status in (400, 401, 403), "status=%s" % status)

    status, _ = call("POST",
                     "/api/auth/change-password?current_password=%s&new_password=%s"
                     % (password, changed), token=login_token)
    check("change-password succeeds with the current password",
          status == 200, "status=%s" % status)

    status, _ = call("POST", "/api/auth/login",
                     {"email": email, "password": password})
    check("the OLD password stops working after the change",
          status in (400, 401, 403), "status=%s" % status)

    status, body = call("POST", "/api/auth/login",
                        {"email": email, "password": changed})
    fresh = body.get("access_token") if isinstance(body, dict) else None
    check("the NEW password works",
          status == 200 and bool(fresh), "status=%s" % status)

    # ---- logout -----------------------------------------------------------
    status, _ = call("POST", "/api/auth/logout", token=fresh)
    check("logout is accepted", status == 200, "status=%s" % status)

    status, body = call("GET", "/api/auth/me", token=fresh)
    still = (body or {}).get("username") if isinstance(body, dict) else None
    check("the session token stops working after logout",
          still != user, "username after logout=%s" % still)

    # ---- google sign-in configuration ------------------------------------
    status, before = call("GET", "/api/auth/google/config")
    check("google config is readable", status == 200, "status=%s" % status)
    original = (before or {}).get("client_id") or ""

    status, _ = call("POST", "/api/auth/google/config", {"client_id": "not-a-google-id"})
    check("a client id that is not Google's shape is refused",
          status == 400, "status=%s" % status)

    status, _ = call("POST", "/api/auth/google/config", {"client_id": original})
    check("the original google config is restorable",
          status == 200, "status=%s" % status)

    status, _ = call("POST", "/api/auth/google", {"credential": "bogus." + RUN})
    check("google sign-in refuses a credential Google did not issue",
          status >= 400, "status=%s" % status)

    # ---- device login -----------------------------------------------------
    status, _ = call("POST", "/api/auth/device-login", {"device_id": "!!bad!!"})
    check("device-login rejects a malformed device id",
          status == 400, "status=%s" % status)

    return 0


if __name__ == "__main__":
    started = time.time()
    code = 1
    try:
        code = main()
    finally:
        cleanup()

    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print("\n%d/%d checks passed in %.1fs" % (passed, total, time.time() - started))

    out = Path(BACKEND).parent / ".cache" / "audit"
    out.mkdir(parents=True, exist_ok=True)
    path = out / ("live-auth-%s.json" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    path.write_text(json.dumps(
        {"base": BASE, "run": RUN, "passed": passed, "total": total,
         "checks": results}, indent=2), encoding="utf-8")
    print("evidence: %s" % path)

    sys.exit(0 if (code == 0 and passed == total) else 1)
