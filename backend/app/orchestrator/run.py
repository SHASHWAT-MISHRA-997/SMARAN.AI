"""One project, from a prompt to a reviewed result.

The order is: read the request, split it into tasks, run the tasks that can run
at the same time, and review what came out. What makes this more than a loop is
what happens between those steps.

A specialist's reply is not trusted with the file system. It comes back as text,
the files are pulled out of it, and every path is checked against the claim that
task made before it started. A ui task that decides to fix the server as well
has that file discarded and the run says so. Without that check the scopes in
the graph would be a suggestion, and the duplicate work they prevent would
come back through the reply instead of through the schedule.

Changes are staged as diffs before they are applied, and a task's writes are
applied together. If applying one of them fails halfway - the file moved
underneath the run, most often - the ones already written are put back. A task
that half-succeeded is worse than one that failed, because the review will read
it as finished.
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

from . import prompts
from .graph import GraphError, Task, TaskGraph, TaskState, build_graph, scopes_conflict
from .routing import Candidate, Completion, NoProviderAvailable, Router, select_candidates

logger = logging.getLogger("orchestrator.run")

#: Events are shown live and kept for the run's record. Bounded because a run
#: that streams every token would otherwise grow without limit.
MAX_EVENTS = 2000

#: How many specialists work at once. Two by default: the scope check makes
#: more of them safe, but a local engine serving four at once is slower than
#: serving two, and most graphs do not have four independent tasks anyway.
DEFAULT_CONCURRENCY = 2


class RunError(RuntimeError):
    """A run that cannot proceed, in the words of what stopped it."""


@dataclass
class RunConfig:
    request: str
    root: str = ""
    candidates: List[Candidate] = field(default_factory=list)
    allow_paid: bool = False
    concurrency: int = DEFAULT_CONCURRENCY
    #: False stages every change as a reviewable diff and applies none of them.
    apply_changes: bool = True
    #: Run by the user's instruction only. Nothing is inferred from the files.
    test_command: str = ""
    stack: str = ""


class FileStore:
    """The small part of a workspace this needs, so tests can replace it.

    `app.workspace.core.Workspace` already does diffs, digests and refusing a
    change whose file moved underneath it, and the real adapter below is a thin
    wrapper over it rather than a second implementation of the same thing.
    """

    def read(self, path: str) -> Optional[str]:
        """The file's text, or None if it is not there yet."""
        raise NotImplementedError

    def propose(self, path: str, content: str, summary: str) -> dict:
        raise NotImplementedError

    def apply(self, change_id: str) -> None:
        raise NotImplementedError

    def remove(self, path: str, summary: str) -> None:
        """Undo a file this run created. Used only by rollback."""
        raise NotImplementedError

    def listing(self) -> List[str]:
        return []


class WorkspaceStore(FileStore):
    """The real one."""

    def __init__(self, root: str) -> None:
        from app.workspace.core import Workspace

        self._workspace = Workspace()
        self._workspace.open(root)

    def read(self, path: str) -> Optional[str]:
        try:
            return self._workspace.read(path).get("content")
        except Exception:
            # Missing is not an error here: a task that creates a file has
            # nothing to read first.
            return None

    def propose(self, path: str, content: str, summary: str) -> dict:
        return self._workspace.propose_write(path, content, summary=summary)

    def apply(self, change_id: str) -> None:
        self._workspace.apply(change_id)

    def remove(self, path: str, summary: str) -> None:
        change = self._workspace.propose_delete(path, summary=summary)
        self._workspace.apply(change["id"])

    def listing(self) -> List[str]:
        try:
            entries = self._workspace.tree().get("entries") or []
        except Exception:
            return []
        return [e.get("path", "") for e in entries if not e.get("is_dir")]


def in_scope(path: str, scopes: Sequence[str]) -> bool:
    """May this task write this file?

    Uses the same comparison the scheduler uses to keep tasks apart, so a path
    a task is allowed to write is exactly one no other task could have claimed.
    """
    return any(scopes_conflict(path, scope) for scope in scopes)


class Run:
    """One director run. Owns its graph, its router and its record."""

    def __init__(self, config: RunConfig, *, store: Optional[FileStore] = None,
                 router: Optional[Router] = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.config = config
        self.created_at = time.time()
        self.state = "pending"          # pending|planning|working|reviewing|done|failed|cancelled
        self.error: Optional[str] = None
        self.review: Optional[dict] = None
        self.graph: Optional[TaskGraph] = None
        self.events: List[dict] = []
        self.changes: List[dict] = []   # every diff staged, applied or not
        self._store = store
        self._router = router
        self._cancelled = False
        self._lock = asyncio.Lock()

    # ---- record -------------------------------------------------------------

    def emit(self, kind: str, message: str, **data) -> None:
        event = {"at": time.time(), "kind": kind, "message": message, **data}
        self.events.append(event)
        if len(self.events) > MAX_EVENTS:
            del self.events[:len(self.events) - MAX_EVENTS]
        logger.debug("run %s %s: %s", self.id, kind, message)

    def cancel(self, reason: str = "Stopped by the user.") -> dict:
        self._cancelled = True
        stopped = self.graph.cancel(reason) if self.graph else 0
        if self.state not in ("done", "failed"):
            self.state = "cancelled"
        self.emit("cancelled", reason, stopped=stopped)
        return {"stopped": stopped}

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "request": self.config.request,
            "error": self.error,
            "created_at": self.created_at,
            "graph": self.graph.as_dict() if self.graph else None,
            "review": self.review,
            "changes": self.changes,
            "events": self.events[-200:],
            "providers": [c.as_dict() for c in self.config.candidates],
            "health": self._router.health_report() if self._router else {},
            "applied": self.config.apply_changes,
        }

    # ---- the run ------------------------------------------------------------

    async def start(self) -> dict:
        try:
            self._prepare()
            await self._plan()
            await self._work()
            await self._consolidate()
        except asyncio.CancelledError:
            self.state = "cancelled"
            self.emit("cancelled", "The run was stopped.")
        except (RunError, GraphError, NoProviderAvailable, prompts.PlanError) as exc:
            self.state = "failed"
            self.error = str(exc)
            self.emit("failed", str(exc))
        except Exception as exc:                                  # noqa: BLE001
            self.state = "failed"
            self.error = "The run stopped unexpectedly: %s" % exc
            self.emit("failed", self.error)
            logger.exception("run %s failed", self.id)
        return self.snapshot()

    def _prepare(self) -> None:
        allowed = select_candidates(self.config.candidates,
                                   allow_paid=self.config.allow_paid)
        self.config.candidates = allowed
        if self._router is None:
            self._router = Router(allowed)
        if self._store is None:
            if not self.config.root:
                raise RunError("The run has no project folder to work in.")
            self._store = WorkspaceStore(self.config.root)
        self.emit("providers", "Using %s" % ", ".join(c.label for c in allowed),
                  providers=[c.as_dict() for c in allowed])

    async def _plan(self) -> None:
        self.state = "planning"
        self.emit("planning", "Reading the request and splitting the work.")
        messages = prompts.decompose_prompt(
            self.config.request, files=self._store.listing(), stack=self.config.stack)
        completion = await self._router.complete(
            messages, role="review", is_cancelled=lambda: self._cancelled)

        specification = prompts.parse_plan(completion.text)
        self.graph = build_graph(specification)
        self.emit("planned",
                  "Split into %d tasks." % len(self.graph.tasks()),
                  owner=completion.candidate.label,
                  tasks=[t.as_dict() for t in self.graph.tasks()])

    async def _work(self) -> None:
        self.state = "working"
        workers = max(1, min(self.config.concurrency, len(self.graph.tasks())))
        await asyncio.gather(*(self._worker(n) for n in range(workers)))

    async def _worker(self, number: int) -> None:
        name = "worker-%d" % (number + 1)
        while not self._cancelled:
            async with self._lock:
                task = self.graph.claim(name)
            if task is None:
                if self.graph.done():
                    return
                # Something is running whose files this one needs. Waiting is
                # correct; spinning is not.
                await asyncio.sleep(0.05)
                continue
            await self._run_task(task)

    async def _run_task(self, task: Task) -> None:
        self.emit("task-started", "%s: %s" % (task.role, task.title),
                  task=task.id, attempt=task.attempts)
        try:
            completion = await self._ask_specialist(task)
        except asyncio.CancelledError:
            self.graph.fail(task.id, "The run was stopped.")
            raise
        except NoProviderAvailable as exc:
            self.graph.fail(task.id, str(exc))
            self.emit("task-failed", "%s: %s" % (task.title, exc), task=task.id)
            return
        except Exception as exc:                                  # noqa: BLE001
            retry = task.attempts < 2 and not self._cancelled
            self.graph.fail(task.id, str(exc), retry=retry)
            self.emit("task-failed" if not retry else "task-retrying",
                      "%s: %s" % (task.title, exc), task=task.id)
            return

        task.fallback_reason = completion.fallback_reason
        if completion.fallback_reason:
            self.emit("fallback", completion.fallback_reason, task=task.id)

        handoff = prompts.parse_handoff(completion.text)
        kept, refused = self._split_by_scope(task, handoff["files"])

        for path in refused:
            self.emit("out-of-scope",
                      "%s tried to write %s, which it does not own. Discarded."
                      % (task.title, path), task=task.id, path=path)

        if not kept and not handoff["notes"]:
            self.graph.fail(
                task.id,
                "%s replied without any files or notes." % completion.candidate.label,
                retry=task.attempts < 2)
            self.emit("task-failed", "%s produced nothing." % task.title, task=task.id)
            return

        try:
            applied = await asyncio.to_thread(self._stage, task, kept)
        except RunError as exc:
            self.graph.fail(task.id, str(exc))
            self.emit("task-failed", "%s: %s" % (task.title, exc), task=task.id)
            return

        summary = handoff["notes"] or "Wrote %d file(s)." % len(kept)
        if refused:
            summary += "\n(%d file(s) outside its scope were discarded.)" % len(refused)
        self.graph.finish(task.id, summary)
        self.emit("task-done", "%s finished." % task.title, task=task.id,
                  owner=completion.candidate.label, files=sorted(kept),
                  refused=refused, applied=applied)

    async def _ask_specialist(self, task: Task) -> Completion:
        done = [t for t in self.graph.tasks() if t.state is TaskState.DONE]
        context = {}
        for scope in task.scopes:
            if any(ch in scope for ch in "*?["):
                continue
            body = self._store.read(scope)
            if body is not None:
                context[scope] = body
        messages = prompts.task_prompt(task, request=self.config.request,
                                       context_files=context, completed=done)
        return await self._router.complete(messages, role=task.role,
                                           is_cancelled=lambda: self._cancelled)

    def _split_by_scope(self, task: Task, files: Dict[str, str]):
        kept, refused = {}, []
        for path, body in files.items():
            if in_scope(path, task.scopes):
                kept[path] = body
            else:
                refused.append(path)
        return kept, refused

    def _stage(self, task: Task, files: Dict[str, str]) -> bool:
        """Turn a task's files into diffs, and apply them together or not at all."""
        staged = []
        for path, body in sorted(files.items()):
            # Read before proposing, for two reasons: the workspace refuses to
            # describe a change that changes nothing, and rollback needs to
            # know what was there. `None` means the file did not exist, which
            # is how rollback knows to delete rather than restore.
            before = self._store.read(path)
            if before == body:
                self.emit("unchanged", "%s was returned unchanged." % path,
                          task=task.id, path=path)
                continue
            try:
                change = self._store.propose(path, body, "%s: %s" % (task.role, task.title))
            except Exception as exc:                              # noqa: BLE001
                raise RunError("Could not stage %s: %s" % (path, exc)) from exc
            change = dict(change)
            change.update({"task": task.id, "applied": False, "previous": before})
            staged.append(change)

        self.changes.extend(staged)
        if not self.config.apply_changes:
            self.emit("staged", "%d change(s) ready to review." % len(staged),
                      task=task.id)
            return False

        written: List[dict] = []
        for change in staged:
            try:
                self._store.apply(change["id"])
            except Exception as exc:                              # noqa: BLE001
                self._roll_back(written)
                raise RunError(
                    "Applying %s failed (%s). The other %d file(s) from this "
                    "task were put back." % (change.get("path"), exc, len(written))
                ) from exc
            change["applied"] = True
            written.append(change)
        return True

    def _roll_back(self, written: Sequence[dict]) -> None:
        """Undo a partly-applied task, so the reviewer never reads half of one."""
        for change in reversed(written):
            path = change.get("path")
            before = change.get("previous")
            try:
                if before is None:
                    # The task created this file, so putting it back means
                    # removing it. Leaving it behind would show the reviewer a
                    # file from a task that failed.
                    self._store.remove(path, "rollback")
                    self.emit("rolled-back", "Removed %s, which this task created."
                              % path, path=path)
                else:
                    staged = self._store.propose(path, before, "rollback")
                    self._store.apply(staged["id"])
                    self.emit("rolled-back", "Put %s back as it was." % path, path=path)
                change["applied"] = False
            except Exception as exc:                              # noqa: BLE001
                self.emit("rollback-failed",
                          "Could not restore %s: %s" % (path, exc), path=path)

    async def _consolidate(self) -> None:
        """The review pass, and the run's verdict."""
        if self._cancelled:
            self.state = "cancelled"
            return

        tasks = self.graph.tasks()
        failed = [t for t in tasks if t.state in (TaskState.FAILED, TaskState.BLOCKED)]
        reviewer = next((t for t in tasks if t.role == "review"), None)

        touched: Dict[str, str] = {}
        for change in self.changes:
            body = self._store.read(change.get("path", ""))
            if body is not None:
                touched[change["path"]] = body

        self.state = "reviewing"
        self.emit("reviewing", "Reading the finished work.")
        try:
            completion = await self._router.complete(
                prompts.review_prompt(self.config.request, tasks, touched),
                role="review", is_cancelled=lambda: self._cancelled)
            self.review = prompts.parse_review(completion.text)
            self.review["owner"] = completion.candidate.label
        except asyncio.CancelledError:
            raise
        except Exception as exc:                                  # noqa: BLE001
            # A review that did not happen is recorded as not having happened.
            self.review = {"verdict": "unknown", "summary": "",
                           "problems": ["The review could not be run: %s" % exc],
                           "next_steps": [], "owner": None}
            self.emit("review-failed", str(exc))

        if reviewer and reviewer.state is TaskState.READY:
            self.graph.finish(reviewer.id, self.review.get("summary", ""))

        if failed:
            self.state = "failed"
            self.error = "%d of %d tasks did not finish: %s" % (
                len(failed), len(tasks), ", ".join(t.title for t in failed))
        else:
            self.state = "done"
        self.emit("finished", "Run %s." % self.state,
                  verdict=(self.review or {}).get("verdict"),
                  failed=[t.id for t in failed])
