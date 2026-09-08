"""Everything said to a model, and everything read back from one.

Kept in one place because the two halves have to agree. A prompt that asks for
files in one shape and a parser that expects another produces a task that
"succeeded" and wrote nothing, which is the failure this module is arranged to
make impossible to introduce quietly: the format is described once, in
HANDOFF_FORMAT, and both the instruction and the parser are built from it.
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional, Sequence

from .graph import ROLES, Task

#: The shape a specialist replies in. Angle brackets rather than JSON because
#: source code is full of quotes and newlines, and a model that has to escape
#: an entire file into a JSON string gets it wrong often enough to matter.
HANDOFF_FORMAT = """\
Reply with the complete contents of every file you are changing, like this:

<file path="src/ui/Player.jsx">
...the entire file, not a fragment and not a diff...
</file>

<notes>
One short paragraph: what you did, and anything the reviewer should check.
</notes>

Rules for the reply:
- Give the whole file. A partial file overwrites the rest with nothing.
- One <file> block per file. Do not repeat a path.
- Write only the files listed under YOUR FILES. Anything else is discarded.
- No prose outside the blocks."""

_FILE_BLOCK = re.compile(
    r"<file\s+path=[\"']([^\"'>]+)[\"']\s*>\n?(.*?)</file\s*>",
    re.IGNORECASE | re.DOTALL)
_NOTES_BLOCK = re.compile(r"<notes\s*>(.*?)</notes\s*>", re.IGNORECASE | re.DOTALL)

#: A fenced block a model wrapped its whole answer in, which several of them
#: do no matter how the format is described.
_OUTER_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\n(.*)\n```\s*$", re.DOTALL)


DECOMPOSE_SYSTEM = """\
You are the Director of a team of AI specialists working on one project.

Split the request into tasks that different specialists can do at the same
time without touching each other's files. This is the part that matters: two
specialists editing one file will silently overwrite each other, so every task
must claim the files it alone will write.

Available roles:
  ui        layout, components, styling, markup
  feature   application behaviour that spans the interface and the data
  backend   servers, APIs, storage, build and tooling
  review    reads everything and writes nothing; there is exactly one, and it
            depends on every other task

Reply with JSON only - no prose, no code fence - shaped like this:

{"tasks": [
  {"id": "ui-player",
   "title": "Player page and layout",
   "role": "ui",
   "instruction": "What to build, in enough detail to act on alone.",
   "scopes": ["src/ui/**", "src/styles/player.css"],
   "depends_on": [],
   "acceptance": ["The page renders at 360px wide", "No inline styles"]}
]}

Requirements:
- Between 2 and 8 tasks, plus exactly one review task depending on all others.
- scopes are file paths or glob patterns, relative to the project root. Two
  tasks must never claim paths that can match the same file.
- depends_on holds ids of tasks that must finish first. No cycles.
- The review task has "scopes": [].
- Prefer few, well-separated tasks over many overlapping ones."""


class PlanError(ValueError):
    """A plan that could not be read, said in terms of what was wrong."""


def decompose_prompt(request: str, *, files: Sequence[str] = (),
                     stack: str = "") -> List[Dict]:
    """The conversation that turns one project request into a task list."""
    context = []
    if stack:
        context.append("The project uses: %s" % stack)
    if files:
        listing = "\n".join("  " + f for f in list(files)[:200])
        context.append("Files already in the project:\n" + listing)
    body = "\n\n".join(context + ["THE REQUEST:\n" + request.strip()])
    return [{"role": "system", "content": DECOMPOSE_SYSTEM},
            {"role": "user", "content": body}]


def _strip_fence(text: str) -> str:
    match = _OUTER_FENCE.match(text or "")
    return match.group(1) if match else (text or "")


def parse_plan(reply: str) -> List[dict]:
    """Read the Director's task list out of whatever it actually replied with.

    Models add a sentence before the JSON, or wrap it in a fence, often
    enough that refusing those replies would fail runs over presentation. So
    the outermost JSON object is located and read; anything that is not a
    usable task list raises rather than being patched into one.
    """
    text = _strip_fence((reply or "").strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise PlanError("The Director's reply contained no JSON plan.")

    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise PlanError("The Director's plan was not valid JSON: %s" % exc) from exc

    tasks = data.get("tasks") if isinstance(data, dict) else data
    if not isinstance(tasks, list) or not tasks:
        raise PlanError("The Director's plan listed no tasks.")

    cleaned: List[dict] = []
    for index, raw in enumerate(tasks):
        if not isinstance(raw, dict):
            raise PlanError("Task %d in the plan is not an object." % (index + 1))
        role = str(raw.get("role") or "feature").strip().lower()
        if role not in ROLES:
            raise PlanError(
                "Task %r was given the role %r, which does not exist."
                % (raw.get("title") or index + 1, role))
        cleaned.append({**raw, "role": role})
    return cleaned


def task_prompt(task: Task, *, request: str, context_files: Dict[str, str],
                completed: Sequence[Task] = ()) -> List[Dict]:
    """What one specialist is told.

    It gets the project request for context, its own scope stated twice - once
    as what it owns and once as what it must not touch - the acceptance
    criteria it will be reviewed against, and the handoff format. It does not
    get the other tasks' instructions: a specialist that knows what everyone
    else is building tends to build some of it too.
    """
    owned = "\n".join("  " + s for s in task.scopes) or "  (none)"
    forbidden = sorted({s for other in completed for s in other.scopes
                        if s not in task.scopes})
    criteria = "\n".join("  - " + a for a in task.acceptance) or \
        "  - The task as described is complete and the code runs."

    system = f"""\
You are the {task.role} specialist on an AI team. You are doing one task.

YOUR FILES - you may write these and nothing else:
{owned}

{"FILES OWNED BY OTHERS - do not write these, they will be discarded:" + chr(10) + chr(10).join("  " + f for f in forbidden) if forbidden else ""}

ACCEPTANCE CRITERIA - a reviewer will check these:
{criteria}

{HANDOFF_FORMAT}"""

    handoffs = []
    for other in completed:
        note = (other.output or "").strip()
        if note:
            handoffs.append("%s (%s) reported:\n%s" % (other.title, other.role, note[:1500]))

    parts = ["THE PROJECT:\n" + request.strip(),
             "YOUR TASK:\n" + task.instruction.strip()]
    if context_files:
        shown = "\n\n".join(
            "--- %s ---\n%s" % (path, body[:4000])
            for path, body in list(context_files.items())[:12])
        parts.append("CURRENT CONTENTS OF FILES YOU MAY NEED:\n" + shown)
    if handoffs:
        parts.append("ALREADY FINISHED BY OTHERS:\n" + "\n\n".join(handoffs))

    return [{"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(parts)}]


def review_prompt(request: str, tasks: Sequence[Task],
                  files: Dict[str, str]) -> List[Dict]:
    """The final pass. Reads the result and says whether it is what was asked."""
    summary = "\n".join(
        "  %s [%s] - %s%s" % (t.title, t.role, t.state.value,
                              (": " + t.error) if t.error else "")
        for t in tasks)
    listing = "\n\n".join("--- %s ---\n%s" % (p, b[:3000])
                          for p, b in list(files.items())[:20])
    system = """\
You are the reviewer. Every other specialist has finished. Judge the result
against the original request and report honestly - a review that calls broken
work finished is worse than no review.

Reply with JSON only:
{"verdict": "pass" | "changes-needed" | "failed",
 "summary": "Two or three sentences on what was built.",
 "problems": ["Specific, each naming a file where it applies."],
 "next_steps": ["What to do about them."]}"""
    body = "THE REQUEST:\n%s\n\nWHAT THE TEAM DID:\n%s\n\nTHE FILES:\n%s" % (
        request.strip(), summary, listing)
    return [{"role": "system", "content": system},
            {"role": "user", "content": body}]


def parse_review(reply: str) -> dict:
    """Read the reviewer's verdict, and do not invent one if it is missing."""
    text = _strip_fence((reply or "").strip())
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start:end + 1])
            if isinstance(data, dict) and data.get("verdict"):
                verdict = str(data["verdict"]).strip().lower()
                if verdict not in ("pass", "changes-needed", "failed"):
                    verdict = "changes-needed"
                return {
                    "verdict": verdict,
                    "summary": str(data.get("summary") or "").strip(),
                    "problems": [str(p) for p in (data.get("problems") or [])],
                    "next_steps": [str(s) for s in (data.get("next_steps") or [])],
                }
        except json.JSONDecodeError:
            pass
    # The review still happened and its prose is worth keeping; what is not
    # known is the verdict, so it is not claimed to be a pass.
    return {"verdict": "changes-needed",
            "summary": (reply or "").strip()[:1000],
            "problems": ["The reviewer's reply could not be read as a verdict."],
            "next_steps": []}


def parse_handoff(reply: str) -> dict:
    """Pull the files and the note out of a specialist's reply."""
    text = reply or ""
    files: Dict[str, str] = {}
    duplicates: List[str] = []

    for path, body in _FILE_BLOCK.findall(text):
        clean = path.strip()
        if not clean:
            continue
        if clean in files:
            # Last one wins, but it is recorded: a model that emitted one file
            # twice usually changed its mind halfway through.
            duplicates.append(clean)
        # A model that fences the contents inside the block as well.
        files[clean] = _strip_fence(body).rstrip() + "\n"

    notes = _NOTES_BLOCK.search(text)
    return {
        "files": files,
        "notes": (notes.group(1).strip() if notes else "").strip(),
        "duplicates": duplicates,
    }
