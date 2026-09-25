"""Undo for one agent run: every file it wrote or edited, put back.

Before the agent's first write to a file in a run, the original is copied
aside - or, if the file did not exist, that fact is recorded. Undo restores
each original and deletes each file the run created. Exact and cheap: only
touched files are copied, unlike a snapshot of the whole folder, which was
slow on a real project and could not remove files the agent had added.

Commands the agent runs can change anything, so they are not covered; the
page says so next to the Undo button.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
from typing import Dict, List, Optional

from app.config import settings

KEEP_RUNS = 50
_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_lock = threading.Lock()


def _base() -> str:
    return os.path.join(settings.DATA_DIR, "agent-checkpoints")


def _dir(run_id: str) -> str:
    if not _RUN_ID.match(run_id or ""):
        raise ValueError("Unknown run.")
    return os.path.join(_base(), run_id)


def _manifest_path(run_id: str) -> str:
    return os.path.join(_dir(run_id), "manifest.json")


def _load(run_id: str) -> Optional[Dict]:
    try:
        with open(_manifest_path(run_id), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write(run_id: str, manifest: Dict) -> None:
    tmp = _manifest_path(run_id) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, _manifest_path(run_id))


def _prune() -> None:
    try:
        runs = sorted((e for e in os.scandir(_base()) if e.is_dir()), key=lambda e: e.stat().st_mtime)
    except OSError:
        return
    for entry in runs[:-KEEP_RUNS]:
        shutil.rmtree(entry.path, ignore_errors=True)


def remember(run_id: str, root: str, absolute: str) -> None:
    """Keep the original of a file about to be written, once per run."""
    root = os.path.abspath(root)
    absolute = os.path.abspath(absolute)
    rel = os.path.relpath(absolute, root)
    if rel.startswith(".."):
        return
    with _lock:
        folder = _dir(run_id)
        fresh = not os.path.isdir(folder)
        os.makedirs(folder, exist_ok=True)
        manifest = _load(run_id) or {"root": root, "created": time.time(), "files": {}, "undone": False}
        if rel in manifest["files"]:
            return
        entry = {"existed": os.path.isfile(absolute)}
        if entry["existed"]:
            backup = "%04d.bak" % (len(manifest["files"]) + 1)
            shutil.copy2(absolute, os.path.join(folder, backup))
            entry["backup"] = backup
        manifest["files"][rel] = entry
        _write(run_id, manifest)
        if fresh:
            _prune()


def changes(run_id: str) -> Dict:
    manifest = _load(run_id)
    if not manifest:
        return {"run_id": run_id, "files": [], "undone": False, "exists": False}
    files = [{"path": rel.replace("\\", "/"), "created": not entry["existed"]}
             for rel, entry in manifest["files"].items()]
    return {"run_id": run_id, "root": manifest["root"], "files": files,
            "undone": manifest.get("undone", False), "exists": True}


def undo(run_id: str) -> Dict:
    """Put every file the run touched back as it was."""
    with _lock:
        manifest = _load(run_id)
        if not manifest:
            raise ValueError("Nothing was changed in that run, so there is nothing to undo.")
        if manifest.get("undone"):
            raise ValueError("That run has already been undone.")
        root = os.path.abspath(manifest["root"])
        restored, removed, errors = [], [], []
        for rel, entry in manifest["files"].items():
            target = os.path.abspath(os.path.join(root, rel))
            if os.path.commonpath([root, target]) != root:
                errors.append("%s: outside the folder" % rel)
                continue
            try:
                if entry["existed"]:
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    shutil.copy2(os.path.join(_dir(run_id), entry["backup"]), target)
                    restored.append(rel)
                elif os.path.isfile(target):
                    os.remove(target)
                    removed.append(rel)
            except OSError as exc:
                errors.append("%s: %s" % (rel, exc))
        manifest["undone"] = not errors
        _write(run_id, manifest)
    return {"restored": restored, "removed": removed, "errors": errors}


def list_runs(limit: int = 20) -> List[Dict]:
    try:
        entries = sorted((e for e in os.scandir(_base()) if e.is_dir()),
                         key=lambda e: e.stat().st_mtime, reverse=True)[:limit]
    except OSError:
        return []
    out = []
    for entry in entries:
        info = changes(entry.name)
        if info["exists"]:
            out.append({"run_id": entry.name, "root": info["root"], "files": len(info["files"]),
                        "undone": info["undone"], "modified": entry.stat().st_mtime})
    return out
