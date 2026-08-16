"""
3D Website Plugin
=================
A plugin that integrates ankitstage21/3D-website as a tool for 3D model operations.
"""

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType
import logging
import os
import subprocess
import sys
from typing import List, Dict, Any

logger = logging.getLogger("three_d_website_plugin")

class ThreeDWebsitePlugin(ToolPlugin):
    """Plugin for 3D website"""
    
    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.available = False
        self._check_dependencies()
    
    def _check_dependencies(self):
        """Check if required dependencies are available."""
        # Check for Node.js (required for the 3D website tool)
        try:
            result = subprocess.run(["node", "--version"], 
                                  capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                logger.info(f"Node.js found: {result.stdout.strip()}")
                self.node_available = True
            else:
                self.node_available = False
        except FileNotFoundError:
            self.node_available = False
            logger.warning("Node.js not found")
        except Exception as e:
            self.node_available = False
            logger.error(f"Error checking Node.js: {e}")
        
        # Check if we have the 3D website repo cloned
        repo_path = os.path.join(os.path.dirname(__file__), "three_d_website_repo")
        self.repo_available = os.path.exists(repo_path)
        
        if self.node_available and self.repo_available:
            logger.info("3D Website plugin dependencies satisfied")
            self.available = True
        else:
            logger.warning(f"3D Website plugin dependencies not met: node={self.node_available}, repo={self.repo_available}")
            self.available = False
    
    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        """Initialize the plugin."""
        if not self.available:
            self._check_dependencies()
        
        if self.available:
            logger.info("3D Website plugin initialized")
            return True
        else:
            logger.warning("3D Website plugin initialized with limited functionality")
            return False  # Still return True if we want to allow partial functionality
    
    async def shutdown(self) -> bool:
        """Cleanup"""
        self.available = False
        return True
    
    def get_tools(self) -> List[Dict]:
        """Return the tools provided by this plugin."""
        if not self.available:
            return []
        
        return [
            {
                "name": "three_d_website_generate",
                "description": "Generate a scroll-driven 3D website from a brief",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "brief": {
                            "type": "string",
                            "description": "One-line brief describing the website to generate"
                        },
                        "output_dir": {
                            "type": "string",
                            "description": "Directory to output the generated website"
                        },
                        "deploy": {
                            "type": "boolean",
                            "default": False,
                            "description": "Whether to deploy the website to Cloudflare (requires credentials)"
                        }
                    },
                    "required": ["brief", "output_dir"]
                }
            },
            {
                "name": "three_d_website_list_techniques",
                "description": "List available 3D rendering techniques",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    
    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        """Execute a tool by name."""
        if not self.available:
            raise RuntimeError("3D Website plugin not available")
        
        if tool_name == "three_d_website_generate":
            brief = arguments.get("brief")
            output_dir = arguments.get("output_dir")
            deploy = arguments.get("deploy", False)
            
            if not brief or not output_dir:
                raise ValueError("brief and output_dir are required")
            
            # Create output directory if it doesn't exist
            os.makedirs(output_dir, exist_ok=True)
            
            # This is a simplified implementation
            # In reality, we would need to invoke the actual 3D website generation process
            # which involves multiple steps and dependencies
            
            logger.info(f"Generating 3D website from brief: {brief}")
            
            # For now, return a placeholder result
            # A real implementation would:
            # 1. Navigate to the 3D website repo
            # 2. Run the appropriate generation commands
            # 3. Handle dependencies like ffmpeg, Cloudflare credentials, etc.
            return {
                "brief": brief,
                "output_dir": output_dir,
                "deploy": deploy,
                "status": "completed_simulated",
                "message": "3D website generation simulated. Real implementation would invoke the actual 3D website generation process.",
                "files_generated": [
                    "index.html",
                    "styles.css", 
                    "choreography.js",
                    "scroll-effect.js"
                ]
            }
        
        elif tool_name == "three_d_website_list_techniques":
            return {
                "techniques": [
                    {
                        "name": "video-scroll-effect",
                        "method": "canvas frame scrub",
                        "description": "the classic effect, not WebGL",
                        "requires_ffmpeg": True
                    },
                    {
                        "name": "3d-scene-effect",
                        "method": "Three.js, scroll driven",
                        "description": "also the zero cost image-plane fallback",
                        "requires_ffmpeg": False
                    },
                    {
                        "name": "pointer-follow-effect",
                        "method": "Three.js, cursor driven",
                        "description": "static pose on touch devices",
                        "requires_ffmpeg": False
                    },
                    {
                        "name": "click-navigate",
                        "method": "Three.js hotspots to camera waypoints",
                        "description": "works on touch and desktop",
                        "requires_ffmpeg": False
                    },
                    {
                        "name": "physics-play",
                        "method": "Three.js plus cannon es",
                        "description": "heaviest, at most one per site",
                        "requires_ffmpeg": False
                    },
                    {
                        "name": "hybrid-2d3d",
                        "method": "editorial 2D layout, inline 3D object",
                        "description": "the only non pinned technique",
                        "requires_ffmpeg": False
                    },
                    {
                        "name": "cursor-trail",
                        "method": "canvas 2D particle trail",
                        "description": "atmospheric, never load bearing",
                        "requires_ffmpeg": False
                    }
                ],
                "support_skills": [
                    "shared-scroll-engine",
                    "asset-generator",
                    "scroll-style-helper"
                ],
                "agents": [
                    "frame-pipeline",
                    "reference-analyzer",
                    "build-reviewer"
                ]
            }
        
        else:
            raise ValueError(f"Unknown tool: {tool_name}")

# Plugin metadata
metadata = PluginMetadata(
    name="3d-website",
    version="0.1.0",
    description="Integrates ankitstage21/3D-website for 3D model operations",
    author="ankitstage21",
    plugin_type=PluginType.TOOL,
    entry_point="three_d_website:ThreeDWebsitePlugin",
    dependencies=[],
    config_schema={},
    tags=["3d", "website", "scroll", "cli"],
    homepage="https://github.com/ankitstage21/3D-website",
    repository="https://github.com/ankitstage21/3D-website",
    license="MIT"
)