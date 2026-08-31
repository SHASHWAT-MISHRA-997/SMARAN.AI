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

#: How many times round the loop before stopping. Not a guess at how much work
#: a task needs - a stop so that a model repeating itself cannot run forever on
#: somebody's machine. Reaching it is reported, not hidden.
MAX_STEPS = 24

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


def parse_tool_call(text: str) -> Optional[Dict]:
    """The first tool call in a reply, or None if it is just talking."""
    match = _TOOL_CALL.search(text or "")
    if not match:
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
              provider: str = "", api_key: str = "") -> AsyncIterator[Dict]:
    """Carry out a task, reporting each step as it happens.

    Yields dicts the caller can show: 'message' when the agent says something,
    'tool_call' when it is about to act, 'tool_result' with what came back,
    'done' at the end, 'error' when something stopped it.
    """
    messages: List[Dict] = [
        {"role": "system", "content": SYSTEM % toolbox.describe_tools()},
    ]
    messages.extend(history or [])
    messages.append({"role": "user", "content": task})

    # What was actually done, so a claim of completion can be checked against
    # it. A small model will write one file and announce it wrote three; the
    # caller should not have to take its word.
    performed: List[str] = []

    for step in range(1, MAX_STEPS + 1):
        try:
            reply = await _ask_model(messages, model, provider, api_key)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            yield {"type": "error", "message": str(exc)}
            return

        call = parse_tool_call(reply)

        if call is None:
            # No tool asked for: the agent considers the work finished.
            yield {"type": "message", "text": reply}
            yield {"type": "done", "steps": step, "tools_used": performed}
            return

        spoken = reply[:call["raw"] and reply.index(call["raw"])].strip()
        if spoken:
            yield {"type": "message", "text": spoken}

        yield {"type": "tool_call", "name": call["name"],
               "arguments": call["arguments"], "step": step}

        result = toolbox.execute(call["name"], call["arguments"])
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
