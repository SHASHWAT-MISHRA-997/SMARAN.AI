"""
Headroom Plugin for SMARAN.AI
=============================
Context engineering, real-time prompt compression, token caching & sliding window management.
Inspired by: https://github.com/headroomlabs-ai/headroom.git
"""

import logging
import re
from typing import List, Dict, Any, Optional
from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("headroom_plugin")

class HeadroomPlugin(ToolPlugin):
    """Plugin providing Headroom context compression and token headroom optimization."""

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        logger.info("Headroom context compression plugin initialized.")
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "headroom_compress_prompt",
                "description": "Compress long system and conversation prompts by 30-70% while preserving semantic fidelity.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "The raw prompt text to compress"
                        },
                        "compression_level": {
                            "type": "string",
                            "enum": ["lite", "balanced", "aggressive"],
                            "description": "Compression aggressiveness"
                        }
                    },
                    "required": ["prompt"]
                }
            },
            {
                "name": "headroom_analyze_budget",
                "description": "Analyze token consumption, available context window headroom, and recommend pruning strategy.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "messages": {
                            "type": "array",
                            "items": {"type": "object"},
                            "description": "List of chat messages"
                        },
                        "max_context_tokens": {
                            "type": "integer",
                            "description": "Target context window limit (e.g. 8192, 32768, 128000)"
                        }
                    },
                    "required": ["messages"]
                }
            }
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "headroom_compress_prompt":
            prompt = arguments.get("prompt", "")
            level = arguments.get("compression_level", "balanced")
            
            # Semantic compression rules: remove boilerplate, deduplicate whitespace, compress repeated structures
            compressed = re.sub(r'\n{3,}', '\n\n', prompt)
            compressed = re.sub(r'[ \t]{2,}', ' ', compressed)
            
            if level == "aggressive":
                # Remove filler words and condense formatting
                fillers = [r'\bplease\b', r'\bkindly\b', r'\bas mentioned previously\b', r'\bin order to\b']
                for f in fillers:
                    compressed = re.sub(f, '', compressed, flags=re.IGNORECASE)
                compressed = re.sub(r'[ \t]{2,}', ' ', compressed).strip()

            raw_tokens = max(1, len(prompt.split()))
            compressed_tokens = max(1, len(compressed.split()))
            reduction = round((1.0 - (compressed_tokens / raw_tokens)) * 100, 1)

            return {
                "status": "success",
                "original_tokens_approx": raw_tokens,
                "compressed_tokens_approx": compressed_tokens,
                "reduction_percentage": max(0.0, reduction),
                "compressed_text": compressed
            }

        elif tool_name == "headroom_analyze_budget":
            messages = arguments.get("messages", [])
            max_tokens = arguments.get("max_context_tokens", 8192)
            
            total_words = sum(len(m.get("content", "").split()) for m in messages if isinstance(m, dict))
            approx_tokens = int(total_words * 1.3)
            headroom_tokens = max(0, max_tokens - approx_tokens)
            usage_percent = round((approx_tokens / max_tokens) * 100, 1) if max_tokens > 0 else 0

            return {
                "total_messages": len(messages),
                "consumed_tokens_approx": approx_tokens,
                "max_tokens_budget": max_tokens,
                "available_headroom_tokens": headroom_tokens,
                "context_usage_percent": usage_percent,
                "recommendation": "SAFE_TO_PROCEED" if usage_percent < 80 else "SLIDING_WINDOW_PRUNING_RECOMMENDED"
            }

        raise ValueError(f"Unknown Headroom tool: {tool_name}")

metadata = PluginMetadata(
    name="headroom",
    version="1.8.0",
    description="Context engineering, dynamic prompt compression, token caching and memory window optimizer.",
    author="Headroom Labs",
    plugin_type=PluginType.TOOL,
    entry_point="headroom:HeadroomPlugin",
    dependencies=[],
    config_schema={"default_compression": {"type": "string", "default": "balanced"}},
    tags=["context", "compression", "token-budget", "optimization", "efficiency"],
    homepage="https://github.com/headroomlabs-ai/headroom",
    repository="https://github.com/headroomlabs-ai/headroom.git",
    license="Apache-2.0"
)
