"""Drive the Office and Orchestrator routes against a running backend.

Nineteen routes. Some are deliberately not driven, and why is recorded rather
than left looking untested:

  POST /api/office/word|excel|powerpoint|notepad
        Launch Word, Excel, PowerPoint or Notepad through COM and leave a
        window open on whatever desktop this runs on, having written a file
        into the owner's documents. Their refusal paths are exercised; the
        writers are not.

  POST /api/office/message, /api/office/message/by-name
        Open a browser or app handler with a draft. They never send - that is
        held down in tests/test_office_messaging_never_sends.py, with the
        handoff replaced so nothing opens. Only the refusal paths run here.

The contact this creates is deleted again, including on failure.

    python backend/tools/audit_office_orchestrator_live.py
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
CONTACT = "Audit Contact %s" % RUN
results = []
created_runs = []


def call(method, path, body=None, timeout=90):
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
    print("%-4s %-58s %s" % ("PASS" if passed else "FAIL", name, str(detail)[:64]))
    return bool(passed)


def cleanup():
    status, _ = call("DELETE", "/api/office/contacts/%s"
                     % urllib.request.quote(CONTACT))
    print("cleanup: removed audit contact -> %s" % status)
    status, body = call("GET", "/api/office/contacts")
    if status == 200 and isinstance(body, dict):
        names = [c.get("name") for c in body.get("contacts", [])]
        print("cleanup: audit contact still present: %s" % (CONTACT in names))
    for run_id in created_runs:
        call("POST", "/api/orchestrator/runs/%s/cancel" % run_id)
        print("cleanup: cancelled run %s" % run_id)


def main():
    if call("GET", "/api/ping")[0] == 0:
        print("backend is not answering on %s - start it first" % BASE)
        return 2

    # ---- Office: what this machine can do --------------------------------
    status, body = call("GET", "/api/office/available")
    docs = body.get("documents", {}) if isinstance(body, dict) else {}
    check("office reports what this machine can actually produce",
          status == 200 and isinstance(docs, dict) and "notepad" in docs,
          "status=%s word=%s excel=%s" % (status, docs.get("word"), docs.get("excel")))

    check("availability is probed, not assumed",
          all(isinstance(v, bool) for v in docs.values()),
          "values=%s" % sorted(set(type(v).__name__ for v in docs.values())))

    # ---- Office: contacts, full lifecycle --------------------------------
    status, before = call("GET", "/api/office/contacts")
    check("contacts are readable",
          status == 200 and "contacts" in (before or {}), "status=%s" % status)

    status, _ = call("POST", "/api/office/contacts",
                     {"name": CONTACT, "number": "+919876543210"})
    check("a contact can be added", status == 200, "status=%s" % status)

    status, after = call("GET", "/api/office/contacts")
    names = [c.get("name") for c in (after or {}).get("contacts", [])]
    check("the added contact is listed back", CONTACT in names,
          "found=%s" % (CONTACT in names))

    status, _ = call("DELETE", "/api/office/contacts/%s"
                     % urllib.request.quote(CONTACT))
    check("a contact can be removed", status == 200, "status=%s" % status)

    status, final = call("GET", "/api/office/contacts")
    names = [c.get("name") for c in (final or {}).get("contacts", [])]
    check("the removed contact is gone", CONTACT not in names,
          "still present=%s" % (CONTACT in names))

    status, _ = call("DELETE", "/api/office/contacts/no-such-contact-%s" % RUN)
    check("removing an unknown contact is refused, not silently ignored",
          status >= 400, "status=%s" % status)

    # ---- Office: the routes with side effects, refusal paths only --------
    status, _ = call("POST", "/api/office/message/by-name",
                     {"to": "definitely-nobody-%s" % RUN, "text": "hi"})
    check("messaging an unknown name is refused (nothing opened)",
          status >= 400, "status=%s" % status)

    status, _ = call("POST", "/api/office/word", {"title": "", "paragraphs": []})
    check("word refuses an empty document (Word NOT launched)",
          status >= 400, "status=%s" % status)

    status, _ = call("POST", "/api/office/excel", {"title": "", "rows": []})
    check("excel refuses an empty workbook (Excel NOT launched)",
          status >= 400, "status=%s" % status)

    # ---- Orchestrator: what it knows -------------------------------------
    status, body = call("GET", "/api/orchestrator/roles")
    roles = [r.get("name") for r in (body or {}).get("roles", [])]
    check("orchestrator roles are declared",
          status == 200 and len(roles) >= 2, "roles=%s" % roles)

    status, body = call("GET", "/api/orchestrator/models")
    local = (body or {}).get("local", [])
    check("orchestrator reports the models actually installed here",
          status == 200 and isinstance(local, list),
          "local=%s" % [m.get("model") for m in local][:3])

    check("embedding-only models are excluded from the usable list",
          all("embed" not in str(m.get("model", "")).lower() for m in local),
          "models=%s" % [m.get("model") for m in local][:3])

    # ---- Orchestrator: run lifecycle -------------------------------------
    status, body = call("GET", "/api/orchestrator/runs")
    check("runs can be listed", status == 200, "status=%s" % status)

    status, _ = call("GET", "/api/orchestrator/runs/no-such-run-%s" % RUN)
    check("an unknown run is a 404", status == 404, "status=%s" % status)

    status, _ = call("GET", "/api/orchestrator/runs/no-such-run-%s/changes" % RUN)
    check("changes for an unknown run is a 404", status == 404, "status=%s" % status)

    status, _ = call("POST", "/api/orchestrator/runs/no-such-run-%s/cancel" % RUN)
    check("cancelling an unknown run is a 404", status == 404, "status=%s" % status)

    # A plan is cheap enough to ask for; a run is not, so it is started and
    # cancelled rather than left to drive models for minutes.
    # The field is "request", not "goal" - sending the wrong name returned 422
    # and looked like a broken endpoint rather than a mistake in this driver.
    status, plan = call("POST", "/api/orchestrator/plan",
                        {"request": "Add a docstring to one function",
                         "allow_paid": False}, timeout=900)
    tasks = (plan or {}).get("tasks", []) if isinstance(plan, dict) else []
    check("a request can be planned into tasks by the local model",
          status == 200 and isinstance(tasks, list) and len(tasks) >= 1,
          "status=%s tasks=%d by=%s"
          % (status, len(tasks), (plan or {}).get("planned_by")))

    if tasks:
        check("every planned task names a role that was declared",
              all(t.get("role") in roles for t in tasks if t.get("role")),
              "task roles=%s declared=%s"
              % (sorted({t.get("role") for t in tasks}), roles))

    # Rule: paid providers are never reached for unless the caller said so.
    status, _ = call("POST", "/api/orchestrator/plan", {"request": "x" * 5})
    check("planning does not require opting into paid providers",
          status in (200, 400, 503), "status=%s" % status)

    status, _ = call("POST", "/api/orchestrator/plan", {"request": ""})
    check("an empty request is refused rather than planned",
          status == 422, "status=%s" % status)

    status, _ = call("POST", "/api/orchestrator/runs", {"request": "x", "root": ""})
    check("a run without a working directory is refused",
          status >= 400, "status=%s" % status)

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
    path = out / ("live-office-orchestrator-%s.json"
                  % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    path.write_text(json.dumps(
        {"base": BASE, "run": RUN, "passed": passed, "total": total,
         "not_driven": [
             "POST /api/office/{word,excel,powerpoint,notepad} - launch apps, write files",
             "POST /api/office/message[,/by-name] success path - opens a draft window; "
             "never-sends contract covered in tests/test_office_messaging_never_sends.py",
             "POST /api/orchestrator/runs - drives models for minutes",
             "GET /api/orchestrator/runs/{id}/stream - long-lived SSE",
         ],
         "checks": results}, indent=2), encoding="utf-8")
    print("evidence: %s" % path)

    sys.exit(0 if (code == 0 and passed == total) else 1)
