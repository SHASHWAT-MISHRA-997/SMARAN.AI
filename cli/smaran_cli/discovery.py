"""Finding the SMARAN.AI backend that is actually running.

The app binds a preferred port and falls back to an arbitrary free one when
that is taken, then writes the port it really got to runtime.json. Guessing
3003 therefore works until the day it does not, which is why that file is read
first and the guess is only a fallback.

A runtime.json left behind by a crashed app points at a port nobody is
listening on, so the pid it records is checked before the file is believed.
"""

from __future__ import annotations

import json
import os
import socket
import sys
from typing import Optional


APP_DIR_NAME = "SMARAN.AI"
DEFAULT_PORT = 3003
# `uvicorn app.main:app` is the documented source-development command.  Its
# port is deliberately tried too so the CLI remains useful when VS Code runs
# the backend directly instead of launching the packaged desktop application.
SOURCE_PORT = 8000


def _data_dirs() -> list[str]:
    """Every place the app might keep its data directory, most likely first."""
    out: list[str] = []

    if sys.platform == "win32":
        local = os.getenv("LOCALAPPDATA")
        if local:
            out.append(os.path.join(local, APP_DIR_NAME, "data"))
        roaming = os.getenv("APPDATA")
        if roaming:
            out.append(os.path.join(roaming, APP_DIR_NAME, "data"))
    elif sys.platform == "darwin":
        out.append(os.path.expanduser(f"~/Library/Application Support/{APP_DIR_NAME}/data"))
    else:
        base = os.getenv("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
        out.append(os.path.join(base, APP_DIR_NAME, "data"))

    # A source checkout keeps its data beside the code rather than in the
    # user profile, so a developer running from the repo is found too.
    out.append(os.path.join(os.getcwd(), "data"))
    return out


def _pid_alive(pid: int) -> bool:
    """Whether that process still exists.

    Signal 0 asks the kernel about the process without touching it. A pid we
    are not allowed to signal is still a running process, so PermissionError
    counts as alive rather than dead.
    """
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (OSError, ProcessLookupError):
        return False


def _port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.6) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(timeout)
        return probe.connect_ex((host, port)) == 0


def find_backend() -> Optional[str]:
    """The base URL of the running app, or None when it is not up.

    An explicit SMARAN_URL wins over discovery: someone running the backend
    somewhere unusual should not have to fight a file for it.
    """
    override = os.getenv("SMARAN_URL", "").strip().rstrip("/")
    if override:
        return override

    for directory in _data_dirs():
        path = os.path.join(directory, "runtime.json")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                record = json.load(handle)
        except (OSError, ValueError):
            continue

        port = int(record.get("port") or 0)
        pid = int(record.get("pid") or 0)
        if not port:
            continue
        # A stale file from a crashed run names a port nobody holds. Checking
        # the pid first avoids a connection attempt that will only time out.
        if pid and not _pid_alive(pid):
            continue
        if _port_open(port):
            return record.get("url") or f"http://127.0.0.1:{port}"

    # Nothing advertised, but the app may be running from source without
    # having written the file. Probe both supported local defaults.
    for port in (DEFAULT_PORT, SOURCE_PORT):
        if _port_open(port):
            return f"http://127.0.0.1:{port}"

    return None
