"""Makes libraries that read their own source work inside a frozen build.

A PyInstaller build ships compiled modules, not .py files, so anything that
calls inspect.getsource() on itself fails. Most libraries never do that. One
in this dependency tree does, and it cost the offline voice entirely:

    g2p_en -> expand.py -> inflect -> typeguard's @typechecked
    -> inspect.getsource(module) -> OSError: could not get source code

inflect decorates its main class with @typechecked, which reads the module's
source to rewrite it with runtime type checks. There is no source to read, so
importing inflect raises, so g2p_en will not import, so Kokoro reported itself
unavailable and Speak fell back to the online voice. Nothing in the build said
a word about it - the failure was two `except` blocks deep.

The fix is not to disable type checking by force. typeguard already has a path
for "this function cannot be instrumented": instrument() returns a string
saying why, and typechecked() warns and hands back the original function
untouched. It simply does not treat a missing source file as one of those
cases - it lets the OSError out. So that one case is turned into the answer
typeguard already knows how to handle.

The effect is that inflect's functions are not type-checked in the packaged
build. They are not type-checked in any other shipped Python either: these are
development-time assertions, and losing them costs nothing at runtime while
keeping them costs the offline voice.

Running from source this does nothing at all - getsource works there, so the
wrapper never takes its fallback.
"""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger(__name__)

_installed = False


def install() -> bool:
    """Let typeguard degrade instead of raising. Returns whether it applied."""
    global _installed

    if _installed:
        return False

    try:
        from typeguard import _decorators
    except Exception:
        # typeguard is not installed, so nothing depends on this.
        return False

    original = getattr(_decorators, "instrument", None)
    if original is None or getattr(original, "_smaran_wrapped", False):
        return False

    def instrument(f):
        try:
            return original(f)
        except OSError as exc:
            # The exact string form typeguard's own caller expects: it warns
            # with this and returns the function unchanged.
            return "source is unavailable in this build (%s)" % exc

    instrument._smaran_wrapped = True  # type: ignore[attr-defined]
    _decorators.instrument = instrument
    _installed = True
    logger.info("typeguard will skip instrumentation where source is unreadable.")
    return True
