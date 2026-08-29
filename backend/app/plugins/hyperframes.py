"""Rendering HTML into an MP4 by driving the HyperFrames CLI.

HyperFrames is somebody else's work - github.com/heygen-com/hyperframes,
Apache-2.0, 43,066 stars, published on npm as `hyperframes`. It turns HTML,
CSS and seekable animations into deterministic MP4 video. None of it is
vendored here and none of it is reimplemented; this runs the command and
reports what it says.

That distinction is the whole design. Copying their code into this repository
would mean shipping their work inside SMARAN.AI's installer; running a
command the user installed keeps their code theirs and this code ours, and it
is the same arrangement used for the paperclip and agents-cli plugins.

Worth knowing before it is used: the CLI renders in headless Chrome, so the
first render downloads a browser and a long composition takes minutes. Both
are said plainly rather than discovered halfway through.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("hyperframes_plugin")

INSTALL = "npm install -g hyperframes"


def _find_cli() -> str | None:
    """The hyperframes command, wherever npm put it.

    shutil.which rather than a bare subprocess call: on Windows npm installs a
    .cmd shim, and subprocess without a shell does not apply PATHEXT - the
    same trap that made the paperclip plugin report "not installed" on a
    machine where its CLI ran perfectly from a prompt.
    """
    found = shutil.which("hyperframes")
    if found:
        return found
    for candidate in (
        Path(os.environ.get("APPDATA", "")) / "npm" / "hyperframes.cmd",
        Path.home() / ".npm-global" / "bin" / "hyperframes",
        Path("/usr/local/bin/hyperframes"),
    ):
        if candidate.is_file():
            return str(candidate)
    return None


class HyperFramesPlugin(ToolPlugin):
    """Renders an HTML composition to MP4 using the HyperFrames CLI."""

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.cli = _find_cli()
        self.version = ""
        if self.cli:
            try:
                result = subprocess.run([self.cli, "--version"],
                                        capture_output=True, text=True, timeout=120)
                if result.returncode == 0:
                    self.version = (result.stdout or "").strip()[:20]
                else:
                    self.cli = None
            except Exception:
                self.cli = None

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        if self.cli:
            logger.info("HyperFrames %s found at %s", self.version, self.cli)
            return True
        self.unavailable_reason = (
            "The hyperframes command is not on this machine. It belongs to "
            "heygen-com/hyperframes, a separate Apache-2.0 project; install it "
            "with `%s`. Nothing here is broken." % INSTALL
        )
        logger.info("HyperFrames is not installed; the plugin stays off.")
        return False

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "hyperframes_status",
                "description": "Whether the HyperFrames CLI is installed here, and its version.",
                "parameters": {"type": "object", "properties": {}},
            },
            {
                "name": "hyperframes_render",
                "description": (
                    "Render an HTML composition to MP4. Runs headless Chrome, "
                    "so the first render downloads a browser and a long "
                    "composition takes minutes."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "html": {"type": "string",
                                 "description": "The complete HTML document to render."},
                        "seconds": {"type": "number",
                                    "description": "How long the video should be."},
                    },
                    "required": ["html"],
                },
            },
            {
                "name": "hyperframes_lint",
                "description": (
                    "Check an HTML composition for the mistakes HyperFrames "
                    "knows about, without rendering it."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"html": {"type": "string"}},
                    "required": ["html"],
                },
            },
        ]

    def _run(self, args: List[str], html: str, timeout: int) -> Dict[str, Any]:
        """Write the document to a temporary project and run the command there."""
        if not self.cli:
            return {"error": self.unavailable_reason or "HyperFrames is not installed."}

        work = tempfile.mkdtemp(prefix="smaran_hf_")
        composition = os.path.join(work, "index.html")
        try:
            Path(composition).write_text(html, encoding="utf-8")
            # The commands take the project directory, not the file inside it.
            # Passing the file gave "Not a directory".
            #
            # HYPERFRAMES_TELEMETRY=0 because the CLI reports usage to HeyGen
            # by default and says so on first run - "your account is linked to
            # your usage". SMARAN.AI runs on your machine and sends nothing;
            # quietly turning on someone else's telemetry on your behalf would
            # break that. Run the command yourself if you want it on.
            environment = {**os.environ, "HYPERFRAMES_TELEMETRY": "0",
                           "DO_NOT_TRACK": "1"}
            result = subprocess.run([self.cli, *args, work],
                                    capture_output=True, text=True,
                                    timeout=timeout, cwd=work, env=environment)
            output = ((result.stdout or "") + (result.stderr or "")).strip()
            if result.returncode != 0:
                # The CLI's own words. An invalid composition, a missing
                # browser and a full disk read differently, and whoever is
                # reading this needs to tell them apart.
                return {"ok": False, "exit_code": result.returncode,
                        "output": output[-2000:], "workdir": work}

            produced = [str(p) for p in Path(work).rglob("*.mp4")]
            return {"ok": True, "output": output[-2000:],
                    "files": produced, "workdir": work}
        except subprocess.TimeoutExpired:
            return {"ok": False,
                    "error": "HyperFrames did not finish within %d seconds. A long "
                             "composition can take longer; the first render also "
                             "downloads a browser." % timeout,
                    "workdir": work}
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200], "workdir": work}

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "hyperframes_status":
            return {
                "installed": bool(self.cli),
                "path": self.cli,
                "version": self.version,
                "install": INSTALL,
                "project": "https://github.com/heygen-com/hyperframes",
                "note": (
                    "HyperFrames is a separate Apache-2.0 project. It is not "
                    "bundled with SMARAN.AI and none of it is reimplemented "
                    "here; this runs the command you installed."
                ),
            }

        html = (arguments.get("html") or "").strip()
        if not html:
            return {"error": "There is no HTML to work with."}

        if tool_name == "hyperframes_lint":
            return self._run(["lint"], html, timeout=180)

        if tool_name == "hyperframes_render":
            return self._run(["render"], html, timeout=1800)

        raise ValueError("Unknown HyperFrames tool: %s" % tool_name)


metadata = PluginMetadata(
    name="hyperframes",
    version="1.0.0",
    description=(
        "Renders an HTML composition to MP4 by running the HyperFrames CLI. "
        "Not bundled - install it with `npm install -g hyperframes`."
    ),
    # Written for SMARAN.AI. HyperFrames is HeyGen's Apache-2.0 project; this
    # drives its command line and contains none of its code.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="hyperframes:HyperFramesPlugin",
    dependencies=[],
    config_schema={},
    tags=["video", "html", "render"],
    homepage="https://hyperframes.heygen.com/",
    repository="https://github.com/heygen-com/hyperframes",
    license="MIT",
)
