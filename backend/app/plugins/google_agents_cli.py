"""
Google Agents CLI Plugin
=======================
A plugin that integrates google/agents-cli as a tool.
"""

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType
import logging
import asyncio
import os
import re
import subprocess
import sys
from typing import List, Dict, Any, Optional

logger = logging.getLogger("google_agents_cli_plugin")

class GoogleAgentsCLIPlugin(ToolPlugin):
    """Plugin for google/agents-cli"""
    
    # A command line in `--help`: indentation, the name, then the description
    # separated by at least two spaces.
    _COMMAND_RE = re.compile(r"^(\s+)([A-Za-z][\w-]*)(?:\s{2,}(.*))?$")
    # agents-cli keeps retired commands listed so it can explain where they
    # went. Offering them as tools would advertise something that only ever
    # returns an error.
    _RETIRED_RE = re.compile(r"^(removed|deprecated|no longer)\b", re.I)

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.agents_cli_path = None
        # get_tools() is called while serving requests, and asking the CLI
        # what it can do costs a subprocess launch each time. Discovered once,
        # after the path is known.
        self._commands: Optional[List[Dict[str, str]]] = None
        # This used to run in a background thread while initialize() read the
        # result, which is a race it usually lost: the plugin reported the CLI
        # missing on a machine that had it. Looking for a file is fast enough
        # to just do.
        self._check_installation()

    @staticmethod
    def _candidates():
        """Where agents-cli ends up, in the order worth trying.

        Bare "agents-cli" only finds it if the server's PATH happens to
        include the installer's bin directory, and `uv tool install` puts it
        in ~/.local/bin, which a service started from elsewhere does not
        inherit. So the known locations are checked directly.
        """
        import shutil
        from pathlib import Path

        found = shutil.which("agents-cli")
        if found:
            yield found

        home = Path.home()
        for path in (
            home / ".local" / "bin" / "agents-cli.exe",
            home / ".local" / "bin" / "agents-cli",
            home / ".local" / "bin" / "agents-cli.cmd",
        ):
            if path.is_file():
                yield str(path)

    def _check_installation(self):
        """Whether agents-cli is here, asked of the machine."""
        for candidate in self._candidates():
            try:
                # 5 seconds was tight: a uv-installed tool resolves its
                # environment on first run and can take longer than that.
                result = subprocess.run([candidate, "--version"],
                                        capture_output=True, text=True, timeout=30)
                if result.returncode == 0:
                    self.agents_cli_path = candidate
                    logger.info("Google Agents CLI found at %s (%s)",
                                candidate, (result.stdout or "").strip()[:40])
                    return
            except Exception:
                continue
        self.agents_cli_path = None
    
    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        """Ready only if the CLI it drives is actually here.

        This used to return True unconditionally and then expose no tools,
        which left the interface showing a plugin that was running and could
        do nothing.
        """
        if self.agents_cli_path:
            logger.info("Google Agents CLI found at %s", self.agents_cli_path)
            return True

        # Named as a setup step, not a failure: the app is fine, the CLI is
        # simply not installed. The package name is worth stating because it
        # differs from the command - `pip install agents-cli` fetches nothing,
        # since the project publishes as google-agents-cli.
        self.unavailable_reason = (
            "The agents-cli command is not on this machine. It belongs to "
            "google/agents-cli, a separate Apache-2.0 project; install it "
            "with `uvx google-agents-cli setup` - note the PyPI package is "
            "google-agents-cli even though the command is agents-cli. "
            "Nothing here is broken."
        )
        logger.info("Google Agents CLI is not installed; the plugin stays off.")
        return False
    
    async def shutdown(self) -> bool:
        """Cleanup"""
        self.agents_cli_path = None
        return True
    
    @classmethod
    def _parse_commands(cls, help_text: str) -> List[Dict[str, str]]:
        """The commands agents-cli says it has, read out of its own --help.

        This used to be a hand-written list, which drifted: it advertised a
        `grade` command that the CLI answers with "No such command 'grade'"
        (grading moved under `eval`). A list that has to be edited by hand
        whenever the upstream project changes will be wrong again, so the
        names now come from the CLI itself.
        """
        commands: List[Dict[str, str]] = []
        in_section = False
        base_indent = None

        for raw in (help_text or "").splitlines():
            line = raw.rstrip()
            if not line:
                continue
            if not line[:1].isspace():
                # Section headers sit at the left margin, so any of them ends
                # the command list - including "Options:" printed after it.
                in_section = line.strip().lower().rstrip(":") == "commands"
                base_indent = None
                continue
            if not in_section:
                continue

            indent = len(line) - len(line.lstrip())
            if base_indent is None:
                base_indent = indent
            if indent > base_indent and commands:
                # A description wrapped onto the next line.
                commands[-1]["description"] = (
                    commands[-1]["description"] + " " + line.strip()
                ).strip()
                continue

            match = cls._COMMAND_RE.match(line)
            if not match:
                continue
            commands.append({
                "name": match.group(2),
                "description": (match.group(3) or "").strip(),
            })

        return [c for c in commands if not cls._RETIRED_RE.match(c["description"])]

    def _discover_commands(self) -> List[Dict[str, str]]:
        """Ask the CLI what it can do, once, and remember the answer."""
        if self._commands is not None:
            return self._commands
        if not self.agents_cli_path:
            return []

        try:
            result = subprocess.run(
                [self.agents_cli_path, "--help"],
                capture_output=True, text=True,
                # agents-cli prints box-drawing characters, and the Windows
                # console default encoding cannot represent them.
                encoding='utf-8', errors='replace', timeout=30)
        except Exception as exc:
            # Left uncached: a timeout here is worth retrying later, and the
            # generic tool below still works in the meantime.
            logger.warning("Could not ask agents-cli for its commands: %s", exc)
            return []

        if result.returncode != 0:
            logger.warning("agents-cli --help exited %s; using the generic tool",
                           result.returncode)
            return []

        self._commands = self._parse_commands(result.stdout or "")
        if not self._commands:
            logger.warning("No commands found in agents-cli --help output.")
        return self._commands

    def get_tools(self) -> List[Dict]:
        """Return the tools provided by this plugin."""
        if not self.agents_cli_path:
            return []

        tools = []
        for command in self._discover_commands():
            tools.append({
                "name": f"agents_cli_{command['name'].replace('-', '_')}",
                "description": command["description"] or f"Run agents-cli {command['name']}",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "args": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": f"Arguments to pass to agents-cli {command['name']}"
                        }
                    }
                }
            })
        if tools:
            return tools

        # Discovery failed. Rather than guess at a command list, offer the one
        # tool that is true regardless: pass a command through and report what
        # the CLI says about it.
        return [
            {
                "name": "agents_cli_run",
                "description": "Run a command using google/agents-cli",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The agents-cli command to run"
                        },
                        "args": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Arguments to pass to the command"
                        }
                    },
                    "required": ["command"]
                }
            }
        ]
    
    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        """Execute a tool by name."""
        if not self.agents_cli_path:
            raise RuntimeError("Agents CLI not available")
        
        args = arguments.get("args", []) or []
        # Tool names replace the dashes that command names may contain, so map
        # back through what was discovered rather than guessing the spelling.
        by_tool_suffix = {
            c["name"].replace("-", "_"): c["name"] for c in self._discover_commands()
        }

        if tool_name == "agents_cli_run" and arguments.get("command"):
            # The generic pass-through, offered when discovery came up empty.
            command = arguments["command"]
        elif tool_name.startswith("agents_cli_"):
            suffix = tool_name[len("agents_cli_"):]
            if not suffix:
                raise ValueError(f"Unknown tool: {tool_name}")
            # `agents_cli_run` with no command used to fall through to here and
            # silently become `agents-cli run`, which runs an agent.
            if suffix == "run" and "command" in arguments and not arguments["command"]:
                raise ValueError("command is required for the agents_cli_run tool")
            command = by_tool_suffix.get(suffix, suffix)
        else:
            raise ValueError(f"Unknown tool: {tool_name}")

        # The command becomes argv[1] of a real process. It is not run through
        # a shell, but an unchecked value can still smuggle in an option
        # (`--config=...`) or a path, so only plain command names are accepted.
        if not re.fullmatch(r"[A-Za-z][\w-]*", command or ""):
            raise ValueError(
                f"'{command}' is not a valid agents-cli command name."
            )
        if not all(isinstance(a, str) for a in args):
            raise ValueError("args must be a list of strings.")

        # Build the full command
        full_command = [self.agents_cli_path, command] + args
        
        try:
            result = await asyncio.to_thread(subprocess.run, full_command,
                                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
            if result.returncode:
                raise RuntimeError((result.stderr or result.stdout or 'CLI failed')[-1500:])
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "command": " ".join(full_command)
            }
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Agents CLI command '{command}' timed out after 60 seconds")
        except Exception as e:
            raise RuntimeError(f"Failed to execute agents-cli: {e}")

# Plugin metadata
metadata = PluginMetadata(
    name="google-agents-cli",
    version="1.3.1",
    description="Integrates google/agents-cli as a tool for running AI agents",
    # Written for SMARAN.AI. agents-cli is Google's Apache-2.0 project;
    # this launches it and contains none of its code, so naming Google as
    # the author of this file was not right.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="google_agents_cli:GoogleAgentsCLIPlugin",
    dependencies=[],
    config_schema={},
    tags=["agents", "cli", "google", "adk"],
    homepage="https://github.com/google/agents-cli",
    repository="https://github.com/google/agents-cli",
    license="Apache-2.0"
)

# Note: The plugin will be registered manually in main.py
