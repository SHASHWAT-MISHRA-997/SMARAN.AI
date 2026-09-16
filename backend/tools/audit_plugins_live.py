"""Drive the plugin routes against a running backend.

Fifteen routes. The execute endpoints run plugin code, so which plugin is used
matters more than usual:

  text-reverse  a deterministic string skill. Its result can be checked against
                the input, which is the only way to tell "the skill ran" from
                "the endpoint answered".
  headroom      headroom_status, which reads and reports. Nothing is changed.

  paperclip     deliberately untouched. Its tools include install, uninstall,
                secrets, token and db:backup, none of which belong in an audit
                run on someone's machine.

  POST /install is exercised only on its refusal paths. Completing it clones a
                git repository and loads third-party code, which is not
                something to do unasked.

Enable, disable and config all write persistent state. Whatever they find is
put back at the end, including on failure.

    python backend/tools/audit_plugins_live.py
"""

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = os.environ.get("SMARAN_AUDIT_BASE", "http://127.0.0.1:8000")
BACKEND = Path(__file__).resolve().parents[1]
RUN = secrets.token_hex(4)
SAFE_SKILL = "text-reverse"
SAFE_TOOL = "headroom"
results = []
restore = {}
created_custom = []


def call(method, path, body=None, timeout=120):
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
    print("%-4s %-58s %s" % ("PASS" if passed else "FAIL", name, str(detail)[:62]))
    return bool(passed)


def cleanup():
    if restore.get("enabled") is True:
        call("POST", "/api/plugins/%s/enable" % SAFE_SKILL)
        print("cleanup: re-enabled %s" % SAFE_SKILL)
    elif restore.get("enabled") is False:
        call("POST", "/api/plugins/%s/disable" % SAFE_SKILL)
        print("cleanup: re-disabled %s" % SAFE_SKILL)

    if "config" in restore:
        call("POST", "/api/plugins/%s/config" % SAFE_SKILL, restore["config"])
        print("cleanup: restored %s config" % SAFE_SKILL)

    for plugin_id in created_custom:
        status, _ = call("DELETE", "/api/plugins/custom/%s" % plugin_id)
        print("cleanup: deleted custom plugin %s -> %s" % (plugin_id, status))

    status, body = call("GET", "/api/plugins/%s" % SAFE_SKILL)
    if status == 200:
        now = (body.get("config") or {}).get("enabled")
        print("cleanup: %s enabled is now %s (was %s)"
              % (SAFE_SKILL, now, restore.get("enabled")))


def main():
    if call("GET", "/api/ping")[0] == 0:
        print("backend is not answering on %s - start it first" % BASE)
        return 2

    # ---- inventory --------------------------------------------------------
    status, body = call("GET", "/api/plugins")
    plugins = (body or {}).get("plugins", {})
    check("plugins can be listed", status == 200 and len(plugins) > 0,
          "status=%s count=%d" % (status, len(plugins)))

    status, health = call("GET", "/api/plugins/health")
    registered = (health or {}).get("registered_plugins")
    loaded = (health or {}).get("loaded_plugins")
    check("health reports registered and loaded counts",
          status == 200 and registered is not None,
          "registered=%s loaded=%s" % (registered, loaded))

    check("the health count agrees with the listing",
          registered == len(plugins),
          "health=%s list=%s" % (registered, len(plugins)))

    check("every plugin says whether it actually loaded",
          all("loaded" in p for p in plugins.values()),
          "missing=%s" % [n for n, p in plugins.items() if "loaded" not in p][:3])

    status, one = call("GET", "/api/plugins/%s" % SAFE_SKILL)
    restore["enabled"] = (one.get("config") or {}).get("enabled") \
        if isinstance(one, dict) else None
    restore["config"] = {"config": (one.get("config") or {}).get("config", {})} \
        if isinstance(one, dict) else {}
    check("a named plugin can be read",
          status == 200 and one.get("name") == SAFE_SKILL, "status=%s" % status)

    status, _ = call("GET", "/api/plugins/no-such-plugin-%s" % RUN)
    check("an unknown plugin is a 404", status == 404, "status=%s" % status)

    # ---- the execute routes, on plugins chosen to be safe -----------------
    # The body carries the name too: {skill_name, context} and
    # {tool_name, arguments}. Sending {"parameters": ...} was a 422, and the
    # "unknown skill is refused" checks below were passing on that same 422 -
    # refused for a malformed body rather than for the unknown name they
    # claimed to be testing. A check that passes for the wrong reason is worse
    # than one that fails.
    word = "audit%s" % RUN
    status, body = call("POST", "/api/plugins/%s/skills/reverse_string/execute"
                        % SAFE_SKILL,
                        {"skill_name": "reverse_string", "context": {"text": word}})
    returned = json.dumps(body)
    check("a skill actually runs and returns its real result",
          status == 200 and word[::-1] in returned,
          "status=%s reversed-present=%s" % (status, word[::-1] in returned))

    status, body = call("POST", "/api/plugins/%s/tools/headroom_status/execute"
                        % SAFE_TOOL,
                        {"tool_name": "headroom_status", "arguments": {}})
    check("a tool runs and answers",
          status == 200, "status=%s success=%s"
          % (status, (body or {}).get("success") if isinstance(body, dict) else None))

    status, body = call("POST", "/api/plugins/%s/skills/no_such_skill/execute"
                        % SAFE_SKILL,
                        {"skill_name": "no_such_skill", "context": {}})
    check("an unknown skill is refused, with a well-formed body",
          status >= 400 or (isinstance(body, dict) and body.get("success") is False),
          "status=%s body=%s" % (status, json.dumps(body)[:50]))

    status, body = call("POST", "/api/plugins/%s/tools/no_such_tool/execute"
                        % SAFE_TOOL,
                        {"tool_name": "no_such_tool", "arguments": {}})
    check("an unknown tool is refused, with a well-formed body",
          status >= 400 or (isinstance(body, dict) and body.get("success") is False),
          "status=%s body=%s" % (status, json.dumps(body)[:50]))

    status, _ = call("POST",
                     "/api/plugins/no-such-plugin-%s/tools/x/execute" % RUN,
                     {"tool_name": "x", "arguments": {}})
    check("executing on an unknown plugin is a 404",
          status == 404, "status=%s" % status)

    status, _ = call("POST", "/api/plugins/%s/tools/headroom_status/execute"
                     % SAFE_SKILL,
                     {"tool_name": "headroom_status", "arguments": {}})
    check("a skill plugin refuses to be driven as a tool plugin",
          status == 400, "status=%s" % status)

    status, body = call("POST", "/api/plugins/%s/diagnostic" % SAFE_SKILL, {})
    check("a plugin can report a diagnostic", status == 200, "status=%s" % status)

    # ---- enable / disable, restored afterwards ----------------------------
    status, _ = call("POST", "/api/plugins/%s/disable" % SAFE_SKILL)
    check("a plugin can be disabled", status == 200, "status=%s" % status)

    status, after = call("GET", "/api/plugins/%s" % SAFE_SKILL)
    now = (after.get("config") or {}).get("enabled")
    check("the disable is visible on the plugin", now is False, "enabled=%s" % now)

    status, _ = call("POST", "/api/plugins/%s/enable" % SAFE_SKILL)
    check("a plugin can be enabled again", status == 200, "status=%s" % status)

    status, after = call("GET", "/api/plugins/%s" % SAFE_SKILL)
    now = (after.get("config") or {}).get("enabled")
    check("the enable is visible on the plugin", now is True, "enabled=%s" % now)

    # ---- custom plugins, full lifecycle -----------------------------------
    status, body = call("GET", "/api/plugins/custom/all")
    check("custom plugins can be listed", status == 200, "status=%s" % status)

    # A custom plugin is registered by URL and type, not by inline code.
    endpoint = "http://127.0.0.1:59999/audit-%s" % RUN
    status, made = call("POST", "/api/plugins/custom", {
        "name": "audit-custom-%s" % RUN,
        "type": "mcp",
        "url": endpoint,
        "description": "Created by the plugin audit run",
    })
    plugin_id = made.get("id") if isinstance(made, dict) else None
    if plugin_id:
        created_custom.append(str(plugin_id))
    check("a custom plugin can be registered",
          status in (200, 201) and plugin_id is not None,
          "status=%s id=%s" % (status, plugin_id))

    status, listed = call("GET", "/api/plugins/custom/all")
    rows = listed if isinstance(listed, list) else (listed or {}).get("plugins", [])
    ids = [str(row.get("id")) for row in rows]
    check("the registered custom plugin is listed back",
          plugin_id is not None and str(plugin_id) in ids,
          "id=%s present=%s" % (plugin_id, str(plugin_id) in ids))

    # Nothing is listening on that port. This has to come back as a handled
    # failure rather than a traceback, because an unreachable endpoint is the
    # normal case when someone mistypes a URL.
    status, tested = call("POST", "/api/plugins/custom/test",
                          {"type": "mcp", "url": endpoint})
    check("testing an unreachable custom plugin fails cleanly, not with a 500",
          status != 500, "status=%s %s" % (status, json.dumps(tested)[:46]))

    if plugin_id:
        status, _ = call("DELETE", "/api/plugins/custom/%s" % plugin_id)
        if status in (200, 204):
            created_custom.remove(str(plugin_id))
        check("a custom plugin can be deleted",
              status in (200, 204), "status=%s" % status)

    status, _ = call("DELETE", "/api/plugins/custom/no-such-id-%s" % RUN)
    check("deleting an unknown custom plugin is refused",
          status >= 400, "status=%s" % status)

    # ---- install: refusal paths only --------------------------------------
    status, _ = call("POST", "/api/plugins/install", {"repo_url": ""})
    check("install refuses an empty repository url (nothing cloned)",
          status == 400, "status=%s" % status)

    status, body = call("POST", "/api/plugins/install",
                        {"repo_url": "not-a-url-at-all"})
    check("install refuses something that is not a repository url",
          status == 400, "status=%s" % status)

    status, body = call("POST", "/api/plugins/install",
                        {"repo_url": "file:///etc/passwd"})
    check("install refuses a non-http, non-git scheme",
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

    out = BACKEND.parent / ".cache" / "audit"
    out.mkdir(parents=True, exist_ok=True)
    path = out / ("live-plugins-%s.json" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    path.write_text(json.dumps(
        {"base": BASE, "run": RUN, "passed": passed, "total": total,
         "not_driven": [
             "POST /api/plugins/install success path - clones a repository and "
             "loads third-party code",
             "paperclip tools - include install, uninstall, secrets, token, db:backup",
         ],
         "checks": results}, indent=2), encoding="utf-8")
    print("evidence: %s" % path)

    sys.exit(0 if (code == 0 and passed == total) else 1)
