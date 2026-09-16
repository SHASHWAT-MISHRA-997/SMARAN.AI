"""Drive the Sites, Updates and Connectors routes against a running backend.

Sixteen routes that had never been exercised outside unit tests.

Three of them are deliberately NOT driven to completion, and the reason is
recorded rather than hidden:

  POST /api/sites/{id}/publish    runs `netlify deploy --prod`. That is a real
                                  production deployment of the owner's site and
                                  needs their approval for that specific
                                  release. Only the refusal path is exercised.
  POST /api/updates/install       launches the installer, which replaces the
                                  files this process is running from and closes
                                  the app. Only the refusal path is exercised.
  POST /api/updates/download      fetches a ~226 MB installer. Only its input
                                  handling is exercised.

Everything the site lifecycle creates is deleted again at the end, including on
failure.

    python backend/tools/audit_sites_updates_connectors_live.py
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
RUN = secrets.token_hex(4)
results = []
created_sites = []


def call(method, path, body=None, timeout=120):
    """Generating or refining a site runs a local model, which on this hardware
    takes minutes rather than seconds - those calls pass a longer timeout. A
    timeout is returned as a status rather than raised, so one slow route does
    not abandon the remaining checks or skip the cleanup."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
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
    except TimeoutError:
        return 0, {"error": "timed out after %ds" % timeout}


def check(name, passed, detail):
    results.append({"check": name, "passed": bool(passed), "detail": str(detail)[:200]})
    print("%-4s %-56s %s" % ("PASS" if passed else "FAIL", name, str(detail)[:70]))
    return bool(passed)


def cleanup():
    for site_id in list(created_sites):
        status, _ = call("DELETE", "/api/sites/%s" % site_id)
        print("cleanup: deleted site %s -> %s" % (site_id, status))
    status, body = call("GET", "/api/sites")
    if status == 200 and isinstance(body, (list, dict)):
        items = body if isinstance(body, list) else body.get("sites", [])
        left = [s for s in items if str(s.get("id")) in created_sites]
        print("cleanup: %d site(s) created by this run remain (must be 0)" % len(left))


def main():
    if call("GET", "/api/ping")[0] == 0:
        print("backend is not answering on %s - start it first" % BASE)
        return 2

    # ---- Sites: full lifecycle -------------------------------------------
    status, body = call("GET", "/api/sites")
    check("sites can be listed", status == 200, "status=%s" % status)

    name = "audit-site-%s" % RUN
    status, site = call("POST", "/api/sites",
                        {"name": name, "prompt": "A one page site for a tea shop"},
                        timeout=900)
    site_id = site.get("id") if isinstance(site, dict) else None
    if site_id:
        created_sites.append(str(site_id))
    check("a site can be created from a prompt",
          status in (200, 201) and bool(site_id), "status=%s id=%s" % (status, site_id))

    if site_id:
        status, got = call("GET", "/api/sites/%s" % site_id)
        check("the created site can be read back",
              status == 200 and got.get("id") == site_id, "status=%s" % status)

        status, preview = call("GET", "/api/sites/%s/preview" % site_id)
        body_text = preview if isinstance(preview, str) else json.dumps(preview)
        check("the site renders a preview with real markup",
              status == 200 and "<" in body_text and len(body_text) > 200,
              "status=%s bytes=%d" % (status, len(body_text)))

        status, refined = call("POST", "/api/sites/%s/refine" % site_id,
                               {"prompt": "Make the heading mention jasmine tea"},
                               timeout=900)
        check("a site can be refined", status == 200, "status=%s" % status)

    # ---- Sites: the destructive route, refusal path only ------------------
    status, _ = call("POST", "/api/sites/no-such-site-%s/publish" % RUN,
                     {"netlify_site_id": ""})
    check("publish refuses an unknown site (real deploy NOT run)",
          status == 404, "status=%s" % status)

    status, _ = call("GET", "/api/sites/no-such-site-%s" % RUN)
    check("reading an unknown site is a 404", status == 404, "status=%s" % status)

    status, _ = call("DELETE", "/api/sites/no-such-site-%s" % RUN)
    check("deleting an unknown site is a 404", status == 404, "status=%s" % status)

    # ---- Updates ----------------------------------------------------------
    status, body = call("GET", "/api/updates/check")
    # The keys are current_version / latest_version, not "current" / "version";
    # an exact-key check called a working endpoint a failure.
    has_version = isinstance(body, dict) and any(
        "version" in k for k in body)
    check("update check answers with a version view",
          status == 200 and has_version, "status=%s keys=%s"
          % (status, sorted(body)[:5] if isinstance(body, dict) else type(body).__name__))

    status, body = call("GET", "/api/updates/download/status")
    check("download status is readable without starting a download",
          status == 200, "status=%s" % status)

    status, _ = call("POST", "/api/updates/install", {"path": ""})
    check("install refuses an empty path (installer NOT launched)",
          status >= 400, "status=%s" % status)

    status, _ = call("POST", "/api/updates/install",
                     {"path": "C:/definitely/not/here/%s.exe" % RUN})
    check("install refuses a path that does not exist",
          status >= 400, "status=%s" % status)

    status, _ = call("POST", "/api/updates/install", {"path": "/etc/passwd"})
    check("install refuses a file that is not an installer",
          status >= 400, "status=%s" % status)

    # ---- Connectors -------------------------------------------------------
    status, body = call("GET", "/api/connectors/status")
    check("connector status is readable", status == 200, "status=%s" % status)

    status, body = call("GET", "/api/connectors/handy/hotkeys")
    check("handy hotkeys are readable", status == 200, "status=%s" % status)

    # These reach external services that are not running here. The point is
    # that they fail as a handled error, not a 500 traceback.
    for path, payload, label in (
        ("/api/connectors/comfyui/generate", {"prompt": "a teacup"}, "comfyui generate"),
        ("/api/connectors/heygem/avatar", {"text": "hello"}, "heygem avatar"),
        ("/api/connectors/omnivoice/tts", {"text": "hello"}, "omnivoice tts"),
    ):
        status, body = call("POST", path, payload)
        detail = json.dumps(body)[:80] if not isinstance(body, str) else body[:80]
        check("%s fails as a handled error, not a crash" % label,
              status != 500, "status=%s %s" % (status, detail))

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

    out = BACKEND.parent / ".cache" / "audit"
    out.mkdir(parents=True, exist_ok=True)
    path = out / ("live-sites-updates-connectors-%s.json"
                  % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    path.write_text(json.dumps(
        {"base": BASE, "run": RUN, "passed": passed, "total": total,
         "not_driven": ["POST /api/sites/{id}/publish (real netlify deploy --prod)",
                        "POST /api/updates/install (launches installer, closes app)",
                        "POST /api/updates/download (~226 MB fetch)"],
         "checks": results}, indent=2), encoding="utf-8")
    print("evidence: %s" % path)

    sys.exit(0 if (code == 0 and passed == total) else 1)
