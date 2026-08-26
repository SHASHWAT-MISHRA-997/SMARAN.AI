"""Reading a script into shots.

This does no generation. It reads what someone wrote and works out how many
clips it becomes, how long each one runs, and what prompt each carries, so
that the cost of the whole thing is known before a single frame is rendered.

The model here is not a screenplay parser. LTX takes one prompt and produces
one continuous clip with no cuts in it, so a "shot" is exactly the unit that
maps onto one generation call. Splitting is therefore mechanical and
inspectable: a blank line, or an explicit marker, ends a shot.

Nothing is inferred about pacing that the writer did not say. A shot with no
stated duration gets the default, and the plan says so, rather than the plan
inventing a rhythm and presenting it as the writer's.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from typing import List, Optional

# LTX snaps frame count to 8n+1. At 30 fps the reachable durations are
# 0.30, 0.57, 0.83 ... so a request is rounded and the rounding is reported.
FPS = 30
MIN_SECONDS = 1.0

# Not a limit of the model: a limit of what fits in 6 GB and finishes in a
# time a person will wait for. Longer is refused with the number rather than
# accepted and then failing partway through a batch.
MAX_SECONDS_PER_SHOT = 5.0
DEFAULT_SECONDS = 3.0
MAX_SHOTS = 24

# "[4s]" or "(2.5 s)" at the end of a line, which is the only piece of
# notation this understands. Anything else in the line is prompt text.
_DURATION = re.compile(r"[\[\(]\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\s*[\]\)]\s*$",
                       re.IGNORECASE)

# A line that is only a marker: "SHOT 3", "---", "## Scene 2". These separate
# shots and contribute no prompt text of their own.
_MARKER = re.compile(r"^\s*(?:#{1,6}\s*)?(?:-{3,}|\*{3,}|"
                     r"(?:shot|scene|cut)\s*\d*\s*[:.]?)\s*$", re.IGNORECASE)


class ScriptError(ValueError):
    """A failure worth showing the writer in the words it happened in."""


@dataclass
class Shot:
    index: int
    prompt: str
    seconds: float
    #: What the writer asked for, when it differed from `seconds`.
    requested_seconds: Optional[float] = None
    #: How the duration was arrived at, in words.
    duration_source: str = ""
    frames: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Plan:
    shots: List[Shot]
    total_seconds: float
    notes: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "shots": [s.as_dict() for s in self.shots],
            "shot_count": len(self.shots),
            "total_seconds": self.total_seconds,
            "fps": FPS,
            "notes": self.notes,
        }


def _snap_frames(seconds: float) -> int:
    """Frames for `seconds`, snapped up to the 8n+1 the model accepts."""
    frames = max(9, int(round(seconds * FPS)))
    return ((frames - 1 + 7) // 8) * 8 + 1


def parse(text: str, default_seconds: float = DEFAULT_SECONDS) -> Plan:
    """Read a script into shots, reporting every adjustment made to it."""
    if not (text or "").strip():
        raise ScriptError("The script is empty.")

    if not MIN_SECONDS <= default_seconds <= MAX_SECONDS_PER_SHOT:
        raise ScriptError(
            "A default of %.1f s is outside the %.1f-%.1f s a shot can be."
            % (default_seconds, MIN_SECONDS, MAX_SECONDS_PER_SHOT)
        )

    notes: List[str] = []

    # Blank lines separate shots; markers do too, and are dropped.
    blocks: List[List[str]] = [[]]
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or _MARKER.match(line):
            if blocks[-1]:
                blocks.append([])
            continue
        blocks[-1].append(line)
    blocks = [b for b in blocks if b]

    if not blocks:
        raise ScriptError(
            "That script is only separators and blank lines - there is no "
            "text to render."
        )

    if len(blocks) > MAX_SHOTS:
        raise ScriptError(
            "That is %d shots and the limit here is %d. Each one is a separate "
            "generation, so a longer script is split by hand rather than "
            "started and abandoned partway."
            % (len(blocks), MAX_SHOTS)
        )

    shots: List[Shot] = []
    for position, block in enumerate(blocks, start=1):
        body = " ".join(block)

        requested: Optional[float] = None
        match = _DURATION.search(body)
        if match:
            requested = float(match.group(1))
            body = body[: match.start()].strip()

        if not body:
            raise ScriptError(
                "Shot %d has a duration but no description, so there is "
                "nothing to render." % position
            )

        if requested is None:
            seconds = default_seconds
            source = "the default, because the script did not say"
        elif requested < MIN_SECONDS:
            seconds = MIN_SECONDS
            source = ("raised from %.2f s: below %.1f s the model has too few "
                      "frames to move" % (requested, MIN_SECONDS))
            notes.append("Shot %d was raised to %.1f s." % (position, MIN_SECONDS))
        elif requested > MAX_SECONDS_PER_SHOT:
            seconds = MAX_SECONDS_PER_SHOT
            source = ("capped from %.2f s: longer than %.1f s does not fit in "
                      "6 GB" % (requested, MAX_SECONDS_PER_SHOT))
            notes.append(
                "Shot %d was capped at %.1f s, down from %.1f s."
                % (position, MAX_SECONDS_PER_SHOT, requested)
            )
        else:
            seconds = requested
            source = "as written"

        frames = _snap_frames(seconds)
        actual = frames / FPS
        if abs(actual - seconds) > 0.005:
            source += ("; %.2f s is not reachable at %d fps in steps of 8 "
                       "frames, so it became %.2f s" % (seconds, FPS, actual))

        shots.append(Shot(
            index=position,
            prompt=body,
            seconds=round(actual, 3),
            requested_seconds=requested,
            duration_source=source,
            frames=frames,
        ))

    total = round(sum(s.seconds for s in shots), 2)
    return Plan(shots=shots, total_seconds=total, notes=notes)
