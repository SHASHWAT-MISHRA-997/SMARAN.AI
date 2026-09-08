"""The task graph: who is doing what, and who is not allowed to.

A director that splits a project across several models has one failure mode
that matters more than the rest. Two specialists are told to "build the player
page" and "add the video controls", both decide App.jsx is theirs, and the
second one to finish silently overwrites the first. Nothing errors. The run
reports success and half the work is gone.

So a task here does not merely have an instruction, it has a *claim*: the file
patterns it is allowed to write. Two tasks whose claims overlap never run at
the same time, and the check is deliberately pessimistic - when it cannot tell
whether two patterns can match the same file, it says they can. Serialising
two tasks that would have been fine costs a little time. Letting two writers
into one file costs the work.

Note the module name. `app.director` is already taken, by the one that turns a
script into a video; this is the multi-agent one.
"""

from __future__ import annotations

import fnmatch
import itertools
import posixpath
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Iterable, List, Optional, Sequence


class TaskState(str, Enum):
    """Where a task is. Strings so they survive JSON without translation."""

    PENDING = "pending"      # dependencies not finished yet
    READY = "ready"          # could be claimed now
    RUNNING = "running"      # a specialist holds it
    DONE = "done"
    FAILED = "failed"        # tried, and ran out of attempts
    BLOCKED = "blocked"      # a dependency failed, so this can never start
    CANCELLED = "cancelled"


#: States a task will never leave.
TERMINAL = {TaskState.DONE, TaskState.FAILED, TaskState.BLOCKED, TaskState.CANCELLED}

#: The roles the director assigns. Kept as a closed set because the prompts
#: differ per role, and a model that invents "devops" would otherwise get a
#: task with no instructions attached to it.
ROLES = ("ui", "feature", "backend", "review")

_WILDCARDS = "*?["


def normalise_scope(pattern: str) -> str:
    """One spelling for a claim, so two spellings of one path collide.

    Backslashes become forward slashes because half the claims will come from
    a model that has seen Windows paths, and "./" and trailing slashes are
    noise that would otherwise make `src/ui` and `./src/ui/` look unrelated.
    """
    text = (pattern or "").strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    text = posixpath.normpath(text) if text else ""
    if text in (".", "/"):
        return "**"
    return text.strip("/")


def _static_prefix(pattern: str) -> str:
    """The directory part of a pattern that contains no wildcard.

    `src/ui/**/*.jsx` claims everything under `src/ui`, and that is the part
    worth comparing against another claim.
    """
    cut = len(pattern)
    for index, char in enumerate(pattern):
        if char in _WILDCARDS:
            cut = index
            break
    head = pattern[:cut]
    if cut < len(pattern):
        head = head.rsplit("/", 1)[0] if "/" in head else ""
    return head.strip("/")


def _within(inner: str, outer: str) -> bool:
    """True if `inner` is `outer` or sits underneath it."""
    if not outer:
        return True
    return inner == outer or inner.startswith(outer + "/")


def scopes_conflict(first: str, second: str) -> bool:
    """Can these two claims name the same file?

    Answered conservatively. `fnmatch` is used in both directions and its `*`
    happily crosses a path separator, which is usually described as a flaw and
    is exactly the pessimism wanted here: `src/*` is treated as reaching
    `src/ui/App.jsx`, so the two are kept apart.
    """
    left, right = normalise_scope(first), normalise_scope(second)
    if not left or not right:
        # An empty claim is not a narrow claim, it is an unstated one.
        return True
    if left == right:
        return True
    if fnmatch.fnmatchcase(left, right) or fnmatch.fnmatchcase(right, left):
        return True

    head_left, head_right = _static_prefix(left), _static_prefix(right)
    return _within(head_left, head_right) or _within(head_right, head_left)


def any_scopes_conflict(first: Sequence[str], second: Sequence[str]) -> Optional[tuple]:
    """The first overlapping pair, or None. Returned so it can be explained."""
    for left, right in itertools.product(first or (), second or ()):
        if scopes_conflict(left, right):
            return (left, right)
    return None


@dataclass
class Task:
    """One unit of work, owned by exactly one specialist at a time."""

    id: str
    title: str
    role: str
    instruction: str
    #: File patterns this task may write. Nothing outside them is applied.
    scopes: List[str] = field(default_factory=list)
    depends_on: List[str] = field(default_factory=list)
    acceptance: List[str] = field(default_factory=list)
    state: TaskState = TaskState.PENDING
    #: Which provider/model actually took it, filled when claimed. The UI shows
    #: this so "which model is doing what" is answerable at a glance.
    owner: Optional[str] = None
    attempts: int = 0
    error: Optional[str] = None
    output: Optional[str] = None
    #: Why the run ended up on this provider rather than the preferred one.
    fallback_reason: Optional[str] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "role": self.role,
            "instruction": self.instruction,
            "scopes": list(self.scopes),
            "depends_on": list(self.depends_on),
            "acceptance": list(self.acceptance),
            "state": self.state.value,
            "owner": self.owner,
            "attempts": self.attempts,
            "error": self.error,
            "output": self.output,
            "fallback_reason": self.fallback_reason,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration": (
                round(self.finished_at - self.started_at, 2)
                if self.started_at and self.finished_at else None
            ),
        }


class GraphError(ValueError):
    """A graph that cannot be run, described in the words of the problem."""


class TaskGraph:
    """The shared registry. Every claim and release goes through here.

    Guarded by a lock because tasks are executed concurrently: without one,
    two workers can both read the same task as READY and both claim it, which
    is the duplicate work this class exists to prevent.
    """

    def __init__(self, tasks: Iterable[Task]) -> None:
        self._lock = threading.RLock()
        self._tasks: Dict[str, Task] = {}
        for task in tasks:
            if task.id in self._tasks:
                raise GraphError("Two tasks share the id %r." % task.id)
            self._tasks[task.id] = task
        self._validate()
        self._cancelled = False
        self._refresh()

    # ---- construction checks ------------------------------------------------

    def _validate(self) -> None:
        for task in self._tasks.values():
            if task.role not in ROLES:
                raise GraphError(
                    "Task %r has role %r, which is not one of %s."
                    % (task.id, task.role, ", ".join(ROLES)))
            for need in task.depends_on:
                if need == task.id:
                    raise GraphError("Task %r depends on itself." % task.id)
                if need not in self._tasks:
                    raise GraphError(
                        "Task %r depends on %r, which does not exist."
                        % (task.id, need))
            if not task.scopes and task.role != "review":
                # A reviewer reads everything and writes nothing, so it is the
                # one role allowed to claim no files.
                raise GraphError(
                    "Task %r claims no files, so nothing it writes could be "
                    "applied." % task.id)
        self._reject_cycles()

    def _reject_cycles(self) -> None:
        """A cycle would leave every task in it PENDING forever."""
        colour: Dict[str, int] = {}

        def visit(node: str, trail: List[str]) -> None:
            state = colour.get(node, 0)
            if state == 1:
                loop = trail[trail.index(node):] + [node]
                raise GraphError("These tasks depend on each other in a loop: "
                                 + " -> ".join(loop))
            if state == 2:
                return
            colour[node] = 1
            for need in self._tasks[node].depends_on:
                visit(need, trail + [node])
            colour[node] = 2

        for task_id in self._tasks:
            visit(task_id, [])

    # ---- state --------------------------------------------------------------

    def _refresh(self) -> None:
        """Move PENDING tasks to READY or BLOCKED as their dependencies settle."""
        for task in self._tasks.values():
            if task.state not in (TaskState.PENDING, TaskState.READY):
                continue
            needs = [self._tasks[n] for n in task.depends_on]
            if any(n.state in (TaskState.FAILED, TaskState.BLOCKED,
                               TaskState.CANCELLED) for n in needs):
                task.state = TaskState.BLOCKED
                task.error = task.error or (
                    "Not started: a task it depends on did not finish.")
            elif all(n.state is TaskState.DONE for n in needs):
                task.state = TaskState.READY
            else:
                task.state = TaskState.PENDING

    def _running(self) -> List[Task]:
        return [t for t in self._tasks.values() if t.state is TaskState.RUNNING]

    # ---- the registry -------------------------------------------------------

    def claim(self, owner: str) -> Optional[Task]:
        """Take one runnable task, or None if nothing can start right now.

        None does not mean finished - it also means "everything left overlaps
        with something in flight". Callers tell the two apart with `done()`.
        """
        with self._lock:
            if self._cancelled:
                return None
            self._refresh()
            running = self._running()
            for task in self._tasks.values():
                if task.state is not TaskState.READY:
                    continue
                if any(any_scopes_conflict(task.scopes, other.scopes)
                       for other in running):
                    # Held back rather than refused: it becomes claimable the
                    # moment the task holding those files finishes.
                    continue
                task.state = TaskState.RUNNING
                task.owner = owner
                task.attempts += 1
                task.started_at = time.time()
                return task
            return None

    def blocked_by(self, task_id: str) -> Optional[dict]:
        """Which running task's claim is keeping this one waiting."""
        with self._lock:
            task = self._tasks[task_id]
            for other in self._running():
                pair = any_scopes_conflict(task.scopes, other.scopes)
                if pair:
                    return {"task": other.id, "title": other.title,
                            "scopes": list(pair)}
            return None

    def finish(self, task_id: str, output: str) -> None:
        with self._lock:
            task = self._tasks[task_id]
            task.state = TaskState.DONE
            task.output = output
            task.error = None
            task.finished_at = time.time()
            self._refresh()

    def fail(self, task_id: str, error: str, retry: bool = False) -> None:
        """Mark a task failed, or put it back for another attempt."""
        with self._lock:
            task = self._tasks[task_id]
            task.error = error
            if retry and not self._cancelled:
                task.state = TaskState.READY
                task.owner = None
                task.started_at = None
                return
            task.state = TaskState.FAILED
            task.finished_at = time.time()
            self._refresh()

    def cancel(self, reason: str = "Cancelled.") -> int:
        """Stop the run. Finished work is kept; nothing new starts.

        Tasks already running are left RUNNING - this cannot reach into
        another thread's HTTP call - but their results are refused on the way
        back in, and no further task is handed out.
        """
        with self._lock:
            self._cancelled = True
            stopped = 0
            for task in self._tasks.values():
                if task.state in (TaskState.PENDING, TaskState.READY):
                    task.state = TaskState.CANCELLED
                    task.error = reason
                    task.finished_at = time.time()
                    stopped += 1
            return stopped

    @property
    def cancelled(self) -> bool:
        with self._lock:
            return self._cancelled

    def done(self) -> bool:
        """True when nothing is left that could still run."""
        with self._lock:
            self._refresh()
            return all(t.state in TERMINAL for t in self._tasks.values())

    def stalled(self) -> bool:
        """Nothing running, nothing claimable, and work still outstanding.

        Should be unreachable: a READY task with no running task to conflict
        with is always claimable. It is checked anyway, because the
        alternative to noticing a stall is a scheduler loop that spins.
        """
        with self._lock:
            self._refresh()
            if self._running():
                return False
            return any(t.state is TaskState.READY for t in self._tasks.values()) is False \
                and any(t.state is TaskState.PENDING for t in self._tasks.values())

    # ---- reading ------------------------------------------------------------

    def get(self, task_id: str) -> Task:
        with self._lock:
            return self._tasks[task_id]

    def tasks(self) -> List[Task]:
        with self._lock:
            return list(self._tasks.values())

    def as_dict(self) -> dict:
        with self._lock:
            self._refresh()
            counts: Dict[str, int] = {}
            for task in self._tasks.values():
                counts[task.state.value] = counts.get(task.state.value, 0) + 1
            return {
                "tasks": [t.as_dict() for t in self._tasks.values()],
                "counts": counts,
                "cancelled": self._cancelled,
                "done": all(t.state in TERMINAL for t in self._tasks.values()),
            }


def build_graph(specification: Sequence[dict]) -> TaskGraph:
    """Turn decoded task descriptions into a graph, or say why they will not.

    The descriptions usually come from a language model, so nothing here
    trusts them: ids are regenerated if missing, unknown fields are dropped,
    and anything structurally impossible raises rather than being repaired
    into something that runs but is not what was asked for.
    """
    if not specification:
        raise GraphError("The plan contains no tasks.")

    tasks: List[Task] = []
    for index, raw in enumerate(specification):
        if not isinstance(raw, dict):
            raise GraphError("Task %d is not an object." % (index + 1))
        title = str(raw.get("title") or "").strip()
        if not title:
            raise GraphError("Task %d has no title." % (index + 1))
        scopes = [normalise_scope(s) for s in (raw.get("scopes") or []) if str(s).strip()]
        tasks.append(Task(
            id=str(raw.get("id") or "").strip() or "t%d-%s" % (index + 1, uuid.uuid4().hex[:6]),
            title=title,
            role=str(raw.get("role") or "feature").strip().lower(),
            instruction=str(raw.get("instruction") or title).strip(),
            scopes=scopes,
            depends_on=[str(d).strip() for d in (raw.get("depends_on") or []) if str(d).strip()],
            acceptance=[str(a).strip() for a in (raw.get("acceptance") or []) if str(a).strip()],
        ))

    graph = TaskGraph(tasks)
    return graph
