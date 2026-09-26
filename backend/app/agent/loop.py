"""The loop that makes it an agent rather than a chat box.

What shipped before did this: send the question, take the one reply, scan it
with two regular expressions for a create_file or a run_command, do whatever
matched, stop. The model never learned whether the file was written, whether
the command failed, or whether the test it just wrote passes. It got one
guess, and if the guess was wrong nothing corrected it. That is why it read as
question-and-answer with occasional file writing, and why no amount of
prompting or a better API key changed it: the shape was wrong, not the model.

This is the other shape:

    ask the model
        -> it asks for a tool
        -> run the tool
        -> give it the result
        -> ask again
    until it stops asking for tools, or the step limit is reached

Each turn the model sees everything that has happened, so it can read a file,
notice the function is not where it assumed, search for it, edit the right
place, run the tests, see one fail, and fix it. None of that is possible
without the arrow that goes back.

Two deliberate choices:

A plan comes first. For anything but a trivial request the model is asked to
say what it intends to do, and nothing is touched until a person agrees. Being
able to act is exactly why it should ask.

Tool calls are XML tags in ordinary text, not a provider's function-calling
API. Every model this app can reach - a small one in Ollama, a cloud model
behind somebody's key - can produce tags. Native tool calling would work for
some of them and quietly fail for the rest.
"""

from __future__ import annotations

import asyncio

import json
import logging
import re
from typing import AsyncIterator, Dict, List, Optional

from app.agent import checkpoints, safety
from app.agent import tools as toolbox

logger = logging.getLogger("agent.loop")

#: How many times round the loop before stopping. Increased to 48 for complex autonomous tasks.
MAX_STEPS = 48

SYSTEM = """You are SMARAN.AI's coding agent, working inside a real folder on \
this machine. You can read and change files and run commands, and you see the \
result of everything you do.

Work like an engineer, not like a chat reply:

- Look before you change. Read the files you are about to edit. Do not assume \
what is in them.
- Make the change with a tool. Writing code into your message is not doing it; \
the person asked for the work, not a description of it.
- Check what you did. Run the tests, run the file, read it back. If something \
failed, the output will say so - fix it and try again.
- Fix the code, not the tests. Do not edit, weaken or delete a test to make it pass unless the person asked for that.
- Run tests the way they are written: files of plain `def test_...` functions with `assert` are pytest (`python -m pytest -q`), not unittest.
- If a step fails, do not repeat it unchanged. Read again, change the approach, or say what is blocking you.
- Stop when it is actually done, and say what you changed.

To use a tool, emit exactly this and nothing after it in that message:

<tool_call name="read_file">
<path>src/main.py</path>
</tool_call>

One tool per message. You will be given the result and can then continue.

%s

When the work is complete, reply normally with no tool call, and summarise \
what you changed and what you verified."""

def _project_view(workspace) -> str:
    """The folder's files, given with the task - as Claude Code and Codex do.

    Without it the model guessed at paths ("src/calc.py" for a calc.py at the
    root), spent turns on files that do not exist, and small models gave up.
    """
    try:
        listing = toolbox.list_files(workspace, "")
    except Exception:  # noqa: BLE001 - a view is a help, not a requirement
        return ""
    lines = listing.splitlines()
    shown = "\n".join(lines[:200])
    more = "\n... and %d more" % (len(lines) - 200) if len(lines) > 200 else ""
    return "\n\nFiles in the open folder (paths are relative to it):\n" + shown + more


NL = chr(10)

# A reply that announces work instead of finishing it.
_ANNOUNCED = re.compile(r"\b(let'?s|let me|i will|i'll|next,? i|now i)\b", re.I)
_FINISHED = re.compile(r"\b(all (the )?tests pass|tests? (now )?pass(es|ed)?|task is (done|complete)|"
                       r"(have|has) been fixed|is now fixed|i have (made|fixed|changed))\b", re.I)


def _decision(value) -> tuple:
    """(approved, note) from whatever the approver returned.

    A bool, {"approve", "note"}, or (approved, note). A tuple read as a plain
    truth value is always "yes" - (False, "no") included - so each shape is
    taken apart explicitly: a refusal must never become an approval.
    """
    if isinstance(value, dict):
        return bool(value.get("approve")), str(value.get("note") or "").strip()[:2000]
    if isinstance(value, (tuple, list)):
        approved = bool(value[0]) if len(value) > 0 else False
        note = str(value[1] or "").strip()[:2000] if len(value) > 1 else ""
        return approved, note
    return bool(value), ""


def _git_rules() -> str:
    try:
        from app.agent import git_policy
        return git_policy.describe()
    except Exception:  # preferences unreadable: the enforcement still applies
        return ""


PLAN_SYSTEM = """You are SMARAN.AI's coding agent. Before doing anything, say \
what you intend to do.

Give a short numbered plan: which files you will read, what you will change, \
and how you will check it worked. Name real files where you can. Do not write \
the code yet and do not use any tools - this is the plan the person will agree \
to or correct.

Keep it under ten lines."""


_TOOL_CALL = re.compile(
    r"<tool_call\s+name=[\"']([a-z_]+)[\"']\s*>(.*?)</tool_call>",
    re.IGNORECASE | re.DOTALL,
)
_ARGUMENT = re.compile(r"<([a-z_]+)>(.*?)</\1>", re.IGNORECASE | re.DOTALL)


_UNCLOSED_CALL = re.compile(
    r"<tool_call\s+name=[\"']([a-z_]+)[\"']\s*>(.*)$",
    re.IGNORECASE | re.DOTALL,
)


def parse_tool_call(text: str) -> Optional[Dict]:
    """The first tool call in a reply, or None if it is just talking.

    Small local models often stop before writing </tool_call>. A call that is
    otherwise complete - every argument tag closed - is taken as meant, rather
    than ending the run with the raw tag printed as the answer.
    """
    match = _TOOL_CALL.search(text or "")
    if not match:
        match = _UNCLOSED_CALL.search(text or "")
        if not match or not _ARGUMENT.search(match.group(2)):
            return _attribute_call(text or "")
    name = match.group(1).lower()
    arguments = {key.lower(): value for key, value in _ARGUMENT.findall(match.group(2))}
    for key in list(arguments):
        if key in _EXACT_ARGUMENTS:
            # Code: indentation is meaning. Only the line breaks the model put
            # around the tag are layout. Stripping all whitespace here moved an
            # edit's first line to column zero and broke Python indentation.
            arguments[key] = _trim_newlines(_real_line_breaks(arguments[key]))
        else:
            arguments[key] = arguments[key].strip()
    return {"name": name, "arguments": arguments, "raw": match.group(0)}


#: Arguments that are code, where whitespace must survive.
_EXACT_ARGUMENTS = {"content", "find", "replace"}

_ATTR_TAG = re.compile(r"<([a-z_]+)((?:\s+[a-z_]+\s*=\s*(?:\"[^\"]*\"|'[^']*'))+)\s*/?>", re.IGNORECASE)
_ATTR = re.compile(r"([a-z_]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')", re.IGNORECASE)


# A written-out line break used as layout: backslash-n followed by
# indentation, another one, or the end of the value.
_ESCAPED_BREAK = re.compile(r"(?:\\r)?\\n(?=[ \t]|\\n|\\r|$)")


def _real_line_breaks(value: str) -> str:
    """Small models write the code for an edit as one line with backslash-n in it.

    Taken literally, a function header, backslash-n and its indented docstring
    went into the file as one line with a backslash in it and broke the module.
    Only a value with no real line break of its own is touched, and only
    escapes used as layout - so a one-line print("a" backslash-n "b") in real
    code is left alone.
    """
    if chr(10) in value or not _ESCAPED_BREAK.search(value):
        return value
    return _ESCAPED_BREAK.sub(chr(10), value)


def _trim_newlines(value: str) -> str:
    if value.startswith("\r\n"):
        value = value[2:]
    elif value.startswith("\n"):
        value = value[1:]
    if value.endswith("\r\n"):
        value = value[:-2]
    elif value.endswith("\n"):
        value = value[:-1]
    return value


def _attribute_call(text: str) -> Optional[Dict]:
    """A call written as <write_file path="a.txt" content="hi">.

    Small models sometimes use the tool's name as the tag and its arguments as
    attributes. Only a real tool name counts, so ordinary HTML in an answer is
    not mistaken for a call.
    """
    for match in _ATTR_TAG.finditer(text):
        name = match.group(1).lower()
        if name not in toolbox.TOOLS:
            continue
        # findall gives (name, double-quoted value, single-quoted value).
        arguments = {key.lower(): double or single
                     for key, double, single in _ATTR.findall(match.group(2))}
        return {"name": name, "arguments": arguments, "raw": match.group(0)}
    return None


async def _ask_model(messages: List[Dict], model: str = "",
                     provider: str = "", api_key: str = "") -> str:
    """One turn from whichever model the agent has been given.

    A local model is fine for small edits and is measurably not fine for real
    work: a three billion parameter model here wrote one file and then said it
    had written two. So the agent takes a provider and a key when there is
    one, and falls back to whatever is installed when there is not.
    """
    from app.agent import models as backends

    chosen = model
    if not provider and not chosen:
        from app.main import _auto_route_model, _installed_ollama_models

        chosen = _auto_route_model(
            messages[-1].get("content", ""), _installed_ollama_models())
        if not chosen:
            raise RuntimeError(
                "No local model is installed that can answer, and no cloud "
                "model was given. Install one from the Model Catalog, or pass "
                "a provider and key.")

    return await backends.complete(messages, chosen, provider, api_key)


async def plan(task: str, model: str = "", provider: str = "",
               api_key: str = "") -> str:
    """What the agent intends to do, before it does anything."""
    return await _ask_model(
        [{"role": "system", "content": PLAN_SYSTEM},
         {"role": "user", "content": task}],
        model, provider, api_key,
    )


async def run(task: str, model: str = "",
              history: Optional[List[Dict]] = None,
              provider: str = "", api_key: str = "",
              root: str = "",
              approve=None,
              mode: Optional[str] = None,
              run_id: str = "",
              max_steps: int = MAX_STEPS) -> AsyncIterator[Dict]:
    """Carry out a task, reporting each step as it happens.

    Yields dicts the caller can show: 'message' when the agent says something,
    'tool_call' when it is about to act, 'tool_result' with what came back,
    'done' at the end, 'error' when something stopped it.

    `root` is the folder to work in. The editor extension passes the project
    the person has open; the desktop app passes nothing and gets its own.

    `approve`, when given, is awaited before every tool that changes something
    (writing, editing, running a command, git, restoring a snapshot) with the
    step number; it answers True to go ahead. An 'approval_needed' event is
    yielded first so the person can see exactly what is about to happen. A
    refusal is told to the model, which can then take another route.
    """
    try:
        workspace = toolbox.workspace_for(root)
    except toolbox.ToolError as exc:
        yield {"type": "error", "message": str(exc)}
        return

    prefs = safety.load()
    allowlist = prefs.get("allowlist", [])
    redact_secrets = prefs.get("redact_secrets", True)

    yield {"type": "workspace", "root": str(workspace.root)}

    # Hermes parity: Cross-session memory and learned skill injection
    learning_context = ""
    try:
        from app.agent.memory import get_memory
        from app.agent.skill_creator import get_skill_creator
        mem = get_memory()
        user_model = mem.get_user_model()
        skill_context = get_skill_creator().get_skills_prompt(task)
        past_memories = mem.search(task, limit=3)
        ctx = []
        if user_model:
            ctx.append("User Preferences & Patterns:\n" + "\n".join(f"- {k}: {v}" for k, v in user_model.items()))
        if past_memories:
            ctx.append("Relevant Past Context:\n" + "\n".join(f"- {m.get('content', '')}" for m in past_memories))
        if skill_context:
            ctx.append(skill_context)
        if ctx:
            learning_context = "\n\n" + "\n\n".join(ctx)
    except Exception as exc:
        logger.debug("Memory retrieval skipped: %s", exc)

    messages: List[Dict] = [
        {"role": "system", "content": (SYSTEM % toolbox.describe_tools()) + "\n\n" + _git_rules() + learning_context},
    ]
    messages.extend(history or [])
    messages.append({"role": "user", "content": task + _project_view(workspace)})

    # What was actually done, so a claim of completion can be checked against
    # it. A small model will write one file and announce it wrote three; the
    # caller should not have to take its word.
    performed: List[str] = []
    repairs = 0
    nudges = 0
    # The same call with the same outcome, again and again: a small model
    # stuck on one failing edit made it seventeen times and burned every step.
    repeats: Dict[str, int] = {}

    for step in range(1, max_steps + 1):
        try:
            reply = await _ask_model(messages, model, provider, api_key)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            yield {"type": "error", "message": str(exc)}
            return

        call = parse_tool_call(reply)

        if call is None and "<tool_call" in (reply or "") and repairs < 3:
            # It tried to use a tool and got the format wrong. Ending here
            # printed a half tag as the "answer"; asking again costs one turn.
            repairs += 1
            messages.append({"role": "assistant", "content": reply})
            messages.append({"role": "user", "content": (
                "That tool call could not be read. Use exactly this shape, with every tag closed:\n"
                '<tool_call name="read_file">\n<path>calc.py</path>\n</tool_call>')})
            continue

        if call is None and nudges < 2 and _ANNOUNCED.search(reply or "") and not _FINISHED.search(reply or ""):
            # It said what it was about to do - "Let's fix this function" -
            # and stopped there. Small models do this often; taking it as the
            # end left the task half done with a message promising more.
            nudges += 1
            yield {"type": "message", "text": reply}
            messages.append({"role": "assistant", "content": reply})
            messages.append({"role": "user", "content": (
                "You described the next step but did not do it. Nothing in a code block is run, "
                "and file contents you have not read with a tool are guesses. Do the step now, "
                "with a tool call in exactly this shape and nothing after it:" + NL + NL +
                '<tool_call name="read_file">' + NL + "<path>path/to/file.py</path>" + NL + "</tool_call>" + NL + NL +
                "If the whole task is already finished and checked, say so and summarise.")})
            continue

        if call is None:
            # No tool asked for: the agent considers the work finished.
            yield {"type": "message", "text": reply}

            # Hermes Parity: Autonomous skill extraction & memory persistence
            try:
                from app.agent.memory import get_memory
                from app.agent.skill_creator import get_skill_creator
                mem = get_memory()
                creator = get_skill_creator()

                # Auto skill extraction
                skill_candidate = creator.extract_skill_from_session(
                    task=task, steps_taken=step, tools_used=performed, summary=reply[:300]
                )
                if skill_candidate:
                    skill = creator.create_skill(
                        name=skill_candidate["name"],
                        description=skill_candidate["description"],
                        steps=skill_candidate["steps"],
                        triggers=skill_candidate["triggers"],
                        tags=skill_candidate.get("tags")
                    )
                    yield {
                        "type": "skill_created",
                        "name": skill_candidate["name"],
                        # The file it was saved to - the object itself is not
                        # JSON and ended the stream with a serialisation error.
                        "path": getattr(skill, "filepath", "") or "",
                        "description": skill_candidate["description"]
                    }

                # Auto record session in memory FTS
                mem.save_learning(
                    session_id=f"step_{step}",
                    content=f"Task: {task}\nSummary: {reply[:400]}\nTools: {', '.join(performed)}",
                    category="session_summary"
                )
            except Exception as exc:
                logger.debug("Post-task learning loop skipped: %s", exc)

            if not performed:
                # Said to be finished without a single tool used: nothing was
                # read, changed or run, whatever the reply says.
                yield {"type": "message", "text": (
                    "Note: SMARAN Code did not read, change or run anything - the model answered "
                    "without using its tools. Try again, or choose a stronger model.")}
            yield {"type": "done", "steps": step, "tools_used": performed}
            return

        spoken = reply[:call["raw"] and reply.index(call["raw"])].strip()
        if spoken:
            yield {"type": "message", "text": spoken}

        yield {"type": "tool_call", "name": call["name"],
               "arguments": call["arguments"], "step": step}

        declined = False
        refused = ""
        note = ""
        if mode is not None:
            # The owner's approval mode decides: run, ask, or refuse outright.
            # "live" reads it now, so a change made during the run applies.
            current_mode, current_allow = mode, allowlist
            if mode == "live":
                live = safety.load()
                current_mode, current_allow = live["approval_mode"], live["allowlist"]
            verdict = safety.decide(call["name"], call["arguments"], current_mode, current_allow)
            if current_mode == "smart" and verdict["verdict"] == "allow" and call["name"] in safety.FILE_CHANGES:
                # A second opinion from Jev, when a TypeSafe key is saved. It
                # can turn an automatic edit into a question, never the reverse.
                caution = await asyncio.to_thread(safety.jev_caution, call["name"], call["arguments"], task)
                if caution:
                    verdict = {"verdict": "ask", "reason": caution}
            if verdict["verdict"] == "refuse":
                refused = verdict["reason"]
                yield {"type": "approval", "step": step, "approved": False, "reason": refused}
            elif verdict["verdict"] == "ask":
                yield {"type": "approval_needed", "name": call["name"], "arguments": call["arguments"],
                       "step": step, "reason": verdict["reason"]}
                decision = await approve(step, call["name"], call["arguments"]) if approve is not None else False
                approved, note = _decision(decision)
                declined = not approved
                yield {"type": "approval", "step": step, "approved": approved, "note": note}
        elif approve is not None and call["name"] in toolbox.MUTATING:
            yield {"type": "approval_needed", "name": call["name"],
                   "arguments": call["arguments"], "step": step}
            approved, note = _decision(await approve(step, call["name"], call["arguments"]))
            declined = not approved
            yield {"type": "approval", "step": step, "approved": approved, "note": note}

        if refused:
            result = "Refused, and it will be refused however it is asked: %s" % refused
        elif declined and note:
            result = ("The person declined this action, so it was not carried out, "
                      "and told you instead:\n%s\nDo what they said." % note)
        elif declined:
            result = ("The person declined this action, so it was not carried out. "
                      "Do not repeat it; choose another approach or ask what they want.")
            if note:
                result += " They said: " + note
        else:
            if run_id and call["name"] in safety.FILE_CHANGES:
                # The original is kept before the first write, so the whole
                # run can be undone.
                try:
                    target = workspace.resolve(str(call["arguments"].get("path", "")))
                    first = not checkpoints.changes(run_id)["exists"]
                    checkpoints.remember(run_id, str(workspace.root), str(target))
                    if first:
                        yield {"type": "checkpoint", "run_id": run_id}
                except Exception:  # noqa: BLE001 - the tool reports a bad path itself
                    pass
            # In a thread: a command can take minutes, and run on the event
            # loop it froze the whole server - the Allow button included, so
            # the next approval could never arrive and the run looked stuck.
            result = await asyncio.to_thread(toolbox.execute, call["name"], call["arguments"], workspace)
            if redact_secrets:
                result = safety.redact(result)
            if note:
                result += "\n\nThe person allowed this and added: " + note
        performed.append(call["name"])
        again = json.dumps([call["name"], call["arguments"], result[:500]], sort_keys=True, default=str)
        repeats[again] = repeats.get(again, 0) + 1
        if repeats[again] == 2:
            result += ("\n\nYou have made this exact call before and got this exact result. "
                       "Doing it again will not change anything: read the file, use different "
                       "text, try another approach, or stop and say what is blocking you.")
        yield {"type": "tool_result", "name": call["name"],
               "result": result, "step": step}
        if repeats[again] >= 3:
            yield {"type": "error", "message": (
                "Stopped: it kept repeating the same %s with the same result, so carrying on "
                "would only use up steps. What was done so far is kept (and can be undone). "
                "Try a clearer instruction or a stronger model." % call["name"])}
            return

        # The arrow back. Without these two lines this is the old extension.
        messages.append({"role": "assistant", "content": reply})
        messages.append({
            "role": "user",
            "content": "Result of %s:\n%s" % (call["name"], result),
        })

    yield {
        "type": "error",
        "message": ("Stopped after %d steps without finishing. The work so far "
                    "has been done; ask again to carry on." % max_steps),
    }
