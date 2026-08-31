"""Stops a windowed build from flashing console windows.

The app is built with PyInstaller's --windowed, so it has no console of its
own. On Windows, every child process started without CREATE_NO_WINDOW gets
one anyway - a black box that opens, does its work and closes. There are
forty-eight subprocess calls in this backend and not one of them passed that
flag, so the windows appeared wherever the app ran a command.

Turning a plugin on is the clearest case. It reloads the plugin set, and
several plugins check whether their command line is installed by running it
for a version string - paperclip, agents-cli, hyperframes. Each check flashed
a window, so a single click produced a burst of them opening and closing.

The flag is added here rather than at each of the forty-eight call sites,
because subprocess.run, subprocess.call and subprocess.check_output all
create their process through Popen. Patching one place fixes them all, and
means the next subprocess call somebody writes is covered without them having
to know about any of this.

Nothing is hidden that was ever meant to be seen: these are probes and
conversions whose output the app captures and uses. The terminal feature is
unaffected in the way that matters - it never wanted a console window either,
it reads the output and streams it into the app's own terminal panel.
"""

from __future__ import annotations

import logging
import subprocess
import sys

logger = logging.getLogger(__name__)

#: Documented in the Windows API as 0x08000000. Named here rather than taken
#: from subprocess, because that attribute does not exist on other platforms
#: and this module is imported everywhere.
CREATE_NO_WINDOW = 0x08000000

_installed = False


def _has_console() -> bool:
    """Whether this process already owns a console window.

    Run from a console, it does, and child processes inherit that one rather
    than creating anything new - so there is nothing to suppress. In the
    packaged windowed build there is none, which is the case this exists for.

    Some terminals - mintty, which is what Git Bash uses - give a process
    pipes and no console window either, so this reports false there too.
    Suppressing a window that was never going to appear costs nothing, and
    output is unaffected: it is captured through pipes in both cases.
    """
    try:
        import ctypes

        return bool(ctypes.windll.kernel32.GetConsoleWindow())
    except Exception:
        # If it cannot be determined, assume there is one and change nothing.
        return True


def install() -> bool:
    """Add CREATE_NO_WINDOW to child processes. Returns whether it was applied.

    Idempotent, and a no-op anywhere but a consoleless Windows process.
    """
    global _installed

    if _installed or sys.platform != "win32" or _has_console():
        return False

    original = subprocess.Popen.__init__

    def patched(self, *args, **kwargs):
        # Whatever the caller asked for is kept; this only adds a bit. A call
        # that already sets creationflags kicks off exactly as it intended,
        # plus no window.
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | CREATE_NO_WINDOW
        return original(self, *args, **kwargs)

    subprocess.Popen.__init__ = patched
    _installed = True
    logger.info("Console windows suppressed for child processes.")
    return True
