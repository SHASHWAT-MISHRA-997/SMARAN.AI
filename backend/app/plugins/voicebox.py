"""Speaking and transcribing through Voicebox, when it is running.

Voicebox is somebody else's work - github.com/jamiepine/voicebox, MIT,
51,841 stars, built with Tauri. It clones voices, speaks in them and
transcribes with Whisper. None of it is vendored here and none of it is
reimplemented; it publishes a REST API on 127.0.0.1:17493 and this calls it.

That is the whole arrangement, and it is deliberate. Voicebox is a desktop
application distributed as an MSI or a DMG, not a library - there is nothing
to bundle even if bundling were right, and its API is the interface its
author built for exactly this. So it stays their program on your machine,
and this stays a client.

It is not started here either. Launching somebody's voice studio because a
plugin loaded would be a surprise; if it is not running, that is said and
nothing else happens.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("voicebox_plugin")

#: The port Voicebox's own documentation gives.
BASE = "http://127.0.0.1:17493"


def _reachable(timeout: float = 2.0) -> bool:
    """Whether Voicebox is answering right now.

    Asked of the port rather than of an installed file: Voicebox can be
    installed and closed, and a closed program cannot speak. "Installed" and
    "running" are different answers and the second is the one that matters.
    """
    try:
        import httpx

        return httpx.get(f"{BASE}/profiles", timeout=timeout).status_code == 200
    except Exception:
        return False


class VoiceboxPlugin(ToolPlugin):
    """Talks to a running Voicebox over its local REST API."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        if _reachable():
            logger.info("Voicebox is answering on %s", BASE)
            self._initialized = True
            return True
        self.unavailable_reason = (
            "Voicebox is not answering on 127.0.0.1:17493. It is a separate "
            "MIT project - github.com/jamiepine/voicebox - and it has to be "
            "installed and open for this to reach it. Nothing here is broken."
        )
        logger.info("Voicebox is not running; the plugin stays off.")
        return False

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "voicebox_status",
                "description": "Whether Voicebox is running, and which voices it has.",
                "parameters": {"type": "object", "properties": {}},
            },
            {
                "name": "voicebox_speak",
                "description": (
                    "Say something aloud in one of your Voicebox voices. "
                    "Plays on this machine through Voicebox itself."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "What to say."},
                        "profile": {"type": "string",
                                    "description": "Which voice. Omit for the default."},
                    },
                    "required": ["text"],
                },
            },
            {
                "name": "voicebox_transcribe",
                "description": (
                    "Transcribe an audio file with Voicebox's Whisper. Give a "
                    "path on this machine."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string",
                                 "description": "Audio file to transcribe."},
                    },
                    "required": ["path"],
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        import httpx

        if not _reachable():
            return {"error": ("Voicebox is not answering on 127.0.0.1:17493. "
                              "Open it and try again."),
                    "project": "https://github.com/jamiepine/voicebox"}

        if tool_name == "voicebox_status":
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    profiles = (await client.get(f"{BASE}/profiles")).json()
            except Exception as exc:
                return {"error": "Could not read the voice list: %s" % str(exc)[:140]}
            names = [p.get("name") for p in (profiles if isinstance(profiles, list)
                                             else profiles.get("profiles", []))
                     if isinstance(p, dict) and p.get("name")]
            return {
                "running": True,
                "address": BASE,
                "voices": names,
                "note": ("Voicebox is a separate MIT project. It is not bundled "
                         "with SMARAN.AI and none of it is reimplemented here; "
                         "this calls the API it publishes."),
            }

        if tool_name == "voicebox_speak":
            text = (arguments.get("text") or "").strip()
            if not text:
                return {"error": "There is nothing to say."}
            payload: Dict[str, Any] = {"text": text}
            if arguments.get("profile"):
                payload["profile"] = arguments["profile"]
            try:
                # Speaking is as long as the sentence; a short timeout would
                # cut off anything but a phrase.
                async with httpx.AsyncClient(timeout=180.0) as client:
                    response = await client.post(
                        f"{BASE}/speak", json=payload,
                        headers={"X-Voicebox-Client-Id": "smaran-ai"})
            except Exception as exc:
                return {"error": "Voicebox did not answer: %s" % str(exc)[:140]}
            if response.status_code != 200:
                return {"error": "Voicebox returned HTTP %d: %s"
                                 % (response.status_code, response.text[:180])}
            return {"spoke": text[:200], "voice": arguments.get("profile") or "default"}

        if tool_name == "voicebox_transcribe":
            import os

            path = (arguments.get("path") or "").strip()
            if not os.path.isfile(path):
                return {"error": "There is no file at %s" % path}
            try:
                async with httpx.AsyncClient(timeout=600.0) as client:
                    with open(path, "rb") as handle:
                        response = await client.post(
                            f"{BASE}/transcribe",
                            files={"file": (os.path.basename(path), handle)})
            except Exception as exc:
                return {"error": "Voicebox did not answer: %s" % str(exc)[:140]}
            if response.status_code != 200:
                return {"error": "Voicebox returned HTTP %d: %s"
                                 % (response.status_code, response.text[:180])}
            return {"file": os.path.basename(path), "result": response.json()}

        raise ValueError("Unknown Voicebox tool: %s" % tool_name)


metadata = PluginMetadata(
    name="voicebox",
    version="1.0.0",
    description=(
        "Speaks and transcribes through Voicebox, when Voicebox is running. "
        "Not bundled - install it from voicebox.sh and open it."
    ),
    # Written for SMARAN.AI. Voicebox is Jamie Pine's MIT project; this calls
    # the API it publishes and contains none of its code.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="voicebox:VoiceboxPlugin",
    dependencies=[],
    config_schema={},
    tags=["voice", "speech", "transcription"],
    homepage="https://voicebox.sh/",
    repository="https://github.com/jamiepine/voicebox",
    license="MIT",
)
