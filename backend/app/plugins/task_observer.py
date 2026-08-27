"""Watching the conversation for the places it went wrong.

task-observer is somebody else's work — github.com/rebelytics/one-skill-to-rule-them-all,
CC-BY-4.0, by Rebelytics. It is a meta-skill: prose, not code, that runs
alongside a session, notices the corrections you make and the gaps no skill
covers, and produces an observation log you review. Nothing of it is vendored
here and the methodology is theirs; this is an implementation of the same
idea against SMARAN.AI's own chat history, with attribution as the licence
asks.

The version this replaced did not observe anything. `synthesize_skill`
returned the same three sentences — validate inputs, enforce ownership, keep
audit logs — whatever title or domain you passed it, with
`confidence_score: 0.96` written into the source. It called that
"synthesized". Its event log was a list on the instance, so it emptied every
restart.

This reads chat_messages, which is where the conversation actually is. Every
observation below quotes the message it came from and gives its id, so any
of it can be checked against the row.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("task_observer_plugin")

# Phrases that mark a person putting the assistant right. Chosen because they
# start a correction rather than merely appearing in one, and kept in both
# English and the romanised Hindi this app is used in.
CORRECTION_SIGNALS = [
    (r"^\s*(?:no|nope|nahi|nahin)\b", "direct contradiction"),
    (r"\b(?:actually|i meant|i said|not what i|that's not|thats not)\b", "restating the ask"),
    (r"\b(?:galat|sahi nahi|aisa nahi|ye nahi)\b", "correction in Hindi"),
    (r"\b(?:again|dobara|phir se|wapas)\b.{0,40}\b(?:karo|do|try)\b", "asking for a redo"),
    (r"\b(?:stop|ruko|band karo|mat karo)\b", "asking it to stop"),
    (r"\b(?:why did you|kyun kiya|kyu kiya)\b", "questioning what it did"),
]

# A request repeated in close succession is a signal on its own: the first
# answer did not land.
REPEAT_WINDOW = 4


def _messages(limit: int) -> List[dict]:
    from app.database import SessionLocal
    from app.models import ChatMessage

    db = SessionLocal()
    try:
        rows = (db.query(ChatMessage)
                .order_by(ChatMessage.created_at.desc())
                .limit(limit).all())
        return [{
            "id": r.id, "session": r.session_id, "role": r.role,
            "content": r.content or "", "at": str(r.created_at),
            "model": r.model_used,
        } for r in reversed(rows)]
    finally:
        db.close()


def _observe(messages: List[dict]) -> List[dict]:
    """Corrections and repeats, each tied to the message it came from."""
    seen: List[dict] = []
    recent_user: List[str] = []

    for msg in messages:
        if msg["role"] != "user":
            continue
        text = msg["content"].strip()
        if not text:
            continue
        lowered = text.lower()

        for pattern, kind in CORRECTION_SIGNALS:
            if re.search(pattern, lowered):
                seen.append({
                    "kind": kind,
                    "message_id": msg["id"],
                    "at": msg["at"],
                    "quote": text[:220],
                    "why": ("This looks like the previous answer being put "
                            "right, which is where a skill was unclear."),
                })
                break

        # Near-duplicate asks. Compared on words rather than characters so
        # rewording the same request still matches.
        words = set(re.findall(r"[a-z]{4,}", lowered))
        for earlier in recent_user[-REPEAT_WINDOW:]:
            other = set(re.findall(r"[a-z]{4,}", earlier))
            if not words or not other:
                continue
            overlap = len(words & other) / max(1, len(words | other))
            if overlap >= 0.6 and lowered != earlier:
                seen.append({
                    "kind": "asked again in different words",
                    "message_id": msg["id"],
                    "at": msg["at"],
                    "quote": text[:220],
                    "why": ("A request repeated within %d turns usually means "
                            "the first answer missed." % REPEAT_WINDOW),
                })
                break
        recent_user.append(lowered)

    return seen


class TaskObserverPlugin(ToolPlugin):
    """Reads the real conversation and reports where it went wrong."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "observer_review_session",
                "description": (
                    "Read recent messages and report corrections and repeated "
                    "asks, each quoting the message it came from."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "messages": {"type": "integer",
                                     "description": "How many recent messages to read."},
                    },
                },
            },
            {
                "name": "observer_suggest_skills",
                "description": (
                    "Group the observations into candidate skills. Says how "
                    "many observations each is based on; suggests nothing "
                    "when there is nothing to go on."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "messages": {"type": "integer"},
                    },
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        limit = max(10, min(int(arguments.get("messages") or 300), 2000))

        try:
            messages = _messages(limit)
        except Exception as exc:
            return {"error": "Could not read the conversation: %s" % str(exc)[:160]}

        if not messages:
            return {"observations": [], "read": 0,
                    "note": "There are no messages to observe yet."}

        observations = _observe(messages)

        if tool_name == "observer_review_session":
            return {
                "read": len(messages),
                "user_messages": sum(1 for m in messages if m["role"] == "user"),
                "observations": observations,
                "count": len(observations),
                "note": (
                    "Each observation quotes a real message and gives its id, "
                    "so it can be checked against the row. These are signals, "
                    "not conclusions - a 'no' can be an answer to a question."
                    if observations else
                    "Nothing matched. That means these signals did not appear, "
                    "not that everything went well."
                ),
            }

        if tool_name == "observer_suggest_skills":
            if not observations:
                return {
                    "candidates": [],
                    "read": len(messages),
                    "note": ("No corrections or repeats were found in the last "
                             "%d messages, so there is nothing to base a "
                             "suggestion on." % len(messages)),
                }

            grouped: Dict[str, List[dict]] = {}
            for obs in observations:
                grouped.setdefault(obs["kind"], []).append(obs)

            candidates = [{
                "pattern": kind,
                "occurrences": len(items),
                "examples": [i["quote"][:120] for i in items[:3]],
                "message_ids": [i["message_id"] for i in items[:8]],
            } for kind, items in sorted(grouped.items(), key=lambda kv: -len(kv[1]))]

            return {
                "read": len(messages),
                "candidates": candidates,
                "note": (
                    "Grouped by the signal that produced them, with counts "
                    "and the message ids behind each. No confidence score: "
                    "counting how often something happened is a fact, and "
                    "scoring how much it matters would not be."
                ),
            }

        raise ValueError("Unknown task-observer tool: %s" % tool_name)


metadata = PluginMetadata(
    name="task-observer",
    version="2.0.0",
    description=(
        "Reads the real chat history for corrections and repeated asks, and "
        "quotes the message behind each. Suggests nothing without evidence."
    ),
    # task-observer is a CC-BY-4.0 meta-skill by Rebelytics. The idea and the
    # methodology are theirs and the licence asks for attribution; this file
    # is an implementation against SMARAN.AI's own data, not their work. The
    # earlier metadata named them as its author, which was not true.
    author="SMARAN.AI, after the task-observer methodology by Rebelytics (CC-BY-4.0)",
    plugin_type=PluginType.TOOL,
    entry_point="task_observer:TaskObserverPlugin",
    dependencies=[],
    config_schema={},
    tags=["observation", "corrections", "skills"],
    homepage="https://www.rebelytics.com/task-observer/",
    repository="https://github.com/rebelytics/one-skill-to-rule-them-all",
    license="CC-BY-4.0",
)
