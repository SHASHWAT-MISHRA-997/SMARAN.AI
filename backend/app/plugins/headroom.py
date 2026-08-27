"""Making a prompt smaller, and counting the saving in tokens.

Headroom is somebody else's project — github.com/headroomlabs-ai/headroom,
Apache-2.0, 67,700 stars at the time of writing, published as `headroom-ai`
on PyPI. It compresses tool output, logs, files and RAG chunks before they
reach a model. None of that is reimplemented here. If the library is
installed this hands the work to it; if it is not, a much smaller local
tidy-up runs instead and says which one did the work.

The version this replaced was the least dishonest of the plugins: it really
did collapse whitespace and strip four filler words, and it really did
measure the reduction. Two things were still wrong. It called that "semantic
compression", which it is not — it is a regular expression and a four-word
blocklist. And it counted `len(text.split())` and labelled the result
tokens; words are not tokens, and for the model that matters the difference
is about a quarter.

tiktoken is already a dependency here, so the counts below are real token
counts. Where tiktoken is missing it says the number is a word count.

One trap worth recording: `pip install headroom` fetches an unrelated
project — a command-line assistant at version 0.2.7. The compression library
is `headroom-ai`.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("headroom_plugin")

INSTALL = 'pip install "headroom-ai[all]"'


def _count(text: str) -> dict:
    """Tokens if tiktoken is here, words otherwise, and it says which."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return {"n": len(enc.encode(text)), "unit": "tokens",
                "counted_with": "tiktoken cl100k_base"}
    except Exception:
        return {"n": len(text.split()), "unit": "words",
                "counted_with": "whitespace split - tiktoken is not installed, "
                                "so this is a word count, not a token count"}


def _library():
    """The real Headroom, if it is installed."""
    try:
        from headroom import compress   # type: ignore
        return compress
    except Exception:
        return None


def _local_tidy(text: str, aggressive: bool) -> str:
    """The small local fallback. Whitespace and filler; nothing clever."""
    out = re.sub(r"\n{3,}", "\n\n", text)
    out = re.sub(r"[ \t]{2,}", " ", out)
    if aggressive:
        for filler in (r"\bplease\b", r"\bkindly\b", r"\bas mentioned (?:previously|above)\b",
                       r"\bin order to\b", r"\bit is important to note that\b",
                       r"\bneedless to say\b", r"\bbasically\b", r"\bactually\b"):
            out = re.sub(filler, "", out, flags=re.IGNORECASE)
        out = re.sub(r"[ \t]{2,}", " ", out)
        out = re.sub(r" +([,.;:])", r"\1", out)
    return out.strip()


class HeadroomPlugin(ToolPlugin):
    """Compresses a prompt with Headroom if present, or a local tidy if not."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "headroom_status",
                "description": (
                    "Whether the headroom-ai library is installed here, and "
                    "how counting is done."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
            {
                "name": "headroom_compress",
                "description": (
                    "Shrink text before it goes to a model. Uses headroom-ai "
                    "when installed; otherwise a small local tidy. Reports "
                    "which ran and the measured saving."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "aggressive": {
                            "type": "boolean",
                            "description": "Also strip filler words (local mode only).",
                        },
                    },
                    "required": ["text"],
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "headroom_status":
            counting = _count("probe")
            return {
                "library_installed": _library() is not None,
                "install": INSTALL,
                "counting": counting["counted_with"],
                "project": "https://github.com/headroomlabs-ai/headroom",
                "docs": "https://docs.headroomlabs.ai/docs",
                "warning": (
                    "`pip install headroom` is a different project. The "
                    "compression library is `headroom-ai`."
                ),
                "note": (
                    "Headroom is not bundled and none of it is reimplemented "
                    "here. Without it, a small local whitespace and filler "
                    "tidy runs instead, which is far less than Headroom does."
                ),
            }

        if tool_name == "headroom_compress":
            text = arguments.get("text") or ""
            if not text.strip():
                return {"error": "There is nothing to compress."}

            before = _count(text)
            compress = _library()

            if compress is not None:
                try:
                    result = compress([{"role": "user", "content": text}])
                    # The library's return shape is its own; take the text out
                    # of whatever it hands back rather than assuming a key.
                    if isinstance(result, dict):
                        messages = result.get("messages") or []
                    else:
                        messages = result or []
                    out = "\n".join(
                        m.get("content", "") for m in messages
                        if isinstance(m, dict)
                    ) or text
                    engine = "headroom-ai"
                except Exception as exc:
                    logger.warning("headroom-ai failed, using the local tidy: %s", exc)
                    out = _local_tidy(text, bool(arguments.get("aggressive")))
                    engine = "local tidy (headroom-ai raised: %s)" % str(exc)[:80]
            else:
                out = _local_tidy(text, bool(arguments.get("aggressive")))
                engine = "local tidy"

            after = _count(out)
            saved = before["n"] - after["n"]
            return {
                "engine": engine,
                "compressed": out,
                "before": before["n"],
                "after": after["n"],
                "saved": saved,
                "unit": before["unit"],
                "reduction_percent": (round(saved / before["n"] * 100, 1)
                                      if before["n"] else 0.0),
                "counted_with": before["counted_with"],
                "note": (
                    "Measured on this text, not a claimed average. The local "
                    "tidy only removes whitespace and filler; it is not "
                    "semantic compression and does not pretend to be."
                    if engine.startswith("local") else
                    "Compressed by headroom-ai and measured before and after."
                ),
            }

        raise ValueError("Unknown Headroom tool: %s" % tool_name)


metadata = PluginMetadata(
    name="headroom",
    version="2.0.0",
    description=(
        "Compresses text before it reaches a model, using headroom-ai when "
        "installed and a small local tidy when not. Counts real tokens."
    ),
    # Written for SMARAN.AI. Headroom is a separate Apache-2.0 project by
    # Headroom Labs; this calls it and does not reimplement it. The earlier
    # metadata named them as the author of this file, which was not true.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="headroom:HeadroomPlugin",
    dependencies=[],
    config_schema={},
    tags=["compression", "tokens", "context"],
    homepage="https://docs.headroomlabs.ai/docs",
    repository="https://github.com/headroomlabs-ai/headroom",
    license="Apache-2.0",
)
