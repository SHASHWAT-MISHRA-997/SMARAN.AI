"""
Paperclip Plugin
================
A plugin that integrates paperclipai/paperclip as a tool for AI agent orchestration.
"""

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType
import logging
import os
import subprocess
import sys
from typing import List, Dict, Any

logger = logging.getLogger("paperclip_plugin")

class PaperclipPlugin(ToolPlugin):
    """Plugin for paperclip"""
    
    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.paperclip_path = None
        self._check_installation()
    
    def _check_installation(self):
        """Check if paperclip is available and install if needed."""
        try:
            # Check if paperclip is available in PATH
            result = subprocess.run(["paperclipai", "--version"], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                logger.info("Paperclip CLI found and ready")
                self.paperclip_path = "paperclipai"
                return
            else:
                logger.warning("Paperclip CLI not found in PATH")
        except FileNotFoundError:
            logger.warning("Paperclip CLI not installed")
        except Exception as e:
            logger.error(f"Failed to check Paperclip CLI: {e}")
        
        # Don't block startup with slow pip install attempts
        repo_path = os.path.join(os.path.dirname(__file__), "paperclip_repo", "cli")
        if os.path.exists(repo_path):
            self.paperclip_path = "paperclipai"
        else:
            logger.info("Paperclip CLI optional tool ready")
            self.paperclip_path = None
    
    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        """Initialize the plugin."""
        if self.paperclip_path is None:
            self._check_installation()
        
        if self.paperclip_path is not None:
            logger.info("Paperclip plugin initialized")
            return True
        else:
            logger.error("Failed to initialize Paperclip plugin")
            return False
    
    async def shutdown(self) -> bool:
        """Cleanup"""
        self.paperclip_path = None
        return True
    
    def get_tools(self) -> List[Dict]:
        """Return the tools provided by this plugin."""
        if not self.paperclip_path:
            return []
        
        # Get available commands from paperclip help
        try:
            result = subprocess.run([self.paperclip_path, "--help"], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                # Extract common commands (simplified)
                commands = [
                    "agent", "team", "task", "company", "skill", 
                    "marketplace", "dashboard", "logs", "config"
                ]
                
                tools = []
                for cmd in commands:
                    tools.append({
                        "name": f"paperclip_{cmd}",
                        "description": f"Run paperclipai {cmd} command",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "args": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": f"Arguments to pass to paperclipai {cmd}"
                                }
                            }
                        }
                    })
                return tools
        except Exception as e:
            logger.error(f"Failed to get paperclip commands: {e}")
        
        # Fallback to generic tool
        return [
            {
                "name": "paperclip_run",
                "description": "Run a command using paperclipai",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The paperclipai command to run"
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
        if not self.paperclip_path:
            raise RuntimeError("Paperclip CLI not available")
        
        # Handle specific command tools (e.g., paperclip_agent)
        if tool_name.startswith("paperclip_"):
            command = tool_name[len("paperclip_"):]
            args = arguments.get("args", [])
        elif tool_name == "paperclip_run":
            command = arguments.get("command")
            args = arguments.get("args", [])
            if not command:
                raise ValueError("command is required for paperclip_run tool")
        else:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        # Build the full command
        full_command = [self.paperclip_path, command] + args
        
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
            raise RuntimeError(f"Paperclip CLI command '{command}' timed out after 60 seconds")
        except Exception as e:
            raise RuntimeError(f"Failed to execute paperclip: {e}")

# Plugin metadata
metadata = PluginMetadata(
    name="paperclip",
    version="0.3.1",
    description="Integrates paperclipai/paperclip for AI agent orchestration",
    author="paperclipai",
    plugin_type=PluginType.TOOL,
    entry_point="paperclip:PaperclipPlugin",
    dependencies=[],
    config_schema={},
    tags=["paperclip", "ai", "agents", "orchestration", "cli"],
    homepage="https://github.com/paperclipai/paperclip",
    repository="https://github.com/paperclipai/paperclip",
    license="MIT"
)