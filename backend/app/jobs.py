"""Work that keeps going when you look away.

A chat reply, a SMARAN Code run or a Design page used to be produced inside
the request that asked for it. Opening another conversation, starting a new
coding task or switching to another screen dropped that request - and the
server, seeing it gone, stopped the work. Half-written answers vanished and
runs ended mid-step.

Now the work runs as a job of its own. The request that started it only
watches: it can go away, and the job carries on and saves its result as
before. Any screen can attach again - from the beginning, to replay what it
missed, and then live.

  start(kind, stream, meta)   run an async generator of NDJSON lines
  follow(job_id, offset)      the lines from `offset`, then new ones as they come
"""
from __future__ import annotations

import asyncio
import json
import secrets
import time
from typing import AsyncIterator, Dict, List, Optional

KEEP_FINISHED_SECONDS = 3600
MAX_JOBS = 200


class Job:
    def __init__(self, kind: str, meta: Dict):
        self.id = secrets.token_urlsafe(10)
        self.kind = kind
        self.meta = meta
        self.lines: List[str] = []
        self.done = False
        self.error = ""
        self.started = time.time()
        self.finished: Optional[float] = None
        self._changed = asyncio.Event()
        self.task: Optional[asyncio.Task] = None

    def info(self) -> Dict:
        return {"id": self.id, "kind": self.kind, "meta": self.meta, "done": self.done, "error": self.error,
                "lines": len(self.lines), "started": self.started, "finished": self.finished}

    def _push(self, line: str) -> None:
        self.lines.append(line if line.endswith("\n") else line + "\n")
        self._changed.set()


_jobs: Dict[str, Job] = {}
# Work asked for whose job does not exist yet: a chat reply spends seconds
# searching the web and reading documents before it streams a word. Someone
# who opens the conversation in that window must learn that something is on
# its way, or they see their question with no answer and nothing coming.
_preparing: Dict[str, Dict] = {}


def _prune() -> None:
    now = time.time()
    for job_id, job in list(_jobs.items()):
        if job.done and job.finished and now - job.finished > KEEP_FINISHED_SECONDS:
            _jobs.pop(job_id, None)
    while len(_jobs) > MAX_JOBS:
        oldest = min((j for j in _jobs.values() if j.done), key=lambda j: j.started, default=None)
        if oldest is None:
            break
        _jobs.pop(oldest.id, None)


def start(kind: str, stream: AsyncIterator[str], meta: Optional[Dict] = None) -> Job:
    """Run `stream` to the end in the background, whoever is watching."""
    _prune()
    job = Job(kind, meta or {})

    async def run():
        try:
            async for line in stream:
                if line:
                    job._push(line)
        except asyncio.CancelledError:
            job.error = "Stopped."
            job._push(json.dumps({"type": "error", "error": "Stopped.", "message": "Stopped."}))
            raise
        except Exception as exc:  # noqa: BLE001 - reported to whoever watches
            job.error = str(exc)[:300]
            job._push(json.dumps({"type": "error", "error": job.error, "message": job.error}))
        finally:
            job.done = True
            job.finished = time.time()
            job._changed.set()

    job.task = asyncio.get_running_loop().create_task(run())

    def ended(task):
        # Also covers a job cancelled before it ever started, when run()'s
        # own cleanup never gets to run.
        if not job.done:
            job.done = True
            job.finished = time.time()
            if task.cancelled() and not job.error:
                job.error = "Stopped."
            job._changed.set()

    job.task.add_done_callback(ended)
    _jobs[job.id] = job
    return job


def get(job_id: str) -> Optional[Job]:
    return _jobs.get(job_id)


def preparing(kind: str, meta: Dict) -> str:
    """Announce work that will become a job shortly; pair with prepared()."""
    token = secrets.token_urlsafe(8)
    _preparing[token] = {"id": None, "kind": kind, "meta": meta, "done": False, "error": "",
                         "lines": 0, "started": time.time(), "finished": None, "preparing": True}
    return token


def prepared(token: str) -> None:
    _preparing.pop(token, None)


def listing(**filters) -> List[Dict]:
    out = []
    kind = filters.pop("kind", None)
    wanted = lambda k, meta: (kind is None or k == kind) and all(
        meta.get(key) == v for key, v in filters.items() if v is not None)
    for job in _jobs.values():
        if wanted(job.kind, job.meta):
            out.append(job.info())
    out.extend(dict(p) for p in _preparing.values() if wanted(p["kind"], p["meta"]))
    return sorted(out, key=lambda j: j["started"], reverse=True)


async def follow(job: Job, offset: int = 0, announce: bool = True) -> AsyncIterator[str]:
    """Everything from `offset`, then each new line, until the job ends."""
    if announce:
        yield json.dumps({"type": "job", "job_id": job.id, "kind": job.kind}) + "\n"
    position = max(0, offset)
    while True:
        while position < len(job.lines):
            yield job.lines[position]
            position += 1
        if job.done:
            return
        job._changed.clear()
        if position < len(job.lines):
            continue
        try:
            await asyncio.wait_for(job._changed.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass


def cancel(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if not job or job.done or not job.task:
        return False
    job.task.cancel()
    return True
