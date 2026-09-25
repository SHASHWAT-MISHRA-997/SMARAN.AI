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

import json
import logging
import re
from typing import AsyncIterator, Dict, List, Optional

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
            return None
    name = match.group(1).lower()
    arguments = {key.lower(): value for key, value in _ARGUMENT.findall(match.group(2))}
    # Content is code and must survive exactly; everything else is a path or a
    # command, where a stray newline is the model's formatting, not data.
    for key in list(arguments):
        if key != "content":
            arguments[key] = arguments[key].strip()
    return {"name": name, "arguments": arguments, "raw": match.group(0)}


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
              approve=None) -> AsyncIterator[Dict]:
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

    for step in range(1, MAX_STEPS + 1):
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

            yield {"type": "done", "steps": step, "tools_used": performed}
            return

        spoken = reply[:call["raw"] and reply.index(call["raw"])].strip()
        if spoken:
            yield {"type": "message", "text": spoken}

        yield {"type": "tool_call", "name": call["name"],
               "arguments": call["arguments"], "step": step}

        declined = False
        if approve is not None and call["name"] in toolbox.MUTATING:
            yield {"type": "approval_needed", "name": call["name"],
                   "arguments": call["arguments"], "step": step}
            declined = not await approve(step)
            yield {"type": "approval", "step": step, "approved": not declined}

        if declined:
            result = ("The person declined this action, so it was not carried out. "
                      "Do not repeat it; choose another approach or ask what they want.")
        else:
            result = toolbox.execute(call["name"], call["arguments"], workspace)
        performed.append(call["name"])
        yield {"type": "tool_result", "name": call["name"],
               "result": result, "step": step}

        # The arrow back. Without these two lines this is the old extension.
        messages.append({"role": "assistant", "content": reply})
        messages.append({
            "role": "user",
            "content": "Result of %s:\n%s" % (call["name"], result),
        })

    yield {
        "type": "error",
        "message": ("Stopped after %d steps without finishing. The work so far "
                    "has been done; ask again to carry on." % MAX_STEPS),
    }
