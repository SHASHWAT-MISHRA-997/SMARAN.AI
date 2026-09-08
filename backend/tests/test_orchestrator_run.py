"""The Director end to end, against deterministic local doubles.

No provider is contacted here and none of these results say anything about how
a real model behaves. What they test is the machinery around it: the plan
being read, the work being split, a specialist that writes outside its claim
being refused, a half-applied task being put back, and a cancelled run
stopping.
"""

import asyncio
import json
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.orchestrator import prompts                                   # noqa: E402
from app.orchestrator.graph import TaskState                           # noqa: E402
from app.orchestrator.routing import Candidate, Router                 # noqa: E402
from app.orchestrator.run import FileStore, Run, RunConfig, in_scope    # noqa: E402

LOCAL = Candidate(provider="", model="test-double", capabilities=["code", "reasoning"])

PLAN = {"tasks": [
    {"id": "ui", "title": "Player page", "role": "ui",
     "instruction": "Build the page.", "scopes": ["src/ui/**"],
     "acceptance": ["renders at 360px"]},
    {"id": "api", "title": "Video API", "role": "backend",
     "instruction": "Serve the list.", "scopes": ["server/api.py"]},
    {"id": "check", "title": "Review", "role": "review",
     "instruction": "Check it.", "scopes": [], "depends_on": ["ui", "api"]},
]}

REVIEW = {"verdict": "pass", "summary": "A player page and an API.",
          "problems": [], "next_steps": []}


class MemoryStore(FileStore):
    """A workspace in a dict, with the same refusals as the real one."""

    def __init__(self, files=None):
        self.files = dict(files or {})
        self._pending = {}
        self.apply_fails_for = set()
        self.applied = []

    def read(self, path):
        return self.files.get(path)

    def propose(self, path, content, summary=""):
        change_id = "c%d" % (len(self._pending) + 1)
        self._pending[change_id] = (path, content)
        return {"id": change_id, "path": path, "summary": summary,
                "diff": "--- a/%s\n+++ b/%s\n" % (path, path)}

    def apply(self, change_id):
        path, content = self._pending[change_id]
        if path in self.apply_fails_for:
            raise RuntimeError("%s is locked by another process" % path)
        self.files[path] = content
        self.applied.append(path)

    def remove(self, path, summary=""):
        self.files.pop(path, None)

    def listing(self):
        return sorted(self.files)


def handoff(**files):
    body = "".join('<file path="%s">\n%s\n</file>\n' % (p, c) for p, c in files.items())
    return body + "<notes>Done.</notes>"


class Double:
    """A scripted stand-in for every model in the run."""

    def __init__(self, *, plan=None, review=None, replies=None, fail_on=None):
        self.plan = json.dumps(plan if plan is not None else PLAN)
        self.review = json.dumps(review if review is not None else REVIEW)
        self.replies = replies or {}
        self.fail_on = fail_on or {}
        self.seen = []

    async def __call__(self, messages, candidate, timeout):
        system = messages[0]["content"]
        user = messages[1]["content"] if len(messages) > 1 else ""
        if prompts.DECOMPOSE_SYSTEM[:40] in system:
            self.seen.append("plan")
            return self.plan
        if "You are the reviewer" in system:
            self.seen.append("review")
            return self.review
        for title, reply in self.replies.items():
            if title in user:
                self.seen.append(title)
                if title in self.fail_on:
                    raise self.fail_on[title]
                return reply
        self.seen.append("unmatched")
        return handoff()


async def no_sleep(_seconds):
    return None


def make_run(double, store=None, **config):
    store = store if store is not None else MemoryStore()
    router = Router([LOCAL], call=double, sleep=no_sleep)
    settings = {"request": "Build a small video site.", "candidates": [LOCAL]}
    settings.update(config)
    return Run(RunConfig(**settings), store=store, router=router), store


# ---- scope enforcement ------------------------------------------------------

@pytest.mark.parametrize("path,scopes,allowed", [
    ("src/ui/Player.jsx", ["src/ui/**"], True),
    ("src/ui/deep/nested/Thing.jsx", ["src/ui/**"], True),
    ("server/api.py", ["src/ui/**"], False),
    ("server/api.py", ["server/api.py"], True),
    ("src/main.jsx", ["src/ui/**"], False),
])
def test_in_scope_matches_the_scheduler(path, scopes, allowed):
    assert in_scope(path, scopes) is allowed


# ---- a run that works -------------------------------------------------------

def test_a_whole_run_plans_works_and_reviews():
    double = Double(replies={
        "Build the page.": handoff(**{"src/ui/Player.jsx": "export default 1"}),
        "Serve the list.": handoff(**{"server/api.py": "print('api')"}),
    })
    run, store = make_run(double)
    result = asyncio.run(run.start())

    assert result["state"] == "done", result["error"]
    assert store.files["src/ui/Player.jsx"] == "export default 1\n"
    assert store.files["server/api.py"] == "print('api')\n"
    assert result["review"]["verdict"] == "pass"
    assert "plan" in double.seen and "review" in double.seen
    assert all(t["state"] == "done" for t in result["graph"]["tasks"])


def test_the_owner_of_each_task_is_recorded():
    """"Which model did what" has to be answerable afterwards."""
    run, _ = make_run(Double(replies={
        "Build the page.": handoff(**{"src/ui/Player.jsx": "a"}),
        "Serve the list.": handoff(**{"server/api.py": "b"}),
    }))
    result = asyncio.run(run.start())
    done = [t for t in result["graph"]["tasks"] if t["state"] == "done"]
    assert all(t["owner"] for t in done)


def test_nothing_is_applied_when_the_run_only_stages():
    run, store = make_run(Double(replies={
        "Build the page.": handoff(**{"src/ui/Player.jsx": "a"}),
        "Serve the list.": handoff(**{"server/api.py": "b"}),
    }), apply_changes=False)
    result = asyncio.run(run.start())
    assert store.files == {}
    assert len(result["changes"]) == 2
    assert all(not c["applied"] for c in result["changes"])


# ---- the claim is enforced on the way back in -------------------------------

def test_a_specialist_writing_outside_its_claim_is_refused():
    """Otherwise the scopes are a suggestion and the collision returns."""
    run, store = make_run(Double(replies={
        "Build the page.": handoff(**{
            "src/ui/Player.jsx": "mine",
            "server/api.py": "not mine",         # claimed by the backend task
        }),
        "Serve the list.": handoff(**{"server/api.py": "the real api"}),
    }))
    result = asyncio.run(run.start())

    assert store.files["server/api.py"] == "the real api\n", \
        "the ui task must not have overwritten the backend task's file"
    assert store.files["src/ui/Player.jsx"] == "mine\n"
    refused = [e for e in result["events"] if e["kind"] == "out-of-scope"]
    assert len(refused) == 1 and refused[0]["path"] == "server/api.py"


def test_a_task_that_only_writes_out_of_scope_files_fails():
    run, _ = make_run(Double(replies={
        "Build the page.": '<file path="server/api.py">nope</file>',
        "Serve the list.": handoff(**{"server/api.py": "ok"}),
    }))
    result = asyncio.run(run.start())
    ui = next(t for t in result["graph"]["tasks"] if t["id"] == "ui")
    assert ui["state"] == "failed"
    assert result["state"] == "failed"


# ---- failure, rollback, recovery --------------------------------------------

def test_a_half_applied_task_is_put_back():
    """The second file cannot be written, so the first is undone."""
    store = MemoryStore({"src/ui/Player.jsx": "original"})
    store.apply_fails_for = {"src/ui/Second.jsx"}
    plan = {"tasks": [
        {"id": "ui", "title": "Two files", "role": "ui", "instruction": "Write both.",
         "scopes": ["src/ui/**"]},
        {"id": "check", "title": "Review", "role": "review", "instruction": "Check.",
         "scopes": [], "depends_on": ["ui"]},
    ]}
    run, store = make_run(Double(plan=plan, replies={
        "Write both.": handoff(**{"src/ui/Player.jsx": "changed",
                                  "src/ui/Second.jsx": "new"}),
    }), store=store)
    result = asyncio.run(run.start())

    assert store.files["src/ui/Player.jsx"] == "original", "the applied file was not put back"
    assert "src/ui/Second.jsx" not in store.files
    assert any(e["kind"] == "rolled-back" for e in result["events"])
    assert result["state"] == "failed"


def test_a_created_file_is_removed_when_its_task_rolls_back():
    store = MemoryStore()
    store.apply_fails_for = {"src/ui/B.jsx"}
    plan = {"tasks": [
        {"id": "ui", "title": "Two new", "role": "ui", "instruction": "Write both.",
         "scopes": ["src/ui/**"]},
        {"id": "check", "title": "Review", "role": "review", "instruction": "Check.",
         "scopes": [], "depends_on": ["ui"]},
    ]}
    run, store = make_run(Double(plan=plan, replies={
        "Write both.": handoff(**{"src/ui/A.jsx": "a", "src/ui/B.jsx": "b"}),
    }), store=store)
    asyncio.run(run.start())
    assert store.files == {}, "a file created by a failed task must not survive"


def test_a_file_returned_unchanged_is_not_an_error():
    """The workspace refuses a no-op change; that must not fail the task."""
    store = MemoryStore({"src/ui/Player.jsx": "same\n"})
    run, store = make_run(Double(replies={
        "Build the page.": handoff(**{"src/ui/Player.jsx": "same"}),
        "Serve the list.": handoff(**{"server/api.py": "api"}),
    }), store=store)
    result = asyncio.run(run.start())
    assert result["state"] == "done", result["error"]
    assert any(e["kind"] == "unchanged" for e in result["events"])


def test_a_failed_task_blocks_the_review_and_the_run_says_so():
    """A task whose provider keeps failing is not retried a second time here.

    The router has already tried it three times and marked it unhealthy, so a
    retry at this level would only reach a provider that has been ruled out.
    The bound lives in one place rather than multiplying across two.
    """
    double = Double(
        replies={"Build the page.": handoff(**{"src/ui/Player.jsx": "a"}),
                 "Serve the list.": handoff(**{"server/api.py": "b"})},
        fail_on={"Serve the list.": RuntimeError("engine died")})
    run, _ = make_run(double)
    result = asyncio.run(run.start())

    api = next(t for t in result["graph"]["tasks"] if t["id"] == "api")
    assert api["state"] == "failed"
    assert api["attempts"] == 1
    assert double.seen.count("Serve the list.") == 3, "bounded router retries"
    assert result["state"] == "failed"
    assert "Video API" in result["error"]
    check = next(t for t in result["graph"]["tasks"] if t["id"] == "check")
    assert check["state"] == "blocked", "the review cannot run on a broken result"


# ---- plans that cannot be run -----------------------------------------------

def test_an_unreadable_plan_stops_the_run_with_a_reason():
    run, store = make_run(Double(plan="not json at all"))
    run._router = Router([LOCAL], call=lambda *a: _reply("hello, no plan here"),
                         sleep=no_sleep)
    result = asyncio.run(run.start())
    assert result["state"] == "failed"
    assert "no JSON plan" in result["error"]
    assert store.files == {}


def test_a_plan_whose_tasks_overlap_is_still_scheduled_safely():
    """Two claims on one file: allowed to be planned, never run together."""
    plan = {"tasks": [
        {"id": "a", "title": "First", "role": "ui", "instruction": "Do A.",
         "scopes": ["src/ui/**"]},
        {"id": "b", "title": "Second", "role": "feature", "instruction": "Do B.",
         "scopes": ["src/ui/Player.jsx"]},
        {"id": "check", "title": "Review", "role": "review", "instruction": "Check.",
         "scopes": [], "depends_on": ["a", "b"]},
    ]}
    run, store = make_run(Double(plan=plan, replies={
        "Do A.": handoff(**{"src/ui/A.jsx": "a"}),
        "Do B.": handoff(**{"src/ui/Player.jsx": "b"}),
    }), concurrency=4)
    result = asyncio.run(run.start())
    assert result["state"] == "done", result["error"]
    assert store.files["src/ui/A.jsx"] == "a\n"
    assert store.files["src/ui/Player.jsx"] == "b\n"


def test_a_plan_with_a_dependency_loop_is_refused():
    plan = {"tasks": [
        {"id": "a", "title": "A", "role": "ui", "instruction": "A", "scopes": ["a"],
         "depends_on": ["b"]},
        {"id": "b", "title": "B", "role": "ui", "instruction": "B", "scopes": ["b"],
         "depends_on": ["a"]},
    ]}
    run, _ = make_run(Double(plan=plan))
    result = asyncio.run(run.start())
    assert result["state"] == "failed"
    assert "loop" in result["error"]


# ---- cancellation -----------------------------------------------------------

def test_cancelling_mid_run_stops_the_remaining_work():
    holder = {}

    async def cancel_after_first(messages, candidate, timeout):
        system = messages[0]["content"]
        if prompts.DECOMPOSE_SYSTEM[:40] in system:
            return json.dumps(PLAN)
        if "You are the reviewer" in system:
            return json.dumps(REVIEW)
        holder["run"].cancel("Stopped by the user.")
        return handoff(**{"src/ui/Player.jsx": "a"})

    run, store = make_run(cancel_after_first, concurrency=1)
    holder["run"] = run
    result = asyncio.run(run.start())

    assert result["state"] == "cancelled"
    states = {t["id"]: t["state"] for t in result["graph"]["tasks"]}
    assert TaskState.CANCELLED.value in states.values()
    assert any(e["kind"] == "cancelled" for e in result["events"])


def test_a_cancelled_run_does_not_review():
    holder = {}

    async def cancel_immediately(messages, candidate, timeout):
        if prompts.DECOMPOSE_SYSTEM[:40] in messages[0]["content"]:
            holder["run"].cancel()
            return json.dumps(PLAN)
        raise AssertionError("nothing should be asked after cancellation")

    run, _ = make_run(cancel_immediately)
    holder["run"] = run
    result = asyncio.run(run.start())
    assert result["state"] == "cancelled"
    assert result["review"] is None


# ---- what the run reports ---------------------------------------------------

def test_a_review_that_cannot_be_run_is_not_reported_as_a_pass():
    double = Double(replies={
        "Build the page.": handoff(**{"src/ui/Player.jsx": "a"}),
        "Serve the list.": handoff(**{"server/api.py": "b"}),
    })

    async def failing_review(messages, candidate, timeout):
        if "You are the reviewer" in messages[0]["content"]:
            raise RuntimeError("reviewer unreachable")
        return await double(messages, candidate, timeout)

    run, _ = make_run(failing_review)
    result = asyncio.run(run.start())
    assert result["review"]["verdict"] == "unknown"
    assert "could not be run" in result["review"]["problems"][0]


def test_a_snapshot_never_carries_an_api_key():
    keyed = Candidate(provider="openai", model="gpt-4o", api_key="sk-live-secret")
    run, _ = make_run(Double(), candidates=[LOCAL, keyed], allow_paid=True)
    asyncio.run(run.start())
    assert "sk-live-secret" not in json.dumps(run.snapshot())


def _reply(text):
    async def call(*_args, **_kwargs):
        return text
    return call()
