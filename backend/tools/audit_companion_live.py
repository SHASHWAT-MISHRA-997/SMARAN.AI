"""Live companion/cowork audit against the running backend on port 8000.

Exercises the full phone-pairing and remote-dispatch loop over HTTP.
Routes under /api/companion:
  POST /pairing/start?port=8000 → generates pairing code
  POST /pairing/claim           → phone claims the pairing
  GET  /devices                 → list paired devices
  POST /dispatch                → desktop dispatches to phone
  POST /command                 → desktop queues command for phone
  GET  /commands?token=         → phone polls & clears queue
  POST /from-device             → phone runs action on desktop
  POST /sync                    → bidirectional conversation sync
  GET  /desktop-commands        → desktop polls phone-sent commands
  DELETE /devices/{id}          → unpair
  GET  /status                  → network reachability
"""

import json
import os
import sys
import time
import datetime
import requests

BASE = os.environ.get("SMARAN_BACKEND", "http://127.0.0.1:8000")
results = []

def check(name, passed, detail=""):
    results.append({"check": name, "passed": passed, "detail": detail})
    print(f"{'PASS' if passed else 'FAIL'} {name}" + (f" — {detail}" if detail else ""), flush=True)
    return passed


def main():
    s = requests.Session()

    # 0. Status — is this machine reachable?
    try:
        r = s.get(f"{BASE}/api/companion/status", params={"port": 8000})
        data = r.json()
        check("companion status", r.status_code == 200 and data.get("reachable") is True,
              f"reachable={data.get('reachable')}, address={data.get('address')}")
    except Exception as e:
        check("companion status", False, str(e))

    # 1. Start pairing
    try:
        r = s.post(f"{BASE}/api/companion/pairing/start", params={"port": 8000})
        data = r.json()
        code = data.get("code")
        check("start pairing", r.status_code == 200 and bool(code),
              f"status={r.status_code}, code={code}, qr_payload={data.get('qr_payload','')[:60]}")
    except Exception as e:
        check("start pairing", False, str(e))
        code = None

    if not code:
        print("Cannot continue without a pairing code")
        write_results()
        return

    # 2. Claim the pairing (simulating what the phone app does)
    try:
        r = s.post(f"{BASE}/api/companion/pairing/claim", json={
            "code": code,
            "device_name": "audit-phone",
            "device_kind": "phone"
        })
        claim = r.json()
        token = claim.get("token")
        device_id = claim.get("device_id")
        check("claim pairing", r.status_code == 200 and bool(token),
              f"status={r.status_code}, device_id={device_id}, has_token={bool(token)}")
    except Exception as e:
        check("claim pairing", False, str(e))
        token = None
        device_id = None

    if not token:
        print("Cannot continue without a device token")
        write_results()
        return

    # 3. List paired devices
    try:
        r = s.get(f"{BASE}/api/companion/devices")
        data = r.json()
        devices = data.get("devices", [])
        found = any(d.get("name") == "audit-phone" for d in devices)
        check("list paired devices", r.status_code == 200 and found,
              f"status={r.status_code}, device_count={len(devices)}, found_audit_phone={found}")
    except Exception as e:
        check("list paired devices", False, str(e))

    # 4. Dispatch a "speak" command to the phone via /dispatch
    try:
        r = s.post(f"{BASE}/api/companion/dispatch", json={
            "device_id": device_id,
            "action": "speak",
            "data": {"text": "Hello from the audit"}
        })
        data = r.json()
        check("dispatch speak to phone",
              r.status_code == 200 and data.get("dispatched") is True,
              f"status={r.status_code}, dispatched={data.get('dispatched')}")
    except Exception as e:
        check("dispatch speak to phone", False, str(e))

    # 5. Phone polls for commands (should see the speak)
    try:
        r = s.get(f"{BASE}/api/companion/commands", params={"token": token})
        data = r.json()
        cmds = data.get("commands", [])
        has_speak = any(c.get("action") == "speak" for c in cmds)
        check("phone polls commands",
              r.status_code == 200 and has_speak,
              f"status={r.status_code}, commands_count={len(cmds)}, has_speak={has_speak}")
    except Exception as e:
        check("phone polls commands", False, str(e))

    # 6. At-most-once delivery — second poll should be empty
    try:
        r = s.get(f"{BASE}/api/companion/commands", params={"token": token})
        data = r.json()
        cmds = data.get("commands", [])
        check("at-most-once delivery",
              r.status_code == 200 and len(cmds) == 0,
              f"status={r.status_code}, remaining={len(cmds)}")
    except Exception as e:
        check("at-most-once delivery", False, str(e))

    # 7. Queue command via /command endpoint
    try:
        r = s.post(f"{BASE}/api/companion/command", json={
            "target_device_id": device_id,
            "action": "notify",
            "params": {"title": "Audit", "body": "Notification via /command"}
        })
        data = r.json()
        check("queue command via /command",
              r.status_code == 200 and data.get("queued") is True,
              f"status={r.status_code}, queued={data.get('queued')}, pending={data.get('pending')}")
    except Exception as e:
        check("queue command via /command", False, str(e))

    # 8. Phone polls again to get the queued notify
    try:
        r = s.get(f"{BASE}/api/companion/commands", params={"token": token})
        data = r.json()
        cmds = data.get("commands", [])
        has_notify = any(c.get("action") == "notify" for c in cmds)
        check("phone receives queued notify",
              r.status_code == 200 and has_notify,
              f"status={r.status_code}, has_notify={has_notify}")
    except Exception as e:
        check("phone receives queued notify", False, str(e))

    # 9. Phone sends command from its side via /from-device (notify → queued for desktop)
    try:
        r = s.post(f"{BASE}/api/companion/from-device", json={
            "token": token,
            "action": "notify",
            "params": {"title": "Audit", "body": "Phone-to-desktop notification"}
        })
        data = r.json()
        check("phone sends from-device notify",
              r.status_code == 200 and data.get("queued") is True,
              f"status={r.status_code}, response={json.dumps(data)[:200]}")
    except Exception as e:
        check("phone sends from-device notify", False, str(e))

    # 10. Desktop polls for commands from the phone
    try:
        r = s.get(f"{BASE}/api/companion/desktop-commands")
        data = r.json()
        cmds = data.get("commands", [])
        has_cmd = any(c.get("action") == "notify" for c in cmds)
        check("desktop polls phone commands",
              r.status_code == 200 and has_cmd,
              f"status={r.status_code}, commands={len(cmds)}, has_notify={has_cmd}")
    except Exception as e:
        check("desktop polls phone commands", False, str(e))

    # 11. Sync conversation
    try:
        now = datetime.datetime.now().isoformat()
        r = s.post(f"{BASE}/api/companion/sync", json={
            "token": token,
            "messages": [{
                "session_id": "audit-conv-live-001",
                "session_title": "Audit test conversation",
                "role": "user",
                "content": "Hello from companion audit",
                "created_at": now
            }],
            "since": None
        })
        data = r.json()
        check("sync conversation",
              r.status_code == 200 and isinstance(data.get("accepted"), int),
              f"status={r.status_code}, accepted={data.get('accepted')}, server_time={data.get('server_time')}")
    except Exception as e:
        check("sync conversation", False, str(e))

    # 12. Disallowed action → should be refused
    try:
        r = s.post(f"{BASE}/api/companion/dispatch", json={
            "device_id": device_id,
            "action": "delete_all_files",
            "data": {}
        })
        check("disallowed action refused",
              r.status_code == 400,
              f"status={r.status_code}")
    except Exception as e:
        check("disallowed action refused", False, str(e))

    # 13. Unpair the device
    try:
        r = s.delete(f"{BASE}/api/companion/devices/{device_id}")
        check("unpair device",
              r.status_code == 200,
              f"status={r.status_code}, body={r.text[:200]}")
    except Exception as e:
        check("unpair device", False, str(e))

    # 14. After unpair, the token should no longer work
    try:
        r = s.get(f"{BASE}/api/companion/commands", params={"token": token})
        check("revoked token rejected",
              r.status_code == 401,
              f"status={r.status_code}")
    except Exception as e:
        check("revoked token rejected", False, str(e))

    write_results()


def write_results():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           ".cache", "audit")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "live-companion-cowork.json")
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "passed": passed,
        "total": total,
        "all_passed": passed == total,
        "checks": results
    }
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\n{'='*60}")
    print(f"Results: {passed}/{total} passed")
    print(f"Written to: {out_path}")


if __name__ == "__main__":
    main()
