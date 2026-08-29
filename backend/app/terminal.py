"""A real terminal, and a deliberate line about who is allowed to use it.

There was no terminal at all. What looked like one on the extensions screen -
"PowerShell & Terminal Executor", shown as Running - was a name in a
hardcoded array with no code behind it, and it is gone. desktop_agent has
sixty actions, but each does one fixed thing; there was nowhere to type a
command.

The line that matters here is who typed it.

A command **you** type is yours. It is your machine, your shell, and an
allowlist would only get in the way of the reason you opened a terminal -
so there is no allowlist and no confirmation step.

A command the **model** produced is a different thing. A model can be wrong,
and it reads web pages, documents and repositories that can carry
instructions written to be obeyed. So a model-issued command is never run
here; it is returned for you to approve, and only then does it run through
the same path as anything you typed. That is why `source` is required rather
than assumed - a caller that forgets to say gets the careful branch.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
from typing import AsyncIterator, Dict, Optional

logger = logging.getLogger(__name__)

#: Long enough for a build, short enough that a hung process is not for ever.
DEFAULT_TIMEOUT = 600

#: Output is streamed, but a runaway loop can produce megabytes a second and
#: there is no point holding it all.
MAX_OUTPUT_BYTES = 400_000


def default_shell() -> list[str]:
    """The shell to run a command through.

    PowerShell where it exists, because that is what a Windows user's
    instructions will assume; cmd is the fallback rather than the default
    because half of what people paste - `ls`, `curl`, pipelines - behaves
    differently or not at all there.
    """
    if sys.platform == "win32":
        for candidate in ("pwsh.exe", "powershell.exe"):
            found = shutil.which(candidate)
            if found:
                return [found, "-NoLogo", "-NoProfile", "-Command"]
        return ["cmd.exe", "/c"]
    return [os.environ.get("SHELL", "/bin/sh"), "-lc"]


def working_directory() -> str:
    """Where a command runs.

    The open project folder if there is one, because that is what a person
    means by "here" while working on something; their home directory
    otherwise. Never the directory SMARAN.AI itself was launched from, which
    is an implementation detail and, in the packaged build, a temporary
    extraction folder.
    """
    try:
        from app.workspace.core import workspace

        if workspace.root:
            return str(workspace.root)
    except Exception:
        pass
    return os.path.expanduser("~")


async def run(command: str, *, source: str, cwd: Optional[str] = None,
              timeout: int = DEFAULT_TIMEOUT) -> AsyncIterator[Dict]:
    """Run a command, yielding its output as it arrives.

    `source` must be "user" or "model". A model-issued command is refused
    here; approval happens above this layer, and an approved command arrives
    back as a user command because by then a person has read it and said yes.
    """
    if source not in ("user", "model"):
        raise ValueError("source must be 'user' or 'model'")

    command = (command or "").strip()
    if not command:
        yield {"type": "error", "text": "There is no command to run."}
        return

    if source == "model":
        yield {
            "type": "needs_approval",
            "command": command,
            "text": ("SMARAN.AI wants to run this. Read it, then approve it "
                     "if you are happy - it runs with your account and can "
                     "change anything you can change."),
        }
        return

    directory = cwd or working_directory()
    if not os.path.isdir(directory):
        yield {"type": "error", "text": "That folder does not exist: %s" % directory}
        return

    shell = default_shell()
    yield {"type": "start", "command": command, "cwd": directory,
           "shell": os.path.basename(shell[0])}

    try:
        process = await asyncio.create_subprocess_exec(
            *shell, command,
            cwd=directory,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except Exception as exc:
        yield {"type": "error", "text": "Could not start the shell: %s" % str(exc)[:160]}
        return

    sent = 0
    truncated = False
    try:
        async def pump():
            nonlocal sent, truncated
            while True:
                chunk = await process.stdout.read(4096)
                if not chunk:
                    return
                if sent >= MAX_OUTPUT_BYTES:
                    truncated = True
                    continue
                sent += len(chunk)
                yield chunk.decode("utf-8", "replace")

        async for text in pump():
            yield {"type": "output", "text": text}

        await asyncio.wait_for(process.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        # Killed rather than left running: a process this app started and
        # then forgot about would keep holding files and CPU with nothing
        # watching it.
        try:
            process.kill()
        except Exception:
            pass
        yield {"type": "error",
               "text": "Stopped after %d seconds. The command was still running." % timeout}
        return
    except Exception as exc:
        yield {"type": "error", "text": str(exc)[:200]}
        return

    if truncated:
        yield {"type": "output",
               "text": "\n[output past %d KB is not shown]\n" % (MAX_OUTPUT_BYTES // 1000)}

    yield {"type": "exit", "code": process.returncode,
           "text": "Finished with exit code %d." % process.returncode}
