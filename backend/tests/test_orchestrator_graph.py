"""The task graph, and the duplicate work it exists to prevent."""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.orchestrator.graph import (       # noqa: E402
    GraphError, Task, TaskGraph, TaskState, any_scopes_conflict, build_graph,
    normalise_scope, scopes_conflict,
)


def task(task_id, *, role="feature", scopes=("src/%s.js",), depends_on=()):
    return Task(id=task_id, title=task_id, role=role,
                instruction="do " + task_id,
                scopes=[s % task_id if "%s" in s else s for s in scopes],
                depends_on=list(depends_on))


# ---- scope claims -----------------------------------------------------------

@pytest.mark.parametrize("left,right", [
    ("src/App.jsx", "src/App.jsx"),                 # the same file
    ("src/ui/**", "src/ui/App.jsx"),                # a directory and a file in it
    ("src/*", "src/ui/App.jsx"),                    # one wildcard, reaching down
    ("src/ui", "src/ui/nested/deep/File.js"),       # a bare directory
    ("**", "anything/at/all.py"),                   # the whole tree
    ("src/./ui/", "src/ui"),                        # different spellings
    ("src\\ui\\App.jsx", "src/ui/App.jsx"),         # a Windows path from a model
])
def test_overlapping_claims_are_caught(left, right):
    assert scopes_conflict(left, right)
    assert scopes_conflict(right, left), "conflict must not depend on order"


@pytest.mark.parametrize("left,right", [
    ("src/ui/App.jsx", "src/api/routes.py"),
    ("frontend/**", "backend/**"),
    ("src/ui/Player.jsx", "src/ui/Sidebar.jsx"),
])
def test_separate_claims_are_allowed(left, right):
    assert not scopes_conflict(left, right)


def test_an_unstated_claim_conflicts_with_everything():
    """An empty scope is not a narrow one, and must not slip past the check."""
    assert scopes_conflict("", "src/App.jsx")
    assert scopes_conflict("src/App.jsx", "")


def test_normalise_collapses_spellings():
    assert normalise_scope("./src/ui/") == "src/ui"
    assert normalise_scope("src\\ui\\App.jsx") == "src/ui/App.jsx"
    assert normalise_scope(".") == "**"


def test_conflicting_pair_is_reported_so_it_can_be_explained():
    pair = any_scopes_conflict(["a/x.js", "src/ui/**"], ["b/y.js", "src/ui/App.jsx"])
    assert pair == ("src/ui/**", "src/ui/App.jsx")
    assert any_scopes_conflict(["a/x.js"], ["b/y.js"]) is None


# ---- the registry -----------------------------------------------------------

def test_one_task_is_handed_to_one_owner():
    graph = TaskGraph([task("a"), task("b")])
    first = graph.claim("model-1")
    second = graph.claim("model-2")
    assert {first.id, second.id} == {"a", "b"}
    assert first.id != second.id
    assert graph.claim("model-3") is None


def test_two_tasks_claiming_one_file_never_run_together():
    """The whole point: overlapping writers are serialised, not refused."""
    graph = TaskGraph([
        Task(id="ui", title="Player page", role="ui", instruction="",
             scopes=["src/ui/**"]),
        Task(id="feat", title="Controls", role="feature", instruction="",
             scopes=["src/ui/Controls.jsx"]),
    ])
    first = graph.claim("model-1")
    assert graph.claim("model-2") is None, "the overlapping task must wait"

    held = graph.blocked_by("feat" if first.id == "ui" else "ui")
    assert held["task"] == first.id

    graph.finish(first.id, "done")
    second = graph.claim("model-2")
    assert second is not None and second.id != first.id


def test_dependencies_gate_readiness():
    graph = TaskGraph([task("base"), task("after", depends_on=["base"])])
    assert graph.claim("m") .id == "base"
    assert graph.claim("m") is None
    graph.finish("base", "ok")
    assert graph.claim("m").id == "after"


def test_a_failed_dependency_blocks_what_needed_it():
    graph = TaskGraph([task("base"), task("after", depends_on=["base"])])
    graph.claim("m")
    graph.fail("base", "provider refused")
    assert graph.get("after").state is TaskState.BLOCKED
    assert graph.claim("m") is None
    assert graph.done()


def test_retry_returns_a_task_to_the_pool():
    graph = TaskGraph([task("a")])
    graph.claim("m")
    graph.fail("a", "busy", retry=True)
    assert graph.get("a").state is TaskState.READY
    again = graph.claim("m")
    assert again.id == "a" and again.attempts == 2


def test_cancelling_stops_new_work_and_keeps_finished_work():
    graph = TaskGraph([task("a"), task("b"), task("c")])
    graph.claim("m")
    graph.finish("a", "kept")
    stopped = graph.cancel("User stopped the run.")
    assert stopped == 2
    assert graph.get("a").state is TaskState.DONE
    assert graph.get("a").output == "kept"
    assert graph.get("b").state is TaskState.CANCELLED
    assert graph.claim("m") is None
    assert graph.cancelled and graph.done()


def test_retry_after_cancellation_does_not_restart_the_run():
    graph = TaskGraph([task("a")])
    graph.claim("m")
    graph.cancel()
    graph.fail("a", "busy", retry=True)
    assert graph.get("a").state is TaskState.FAILED
    assert graph.claim("m") is None


# ---- refusing graphs that cannot run ----------------------------------------

def test_a_dependency_loop_is_refused():
    with pytest.raises(GraphError, match="loop"):
        TaskGraph([task("a", depends_on=["b"]), task("b", depends_on=["a"])])


def test_a_missing_dependency_is_refused():
    with pytest.raises(GraphError, match="does not exist"):
        TaskGraph([task("a", depends_on=["ghost"])])


def test_duplicate_ids_are_refused():
    with pytest.raises(GraphError, match="share the id"):
        TaskGraph([task("a"), task("a")])


def test_a_writing_task_must_claim_something():
    with pytest.raises(GraphError, match="claims no files"):
        TaskGraph([Task(id="a", title="a", role="feature", instruction="", scopes=[])])


def test_a_reviewer_may_claim_nothing_because_it_writes_nothing():
    graph = TaskGraph([Task(id="r", title="review", role="review",
                            instruction="", scopes=[])])
    assert graph.claim("m").id == "r"


def test_an_unknown_role_is_refused():
    with pytest.raises(GraphError, match="not one of"):
        TaskGraph([task("a", role="devops")])


# ---- building from a model's plan -------------------------------------------

def test_build_graph_fills_ids_and_normalises_scopes():
    graph = build_graph([
        {"title": "Player", "role": "ui", "scopes": ["./src/ui/"]},
        {"title": "API", "role": "backend", "scopes": ["server\\api.py"]},
    ])
    scopes = sorted(s for t in graph.tasks() for s in t.scopes)
    assert scopes == ["server/api.py", "src/ui"]
    assert all(t.id for t in graph.tasks())


def test_build_graph_refuses_an_empty_plan():
    with pytest.raises(GraphError, match="no tasks"):
        build_graph([])


def test_build_graph_refuses_a_task_with_no_title():
    with pytest.raises(GraphError, match="no title"):
        build_graph([{"role": "ui", "scopes": ["a.js"]}])
