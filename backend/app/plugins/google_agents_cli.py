"""
Google Agents CLI Plugin
=======================
A plugin that integrates google/agents-cli as a tool.
"""

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType
import logging
import os
import subprocess
import sys
from typing import List, Dict, Any

logger = logging.getLogger("google_agents_cli_plugin")

class GoogleAgentsCLIPlugin(ToolPlugin):
    """Plugin for google/agents-cli"""
    
    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.agents_cli_path = None
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
    
    def get_tools(self) -> List[Dict]:
        """Return the tools provided by this plugin."""
        if not self.agents_cli_path:
            return []
        
        # Get available commands from agents-cli help
        try:
            result = subprocess.run(["agents-cli", "--help"], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                # Parse help to extract commands (simplified)
                # In a real implementation, we'd parse this more carefully
                commands = [
                    "setup", "update", "login", "create", "playground", 
                    "run", "lint", "install", "data-ingestion", "eval", 
                    "grade", "scaffold", "deploy", "publish", "infra", "info"
                ]
                
                tools = []
                for cmd in commands:
                    tools.append({
                        "name": f"agents_cli_{cmd}",
                        "description": f"Run agents-cli {cmd} command",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "args": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": f"Arguments to pass to agents-cli {cmd}"
                                }
                            }
                        }
                    })
                return tools
        except Exception as e:
            logger.error(f"Failed to get agents-cli commands: {e}")
        
        # Fallback to generic tool
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
        
        # Handle specific command tools (e.g., agents_cli_setup)
        if tool_name.startswith("agents_cli_"):
            command = tool_name[len("agents_cli_"):]
            args = arguments.get("args", [])
        elif tool_name == "agents_cli_run":
            command = arguments.get("command")
            args = arguments.get("args", [])
            if not command:
                raise ValueError("command is required for agents_cli_run tool")
        else:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        # Build the full command
        full_command = [self.agents_cli_path, command] + args
        
        try:
            result = subprocess.run(full_command, 
                                  capture_output=True, text=True, timeout=60)
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