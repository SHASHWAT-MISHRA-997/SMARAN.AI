"""Long-running processes the coding agent starts and comes back to.

run_command waits for a command to finish, which a dev server, a watcher or
`python app.py` never does. Asked to run one, the agent sat on that step until
the time limit. These are started in the background instead: the agent gets
an id straight away, can read what the process has printed so far, and stops
it when done. Everything still running is stopped when SMARAN exits.
"""
from __future__ import annotations

import atexit
import os
import subprocess
import sys
import tempfile
import threading
import time
from typing import Dict, Optional

_MAX_RUNNING = 8
_lock = threading.Lock()
_procs: Dict[int, Dict] = {}


def start(command: str, cwd: str, env: Optional[Dict] = None) -> Dict:
    with _lock:
        running = [p for p in _procs.values() if p["proc"].poll() is None]
        if len(running) >= _MAX_RUNNING:
            raise RuntimeError("%d background processes are already running; stop one first." % len(running))
        log = tempfile.NamedTemporaryFile(prefix="smaran-proc-", suffix=".log", delete=False)
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0  # type: ignore[attr-defined]
        proc = subprocess.Popen(command, shell=True, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=flags)
        _procs[proc.pid] = {"proc": proc, "command": command, "log": log.name, "started": time.time(), "cwd": cwd}
        log.close()
        return {"id": proc.pid, "command": command}


def read(pid: int, tail: int = 4000) -> Dict:
    entry = _procs.get(int(pid))
    if not entry:
        raise KeyError("No background process %s." % pid)
    try:
        with open(entry["log"], "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - tail))
            text = fh.read().decode("utf-8", errors="replace")
    except OSError:
        text = ""
    code = entry["proc"].poll()
    return {"id": int(pid), "running": code is None, "exit_code": code, "output": text,
            "seconds": round(time.time() - entry["started"])}


def stop(pid: int) -> Dict:
    entry = _procs.get(int(pid))
    if not entry:
        raise KeyError("No background process %s." % pid)
    if entry["proc"].poll() is None:
        from app.agent.sandbox import kill_tree
        kill_tree(entry["proc"].pid)
    return read(pid)


def listing() -> list:
    return [{"id": pid, "command": e["command"], "running": e["proc"].poll() is None,
             "seconds": round(time.time() - e["started"])} for pid, e in _procs.items()]


@atexit.register
def _stop_all() -> None:
    for pid, entry in list(_procs.items()):
        if entry["proc"].poll() is None:
            try:
                from app.agent.sandbox import kill_tree
                kill_tree(pid)
            except Exception:  # noqa: BLE001
                pass
