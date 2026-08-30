"""Bringing Meetily's exported meeting notes into SMARAN.AI's documents.

Meetily is somebody else's work - github.com/Zackriya-Solutions/meetily, MIT,
30,080 stars. It records meetings, transcribes them locally and summarises
them. None of it is here and none of it is reimplemented.

What is worth being plain about is why this reads files rather than calling
an API. Meetily used to publish a FastAPI backend and has withdrawn it; its
own documentation now says the standalone API "must not be treated as a
supported production API". It has no MCP server and no command line either.
Everything it does lives inside its Tauri application.

So there were two dishonest options and one honest one. Building against the
withdrawn API would work today and break on their next release, with the
breakage looking like SMARAN.AI's fault. Reading their SQLite file directly
would work until the schema moved, and they never offered it as an interface.
Neither is a thing to do to somebody else's project.

What Meetily does offer, deliberately and to its users, is export. This
watches the folder you export into and brings new transcripts in through the
same upload path the interface uses, so an imported meeting behaves exactly
like a file you dropped in yourself. If Meetily changes, the worst that
happens is a folder with nothing new in it.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("meetily_plugin")

#: What Meetily writes. Its exports are text; anything else in the folder is
#: somebody else's file and is left alone.
READABLE = {".md", ".txt", ".json", ".vtt", ".srt"}

#: Which files have already been brought in, so a second run does not import
#: the same meeting twice. Kept beside the app's own data.
def _state_path() -> Path:
    from app.config import settings

    return Path(settings.DATA_DIR) / "meetily_imported.json"


def _seen() -> Dict[str, float]:
    try:
        return json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _remember(seen: Dict[str, float]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(seen, indent=2), encoding="utf-8")


def _default_folder() -> Path:
    """Where exports are likely to be, without insisting on it.

    Meetily does not fix an export location - it asks you where to save. The
    Downloads folder is where a "save as" most often lands, so it is the
    starting guess and the tools take a folder argument to override it.
    """
    return Path.home() / "Downloads"


class MeetilyPlugin(ToolPlugin):
    """Imports Meetily's exported meeting notes into a document collection."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        # There is nothing to connect to and nothing to install: this reads a
        # folder. It is ready as soon as it is loaded, and says honestly that
        # it has found nothing rather than claiming a connection it does not
        # have.
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "meetily_scan",
                "description": (
                    "Look for exported meeting notes that have not been "
                    "imported yet. Reads a folder; imports nothing."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "folder": {"type": "string",
                                   "description": "Where you export from Meetily. "
                                                  "Defaults to your Downloads folder."},
                    },
                },
            },
            {
                "name": "meetily_import",
                "description": (
                    "Bring new exported meeting notes into a document "
                    "collection, so you can ask questions about them."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "collection_id": {"type": "integer",
                                          "description": "Which collection to add them to."},
                        "folder": {"type": "string"},
                    },
                    "required": ["collection_id"],
                },
            },
        ]

    @staticmethod
    def _candidates(folder: Path) -> List[Path]:
        """Files in the folder that look like exported meeting notes.

        Matched on the name rather than on everything readable, because a
        Downloads folder is full of other people's files and importing those
        would be worse than importing nothing.
        """
        if not folder.is_dir():
            return []
        hints = ("meeting", "meetily", "transcript", "summary", "minutes")
        found = []
        for path in folder.iterdir():
            if not path.is_file() or path.suffix.lower() not in READABLE:
                continue
            if any(hint in path.name.lower() for hint in hints):
                found.append(path)
        return sorted(found, key=lambda p: p.stat().st_mtime, reverse=True)

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        folder = Path(arguments.get("folder") or _default_folder())
        seen = _seen()
        found = self._candidates(folder)
        fresh = [p for p in found if seen.get(str(p)) != p.stat().st_mtime]

        if tool_name == "meetily_scan":
            return {
                "folder": str(folder),
                "folder_exists": folder.is_dir(),
                "meeting_files": len(found),
                "not_yet_imported": [
                    {"name": p.name, "size_kb": round(p.stat().st_size / 1024, 1)}
                    for p in fresh[:40]
                ],
                "note": (
                    "Matched on names containing meeting, transcript, summary or "
                    "minutes. Meetily does not fix an export folder, so if yours "
                    "is elsewhere, pass it."
                    if found else
                    "Nothing here looks like an exported meeting. Export one from "
                    "Meetily into this folder, or pass the folder you use."
                ),
            }

        if tool_name == "meetily_import":
            if not fresh:
                return {"imported": 0, "folder": str(folder),
                        "note": "Nothing new to import."}

            from app.database import SessionLocal
            from app.models import Collection

            collection_id = int(arguments.get("collection_id"))
            db = SessionLocal()
            try:
                if not db.query(Collection).filter(Collection.id == collection_id).first():
                    return {"error": "There is no collection with id %d." % collection_id}
            finally:
                db.close()

            # Through the same upload path the interface uses, so an imported
            # meeting behaves exactly like a file dropped in by hand rather
            # than something written into the index by a side door.
            import httpx

            base = "http://127.0.0.1:%s" % os.getenv("SMARAN_PORT", "8000")
            done, failed = [], []
            for path in fresh:
                try:
                    with open(path, "rb") as handle:
                        response = httpx.post(
                            "%s/api/collections/%d/upload" % (base, collection_id),
                            files={"file": (path.name, handle)}, timeout=300.0)
                    if response.status_code < 300:
                        done.append(path.name)
                        seen[str(path)] = path.stat().st_mtime
                    else:
                        failed.append("%s: HTTP %d" % (path.name, response.status_code))
                except Exception as exc:
                    failed.append("%s: %s" % (path.name, str(exc)[:70]))

            _remember(seen)
            return {
                "imported": len(done),
                "files": done,
                "failed": failed,
                "collection_id": collection_id,
                "note": ("Imported. Ask about them with document grounding on."
                         if done else "Nothing was imported."),
            }

        raise ValueError("Unknown Meetily tool: %s" % tool_name)


metadata = PluginMetadata(
    name="meetily",
    version="1.0.0",
    description=(
        "Brings meeting notes exported from Meetily into your documents. "
        "Reads exported files - Meetily has no supported API to call."
    ),
    # Written for SMARAN.AI. Meetily is Zackriya Solutions' MIT project; this
    # reads files it exports and contains none of its code.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="meetily:MeetilyPlugin",
    dependencies=[],
    config_schema={},
    tags=["meetings", "transcripts", "documents"],
    homepage="https://meetily.ai/",
    repository="https://github.com/Zackriya-Solutions/meetily",
    license="MIT",
)
