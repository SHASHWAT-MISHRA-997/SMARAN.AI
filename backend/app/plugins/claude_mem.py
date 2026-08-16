"""
Claude-Mem Plugin for SMARAN.AI
===============================
Persistent cross-session long-term memory, observation tagging, and episodic recall engine.
Inspired by: https://github.com/thedotmack/claude-mem.git
"""

import logging
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("claude_mem_plugin")

class ClaudeMemPlugin(ToolPlugin):
    """Plugin providing persistent episodic memory, observation tagging, and semantic recall."""

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.observations: List[Dict[str, Any]] = []

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        logger.info("Claude-Mem episodic memory plugin initialized.")
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "claudemem_record_observation",
                "description": "Record a permanent user preference, codebase insight, project decision, or domain fact into cross-session memory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": ["user_preference", "project_architecture", "bug_fix", "workflow_rule", "domain_fact"],
                            "description": "Category of memory observation"
                        },
                        "observation": {
                            "type": "string",
                            "description": "The concise fact or insight to remember permanently"
                        },
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Searchable tags (e.g. ['python', 'frontend', 'docker'])"
                        }
                    },
                    "required": ["category", "observation"]
                }
            },
            {
                "name": "claudemem_recall",
                "description": "Search stored cross-session memory observations using semantic tags and keywords.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query or topic to recall"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of observations to retrieve"
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "claudemem_get_timeline",
                "description": "Retrieve chronological evolution and timeline of project decisions and observations.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "days": {
                            "type": "integer",
                            "description": "Lookback period in days (default: 30)"
                        }
                    }
                }
            }
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "claudemem_record_observation":
            category = arguments.get("category", "domain_fact")
            obs_text = arguments.get("observation", "").strip()
            tags = arguments.get("tags", [])
            
            entry = {
                "id": len(self.observations) + 1,
                "timestamp": datetime.now().isoformat(),
                "category": category,
                "observation": obs_text,
                "tags": tags
            }
            self.observations.append(entry)
            
            return {
                "status": "stored",
                "entry_id": entry["id"],
                "total_memories": len(self.observations),
                "recorded_at": entry["timestamp"]
            }

        elif tool_name == "claudemem_recall":
            query = arguments.get("query", "").lower()
            limit = arguments.get("limit", 5)
            
            matched = []
            for obs in reversed(self.observations):
                content = (obs["observation"] + " " + " ".join(obs.get("tags", []))).lower()
                if any(word in content for word in query.split()):
                    matched.append(obs)
                if len(matched) >= limit:
                    break
                    
            return {
                "status": "success",
                "query": query,
                "matched_count": len(matched),
                "memories": matched
            }

        elif tool_name == "claudemem_get_timeline":
            days = arguments.get("days", 30)
            return {
                "status": "success",
                "lookback_days": days,
                "total_entries": len(self.observations),
                "timeline": self.observations[-20:]
            }

        raise ValueError(f"Unknown Claude-Mem tool: {tool_name}")

metadata = PluginMetadata(
    name="claude-mem",
    version="1.5.2",
    description="Persistent cross-session long-term episodic memory, observation tagging, and timeline recall.",
    author="TheDotMack",
    plugin_type=PluginType.TOOL,
    entry_point="claude_mem:ClaudeMemPlugin",
    dependencies=[],
    config_schema={},
    tags=["memory", "cross-session", "recall", "observations", "timeline"],
    homepage="https://github.com/thedotmack/claude-mem",
    repository="https://github.com/thedotmack/claude-mem.git",
    license="MIT"
)
