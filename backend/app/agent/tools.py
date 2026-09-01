"""What the agent can actually do, and the guard rails on each.

The tools themselves are not new. The workspace already knew how to read a
file, propose a write and apply it; the terminal already knew how to run a
command and how to tell a command you typed from one a model produced. What
was missing was any way for a model to reach them and, more importantly, to
find out what happened afterwards.

Every tool here returns a plain result the model is shown. That is the whole
point: an agent is not a model that can act, it is a model that can act and
then read the consequence. A file write that reports "written" and a file
write that reports "no such directory" have to look different to the model,
or it cannot correct itself and the work stops at the first mistake.

Nothing here reaches outside the folder the user opened. The workspace
resolves every path against that root and refuses anything that climbs out of
it, so a wrong path fails as a message rather than as a file somewhere else on
the disk.

Which folder that is has to be decided by the caller, not assumed. The desktop
app has one open folder and a single Workspace to match. An editor extension
has whatever project the person is looking at, which is frequently not the
same one - and an agent that took the app's folder would have written the
editor's changes into somebody else's project. So every tool is given the
workspace to act in, and the caller says which.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("agent.tools")

#: How much of a file or a command's output the model is shown. Long enough to
#: work with, short enough that one large file cannot fill the context and
#: push the actual instruction out of it.
MAX_OUTPUT_CHARS = 12000


class ToolError(RuntimeError):
    """Something the model asked for could not be done, with the reason."""


def _clip(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + "\n… (%d more characters not shown)" % (len(text) - limit)


# ---------------------------------------------------------------------------
# The tools
# ---------------------------------------------------------------------------

def workspace_for(root: str = ""):
    """The folder this run works in.

    With a root, a Workspace of its own opened there - which is how the editor
    extension gets the project the person is actually looking at rather than
    whatever the desktop app happens to have open. Without one, the app's
    single open folder, unchanged.

    Opening enforces the same refusals either way: not a drive root, not a home
    directory, and every path resolved back inside the root afterwards.
    """
    if (root or "").strip():
        from app.workspace.core import Workspace, WorkspaceError

        own = Workspace()
        try:
            own.open(root)
        except WorkspaceError as exc:
            raise ToolError(str(exc)) from exc
        return own

    from app.workspace.core import workspace

    if not workspace.describe().get("open"):
        raise ToolError(
            "No folder is open, so there is nothing to work in. Open one first "
            "- the interface has 'Open a folder' above the message box."
        )
    return workspace


def list_files(workspace, path: str = "") -> str:
    """Everything in the workspace, or under one directory of it."""
    tree = workspace.tree()
    entries = tree.get("entries") or tree.get("tree") or []
    if path:
        wanted = path.strip("/\\")
        entries = [e for e in entries
                   if str(e.get("path", "")).replace("\\", "/").startswith(wanted)]
    if not entries:
        return "Nothing found under %r." % (path or ".")
    lines = ["%s%s" % (e.get("path"), "/" if e.get("type") == "dir" else "")
             for e in entries]
    return _clip("\n".join(lines))


def read_file(workspace, path: str) -> str:
    """The contents of one file, with line numbers so edits can refer to them."""
    result = workspace.read(path)
    # The workspace calls this "text". Reading a key that is not there returned
    # the empty string, so every file looked empty and edit_file could never
    # find anything to replace. Watching a run is what caught it: the model
    # read two files, was told both were empty, and went round the problem by
    # printing them with a shell command.
    text = result["text"]
    numbered = "\n".join("%5d  %s" % (i, line)
                         for i, line in enumerate(text.splitlines(), start=1))
    return _clip(numbered) or "(the file is empty)"


def write_file(workspace, path: str, content: str) -> str:
    """Create or replace a file.

    Goes through the workspace's proposal mechanism and is then applied, so the
    change is recorded and reversible rather than written straight over
    somebody's work with no trace.
    """
    proposal = workspace.propose_write(path, content, summary="written by the agent")
    change_id = proposal.get("id") or proposal.get("change_id")
    if not change_id:
        raise ToolError("The write could not be prepared: %s" % json.dumps(proposal)[:200])
    workspace.apply(change_id)
    lines = content.count("\n") + 1
    return "Wrote %s (%d lines)." % (path, lines)


def edit_file(workspace, path: str, find: str, replace: str) -> str:
    """Replace an exact piece of text in a file.

    Exact rather than fuzzy, and it refuses when the text appears more than
    once. A model that is slightly wrong about the surrounding lines should be
    told so, not have its guess applied to whichever match came first.
    """
    current = workspace.read(path)["text"]
    occurrences = current.count(find)
    if occurrences == 0:
        return ("That exact text is not in %s. Read the file again and copy the "
                "lines you mean, including their indentation." % path)
    if occurrences > 1:
        return ("That text appears %d times in %s, so it is not clear which one "
                "you mean. Include more surrounding lines to make it unique."
                % (occurrences, path))
    return write_file(workspace, path, current.replace(find, replace, 1))


def search(workspace, query: str, path: str = "") -> str:
    """Find which files contain a piece of text."""
    root = workspace.resolve(path or ".")
    found: List[str] = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs
                   if d not in {".git", "node_modules", "__pycache__", ".venv", "dist"}]
        for name in files:
            full = os.path.join(base, name)
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as handle:
                    for number, line in enumerate(handle, start=1):
                        if query in line:
                            found.append("%s:%d: %s"
                                         % (os.path.relpath(full, root).replace("\\", "/"),
                                            number, line.strip()[:160]))
                            break
            except OSError:
                continue
            if len(found) >= 80:
                break
    return _clip("\n".join(found)) if found else "No file contains %r." % query


def run_command(workspace, command: str) -> str:
    """Run a shell command in the workspace and return what it printed.

    The output is the point. A command whose result the model never sees is a
    command it cannot learn from - it would write a test, run it, and never
    find out whether it passed.
    """
    root = str(workspace.root)
    try:
        finished = subprocess.run(
            command, shell=True, cwd=root, capture_output=True,
            text=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        return "The command was still running after five minutes and was stopped."
    except OSError as exc:
        raise ToolError("The command could not start: %s" % exc) from exc

    output = (finished.stdout or "") + (finished.stderr or "")
    return _clip("exit code %d\n%s" % (finished.returncode, output.strip() or "(no output)"))


def git(workspace, subcommand: str) -> str:
    """Run one git command in the workspace.

    Separate from run_command so that version control is something the agent
    can be given or refused on its own, and so "commit and push" is a thing it
    knows how to do rather than a shell command it has to guess at.
    """
    return run_command(workspace, "git " + subcommand)


# ---------------------------------------------------------------------------
# What the model is told it can do
# ---------------------------------------------------------------------------

#: Name -> (function, required argument names, one line for the model).
TOOLS: Dict[str, tuple] = {
    "list_files":  (list_files,  ["path"],
                    "List files in the workspace. path is optional."),
    "read_file":   (read_file,   ["path"],
                    "Read a file. Returns it with line numbers."),
    "write_file":  (write_file,  ["path", "content"],
                    "Create or completely replace a file."),
    "edit_file":   (edit_file,   ["path", "find", "replace"],
                    "Replace an exact piece of text in a file. The text must "
                    "appear exactly once."),
    "search":      (search,      ["query"],
                    "Find which files contain a piece of text."),
    "run_command": (run_command, ["command"],
                    "Run a shell command in the workspace and read its output."),
    "git":         (git,         ["subcommand"],
                    "Run a git command, for example: status, add -A, "
                    "commit -m \"...\", push."),
}

#: Tools that change something. Listed so the caller can decide which of them
#: need a person to agree first - writing a file and reading one are not the
#: same kind of act.
MUTATING = {"write_file", "edit_file", "run_command", "git"}


def describe_tools() -> str:
    """The tool list as the model is shown it."""
    lines = []
    for name, (_, args, description) in TOOLS.items():
        lines.append("- %s(%s): %s" % (name, ", ".join(args), description))
    return "\n".join(lines)


def execute(name: str, arguments: Dict[str, Any], workspace) -> str:
    """Run one tool in the given workspace, and return what the model sees."""
    entry = TOOLS.get(name)
    if entry is None:
        return ("There is no tool called %r. The ones that exist are: %s."
                % (name, ", ".join(TOOLS)))

    function, required, _ = entry
    missing = [a for a in required if a not in arguments and a != "path"]
    if missing:
        return "%s needs %s." % (name, " and ".join(missing))

    accepted = function.__code__.co_varnames[:function.__code__.co_argcount]
    try:
        return function(workspace, **{k: v for k, v in arguments.items()
                                      if k in accepted and k != "workspace"})
    except ToolError as exc:
        return str(exc)
    except Exception as exc:  # noqa: BLE001 - the model is shown the failure
        logger.warning("tool %s failed: %s", name, exc, exc_info=True)
        return "%s failed: %s" % (name, str(exc)[:300])
