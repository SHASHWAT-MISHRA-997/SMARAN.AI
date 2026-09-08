"""Reading what models actually reply with, rather than what they were asked to.

Every case here is a shape a model really produces: a sentence before the JSON,
a fence around everything, a file fenced again inside its own block. The parser
accommodates presentation and refuses substance it cannot read.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.orchestrator.prompts import (              # noqa: E402
    PlanError, parse_handoff, parse_plan, parse_review, review_prompt, task_prompt,
)
from app.orchestrator.graph import Task             # noqa: E402

PLAN_JSON = ('{"tasks": [{"id": "ui", "title": "Page", "role": "ui", '
             '"instruction": "Build it", "scopes": ["src/**"]}]}')


# ---- the plan ---------------------------------------------------------------

def test_a_clean_plan_is_read():
    assert parse_plan(PLAN_JSON)[0]["title"] == "Page"


def test_a_plan_wrapped_in_a_fence_is_read():
    assert parse_plan("```json\n" + PLAN_JSON + "\n```")[0]["role"] == "ui"


def test_a_plan_introduced_by_a_sentence_is_read():
    reply = "Sure! Here is the plan:\n\n" + PLAN_JSON + "\n\nLet me know."
    assert parse_plan(reply)[0]["id"] == "ui"


def test_a_bare_list_of_tasks_is_read():
    assert parse_plan('{"tasks":' + PLAN_JSON.split('"tasks":')[1])[0]["id"] == "ui"


def test_a_reply_with_no_plan_is_refused():
    with pytest.raises(PlanError, match="no JSON plan"):
        parse_plan("I would start by building the player page.")


def test_broken_json_is_refused_rather_than_guessed_at():
    with pytest.raises(PlanError, match="not valid JSON"):
        parse_plan('{"tasks": [{"title": "Page",}]}')


def test_an_empty_task_list_is_refused():
    with pytest.raises(PlanError, match="listed no tasks"):
        parse_plan('{"tasks": []}')


def test_an_invented_role_is_refused():
    with pytest.raises(PlanError, match="does not exist"):
        parse_plan('{"tasks":[{"title":"X","role":"devops","scopes":["a"]}]}')


def test_a_missing_role_defaults_rather_than_failing():
    assert parse_plan('{"tasks":[{"title":"X","scopes":["a"]}]}')[0]["role"] == "feature"


# ---- the handoff ------------------------------------------------------------

def test_files_and_notes_are_pulled_out():
    result = parse_handoff(
        '<file path="src/a.js">const a = 1;</file>\n'
        '<file path="src/b.js">const b = 2;</file>\n'
        "<notes>Wrote two files.</notes>")
    assert set(result["files"]) == {"src/a.js", "src/b.js"}
    assert result["files"]["src/a.js"] == "const a = 1;\n"
    assert result["notes"] == "Wrote two files."


def test_single_quoted_paths_are_accepted():
    assert "src/a.js" in parse_handoff("<file path='src/a.js'>x</file>")["files"]


def test_a_file_fenced_inside_its_block_is_unwrapped():
    """Models add a fence no matter how the format is described."""
    result = parse_handoff('<file path="a.py">```python\nprint(1)\n```</file>')
    assert result["files"]["a.py"] == "print(1)\n"


def test_content_with_angle_brackets_survives():
    body = "if (a < b && c > d) { return <div>x</div>; }"
    result = parse_handoff('<file path="a.jsx">%s</file>' % body)
    assert result["files"]["a.jsx"].strip() == body


def test_a_repeated_path_keeps_the_last_and_records_it():
    result = parse_handoff('<file path="a.js">first</file><file path="a.js">second</file>')
    assert result["files"]["a.js"] == "second\n"
    assert result["duplicates"] == ["a.js"]


def test_prose_without_files_yields_no_files():
    result = parse_handoff("I would suggest restructuring the whole project.")
    assert result["files"] == {} and result["notes"] == ""


# ---- the review -------------------------------------------------------------

def test_a_verdict_is_read():
    review = parse_review('{"verdict": "pass", "summary": "Fine.", "problems": []}')
    assert review["verdict"] == "pass" and review["summary"] == "Fine."


def test_an_unreadable_review_is_not_a_pass():
    """Silence must never be read as approval."""
    review = parse_review("Looks good to me!")
    assert review["verdict"] == "changes-needed"
    assert "could not be read" in review["problems"][0]


def test_an_invented_verdict_becomes_changes_needed():
    assert parse_review('{"verdict": "excellent"}')["verdict"] == "changes-needed"


# ---- what a specialist is told ----------------------------------------------

def _task(**kw):
    base = dict(id="ui", title="Player", role="ui", instruction="Build the page.",
                scopes=["src/ui/**"], acceptance=["renders at 360px"])
    base.update(kw)
    return Task(**base)


def test_a_specialist_is_told_what_it_owns_and_what_it_must_not_touch():
    other = _task(id="api", title="API", role="backend", scopes=["server/api.py"])
    messages = task_prompt(_task(), request="Build a video site.",
                           context_files={}, completed=[other])
    system = messages[0]["content"]
    assert "src/ui/**" in system
    assert "server/api.py" in system
    assert "OWNED BY OTHERS" in system
    assert "renders at 360px" in system
    assert "<file path=" in system, "the handoff format must be stated"


def test_a_specialist_is_not_told_the_other_tasks_instructions():
    """Knowing what everyone else is building invites building some of it."""
    other = _task(id="api", title="API", role="backend", scopes=["server/api.py"],
                  instruction="Write the recommendation ranking algorithm.")
    messages = task_prompt(_task(), request="Build a video site.", context_files={},
                           completed=[other])
    whole = messages[0]["content"] + messages[1]["content"]
    assert "recommendation ranking algorithm" not in whole


def test_finished_work_is_handed_on_as_notes():
    other = _task(id="api", title="API", role="backend", scopes=["server/api.py"])
    other.output = "The API serves /videos as JSON."
    messages = task_prompt(_task(), request="r", context_files={}, completed=[other])
    assert "The API serves /videos as JSON." in messages[1]["content"]


def test_current_file_contents_are_included_when_they_exist():
    messages = task_prompt(_task(scopes=["src/ui/App.jsx"]), request="r",
                           context_files={"src/ui/App.jsx": "export default 1"},
                           completed=[])
    assert "export default 1" in messages[1]["content"]


def test_the_reviewer_is_shown_failures_honestly():
    from app.orchestrator.graph import TaskState

    broken = _task(id="api", title="API", role="backend", scopes=["server/api.py"])
    broken.state = TaskState.FAILED
    broken.error = "provider refused"
    messages = review_prompt("r", [broken], {})
    assert "failed" in messages[1]["content"]
    assert "provider refused" in messages[1]["content"]
