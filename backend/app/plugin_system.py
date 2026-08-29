"""
Plugin System Architecture for SMARAN.AI
=========================================
A modular, extensible plugin system inspired by Claude's architecture.
Supports Plugins, Skills, Connectors, and Tools.
"""

import asyncio
import importlib
import importlib.util
import inspect
import logging
import os
import shutil
import sys
import json
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Type, Union
from pydantic import BaseModel, Field

logger = logging.getLogger("plugin_system")

class PluginType(Enum):
    """Types of plugins in the system"""
    TOOL = "tool"           # Function/tools the AI can call
    SKILL = "skill"         # Reusable prompt/skill templates
    CONNECTOR = "connector" # External service integrations
    PLUGIN = "plugin"       # Full-featured extensions
    PROVIDER = "provider"   # LLM/embedding providers

class PluginStatus(Enum):
    LOADED = "loaded"
    ENABLED = "enabled"
    DISABLED = "disabled"
    ERROR = "error"
    NOT_INSTALLED = "not_installed"

@dataclass
class PluginMetadata:
    """Metadata for a plugin"""
    name: str
    version: str
    description: str
    author: str
    plugin_type: PluginType
    entry_point: str
    dependencies: List[str] = field(default_factory=list)
    config_schema: Dict = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)
    homepage: Optional[str] = None
    repository: Optional[str] = None
    license: Optional[str] = None

class PluginConfig(BaseModel):
    """Configuration for a plugin instance"""
    enabled: bool = True
    config: Dict = Field(default_factory=dict)
    priority: int = 0

class BasePlugin(ABC):
    """Base class for all plugins"""
    
    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        self.config = config
        self.metadata = metadata
        self._initialized = False
    
    @abstractmethod
    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        """Initialize the plugin with app context"""
        pass
    
    @abstractmethod
    async def shutdown(self) -> bool:
        """Cleanup on shutdown"""
        pass
    
    @abstractmethod
    def get_capabilities(self) -> List[str]:
        """Return list of capabilities this plugin provides"""
        pass
    
    def is_enabled(self) -> bool:
        return self.config.enabled

class ToolPlugin(BasePlugin):
    """Plugin that provides tools/functions the AI can call"""
    
    @abstractmethod
    def get_tools(self) -> List[Dict]:
        """Return list of tool definitions (OpenAI function format)"""
        pass
    
    @abstractmethod
    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        """Execute a tool by name"""
        pass
    
    def get_capabilities(self) -> List[str]:
        return [f"tool:{tool['name']}" for tool in self.get_tools()]

class SkillPlugin(BasePlugin):
    """Plugin that provides reusable skills/prompt templates"""
    
    @abstractmethod
    def get_skills(self) -> List[Dict]:
        """Return list of skill definitions"""
        pass
    
    @abstractmethod
    async def execute_skill(self, skill_name: str, context: Dict) -> Any:
        """Execute a skill by name"""
        pass
    
    def get_capabilities(self) -> List[str]:
        return [f"skill:{skill['name']}" for skill in self.get_skills()]

class ConnectorPlugin(BasePlugin):
    """Plugin that connects to external services"""
    
    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection to external service"""
        pass
    
    @abstractmethod
    async def disconnect(self) -> bool:
        """Close connection to external service"""
        pass
    
    @abstractmethod
    def get_operations(self) -> List[Dict]:
        """Return list of operations this connector provides"""
        pass

    async def execute_operation(self, operation_name: str, parameters: Dict) -> Any:
        """Execute a connector operation"""
        raise NotImplementedError(f"Operation {operation_name} not implemented")
    
    def get_capabilities(self) -> List[str]:
        return [f"connector:{op['name']}" for op in self.get_operations()]

class ProviderPlugin(BasePlugin):
    """Plugin that provides LLM/embedding models"""
    
    @abstractmethod
    async def list_models(self) -> List[Dict]:
        """List available models"""
        pass
    
    @abstractmethod
    async def chat_completion(self, messages: List[Dict], **kwargs) -> Dict:
        """Generate chat completion"""
        pass
    
    @abstractmethod
    async def embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings"""
        pass
    
    def get_capabilities(self) -> List[str]:
        return ["provider:chat", "provider:embeddings"]

class PluginManager:
    """Manages the lifecycle of all plugins"""
    
    def __init__(self):
        self.plugins: Dict[str, BasePlugin] = {}
        self.metadata: Dict[str, PluginMetadata] = {}
        self.configs: Dict[str, PluginConfig] = {}
        self.app_context: Dict[str, Any] = {}
        self._hooks: Dict[str, List[Callable]] = {}
        # Registration, configuration and runtime availability are deliberately
        # separate.  A class being imported is not proof that its dependencies,
        # credentials or remote service are ready.
        self._load_errors: Dict[str, str] = {}
        #: Not an error: the plugin works, its external tool is absent.
        self._setup_required: Dict[str, str] = {}
        self._load_attempted: Dict[str, bool] = {}
    
    def set_app_context(self, context: Dict[str, Any]):
        """Set the application context available to plugins"""
        self.app_context = context
    
    def register_hook(self, hook_name: str, callback: Callable):
        """Register a hook that plugins can call"""
        if hook_name not in self._hooks:
            self._hooks[hook_name] = []
        self._hooks[hook_name].append(callback)
    
    async def trigger_hook(self, hook_name: str, *args, **kwargs) -> List[Any]:
        """Trigger all callbacks for a hook"""
        results = []
        for callback in self._hooks.get(hook_name, []):
            try:
                result = await callback(*args, **kwargs) if inspect.iscoroutinefunction(callback) else callback(*args, **kwargs)
                results.append(result)
            except Exception as e:
                logger.error(f"Hook {hook_name} callback failed: {e}")
        return results
    
    def register_plugin(self, plugin_class: Type[BasePlugin], metadata: PluginMetadata, config: Optional[PluginConfig] = None):
        """Register a plugin class"""
        if metadata.name in self.plugins:
            logger.warning(f"Plugin {metadata.name} already registered, overwriting")
        
        self.metadata[metadata.name] = metadata
        self.configs[metadata.name] = config or PluginConfig()
        
        # Create plugin instance
        plugin_config = self.configs[metadata.name]
        plugin_instance = plugin_class(plugin_config, metadata)
        self.plugins[metadata.name] = plugin_instance
        
        logger.info(f"Registered plugin: {metadata.name} v{metadata.version}")
    
    async def load_plugin(self, name: str) -> bool:
        """Load and initialize a plugin"""
        if name not in self.plugins:
            logger.error(f"Plugin {name} not registered")
            return False
        
        plugin = self.plugins[name]
        if not self.configs[name].enabled:
            logger.info(f"Plugin {name} is disabled, skipping")
            return False

        self._load_attempted[name] = True
        self._load_errors.pop(name, None)
        self._setup_required.pop(name, None)
        plugin._initialized = False
        try:
            initialized = bool(await plugin.initialize(self.app_context))
            capabilities = plugin.get_capabilities() if initialized else []
            # Some legacy implementations return True without marking their
            # runtime state.  Accept them only when they also expose a concrete
            # capability after initialization; never infer readiness from
            # registration or enabled=True alone.
            success = initialized and bool(capabilities)
            plugin._initialized = success
            if success:
                logger.info(f"Loaded plugin: {name}")
                await self.trigger_hook("plugin_loaded", name, plugin)
            else:
                # A plugin that knows why it cannot start says so. Most of
                # these wrap an external tool, and "initialize() returned
                # false" tells the person reading it nothing they can act on,
                # while "the paperclipai command is not on PATH" does.
                stated = getattr(plugin, "unavailable_reason", None)
                reason = stated or (
                    "initialize() returned false"
                    if not initialized
                    else "initialization exposed no runtime capabilities"
                )
                # A plugin that named its own reason is telling us the
                # environment is missing something, not that it broke. Those
                # are two different things and were being shown as one: the
                # interface painted "Failed" in red for a machine that simply
                # does not have Node, or the paperclip CLI, or a checkout.
                if stated:
                    self._setup_required[name] = reason
                    self._load_errors.pop(name, None)
                else:
                    self._load_errors[name] = reason
                logger.info("Plugin %s is not runtime-ready: %s", name, reason)
            return success
        except Exception as e:
            plugin._initialized = False
            self._load_errors[name] = str(e)
            logger.error(f"Failed to load plugin {name}: {e}")
            return False
    
    async def load_all(self) -> Dict[str, bool]:
        """Load all enabled plugins"""
        results = {}
        for name in self.plugins:
            results[name] = await self.load_plugin(name)
        return results
    
    async def unload_plugin(self, name: str) -> bool:
        """Unload a plugin"""
        if name not in self.plugins:
            return False
        
        try:
            await self.plugins[name].shutdown()
            self.plugins[name]._initialized = False
            logger.info(f"Unloaded plugin: {name}")
            await self.trigger_hook("plugin_unloaded", name)
            return True
        except Exception as e:
            logger.error(f"Failed to unload plugin {name}: {e}")
            return False
    
    def get_plugin(self, name: str) -> Optional[BasePlugin]:
        """Get a plugin by name"""
        return self.plugins.get(name)

    def is_plugin_active(self, name: str) -> bool:
        """Return True only for an enabled, initialized runtime instance."""
        plugin = self.plugins.get(name)
        config = self.configs.get(name)
        return bool(
            plugin is not None
            and config is not None
            and config.enabled
            and getattr(plugin, "_initialized", False)
        )

    def get_plugins_by_type(self, plugin_type: PluginType) -> List[BasePlugin]:
        """Get all plugins of a specific type"""
        return [
            p for p in self.plugins.values() 
            if p.metadata.plugin_type == plugin_type
            and self.is_plugin_active(p.metadata.name)
        ]
    
    def get_all_tools(self) -> List[Dict]:
        """Get all tools from all tool plugins"""
        tools = []
        for plugin in self.get_plugins_by_type(PluginType.TOOL):
            if isinstance(plugin, ToolPlugin):
                tools.extend(plugin.get_tools())
        return tools
    
    def get_all_skills(self) -> List[Dict]:
        """Get all skills from all skill plugins"""
        skills = []
        for plugin in self.get_plugins_by_type(PluginType.SKILL):
            if isinstance(plugin, SkillPlugin):
                skills.extend(plugin.get_skills())
        return skills
    
    def get_all_connectors(self) -> List[Dict]:
        """Get all connector operations"""
        ops = []
        for plugin in self.get_plugins_by_type(PluginType.CONNECTOR):
            if isinstance(plugin, ConnectorPlugin):
                ops.extend(plugin.get_operations())
        return ops
    
    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        """Execute a tool by name across all tool plugins"""
        for plugin in self.get_plugins_by_type(PluginType.TOOL):
            if isinstance(plugin, ToolPlugin):
                tools = plugin.get_tools()
                if any(t['name'] == tool_name for t in tools):
                    return await plugin.execute_tool(tool_name, arguments)
        raise ValueError(f"Tool {tool_name} not found")
    
    async def execute_skill(self, skill_name: str, context: Dict) -> Any:
        """Execute a skill by name across all skill plugins"""
        for plugin in self.get_plugins_by_type(PluginType.SKILL):
            if isinstance(plugin, SkillPlugin):
                skills = plugin.get_skills()
                if any(s['name'] == skill_name for s in skills):
                    return await plugin.execute_skill(skill_name, context)
        raise ValueError(f"Skill {skill_name} not found")

    async def execute_connector(self, operation_name: str, parameters: Dict) -> Any:
        """Execute a connector operation by name across all connector plugins"""
        for plugin in self.get_plugins_by_type(PluginType.CONNECTOR):
            if isinstance(plugin, ConnectorPlugin):
                ops = plugin.get_operations()
                if any(op['name'] == operation_name for op in ops):
                    return await plugin.execute_operation(operation_name, parameters)
        raise ValueError(f"Connector operation {operation_name} not found")
    
    def _resolve_display_type(self, name: str, raw_type: str) -> str:
        """Map the actual registered Python plugin type to a UI category."""
        return "plugin" if raw_type == "tool" else raw_type

    def get_status(self) -> Dict:
        """Get status of all plugins — returns a FLAT dict per plugin so
        the frontend can read p.type, p.name, etc. directly."""
        result = {}
        for name, m in self.metadata.items():
            display_type = self._resolve_display_type(name, m.plugin_type.value)
            enabled = bool(self.configs.get(name) and self.configs[name].enabled)
            loaded = self.is_plugin_active(name)
            caps = []
            if loaded:
                try:
                    caps = self.plugins[name].get_capabilities()
                except Exception as exc:
                    loaded = False
                    self.plugins[name]._initialized = False
                    self._load_errors[name] = str(exc)
            if loaded:
                runtime_status = "active"
                status_detail = "This backend process reports initialized=true and exposes runtime capability definitions."
            elif not enabled:
                runtime_status = "disabled"
                status_detail = "Registered, but disabled by configuration."
            elif name in self._setup_required:
                runtime_status = "setup_required"
                status_detail = self._setup_required[name]
            elif name in self._load_errors:
                runtime_status = "error"
                status_detail = f"Initialization failed: {self._load_errors[name]}"
            else:
                runtime_status = "setup_required"
                status_detail = "Registered definition only; not initialized in this backend process."
            result[name] = {
                "name": m.name,
                "version": m.version,
                "description": m.description,
                "type": display_type,
                "author": m.author,
                "enabled": enabled,
                "loaded": loaded,
                "available": loaded,
                "registered": True,
                "runtime_status": runtime_status,
                "status_detail": status_detail,
                "load_attempted": bool(self._load_attempted.get(name, False)),
                "capabilities": caps,
                "tags": m.tags,
                "homepage": m.homepage or "",
                "repository": m.repository or "",
            }
        return result

    def get_active_plugins_prompt_context(self) -> str:
        """Describe only extensions initialized in this backend process."""
        lines = []
        for name in self.metadata:
            if self.is_plugin_active(name):
                m = self.metadata[name]
                try:
                    capabilities = self.plugins[name].get_capabilities()
                except Exception:
                    continue
                if capabilities:
                    lines.append(
                        f"- **{m.name}** ({m.plugin_type.value}); runtime capabilities: "
                        + ", ".join(capabilities)
                    )
        if not lines:
            return ""
        return (
            "\n\nINITIALIZED RUNTIME EXTENSIONS:\n"
            "Only the following locally initialized capabilities are available. "
            "Do not claim that an extension was used unless its operation is actually invoked:\n"
            + "\n".join(lines)
        )

    def install_plugin_from_repo(self, repo_url: str, install_path: Optional[str] = None) -> Dict[str, Any]:
        """Install a plugin or a skill collection from a git repository.

        This only accepted repositories with a plugin.json at the root, and
        most of what people actually want to install is not shaped like that.
        A skill is prose - a SKILL.md, or a folder of markdown agent
        definitions - and every one of those was refused with "cloned nothing
        usable" despite having cloned something perfectly usable.

        It also used to json.load the manifest, throw the result away and
        return True, so "installed" meant "cloned" and nothing more.

        Returns what was found rather than a bare boolean, because "no such
        repository", "cloned but empty" and "found nine skills" are three
        different answers and the caller has to tell them apart.
        """
        try:
            root = Path(install_path) if install_path else Path.home() / ".smaran"
            repo_name = repo_url.rstrip('/').split('/')[-1].replace('.git', '')

            # Skills and plugins are kept apart: one is prose the model reads,
            # the other is code this process imports, and mixing them would
            # make it unclear which is which.
            skills_root = root / "skills"
            plugins_root = root / "plugins"

            # Cloned into skills first; moved if it turns out to be a plugin.
            probe_path = skills_root / repo_name
            probe_path.parent.mkdir(parents=True, exist_ok=True)

            if probe_path.exists():
                subprocess.run(['git', '-C', str(probe_path), 'pull'],
                               check=True, capture_output=True, timeout=300)
            else:
                subprocess.run(['git', 'clone', '--depth', '1', repo_url, str(probe_path)],
                               check=True, capture_output=True, timeout=600)

            manifest_path = next(
                (probe_path / name for name in ('plugin.json', 'smaran_plugin.json')
                 if (probe_path / name).is_file()), None)

            if manifest_path:
                with open(manifest_path, encoding='utf-8') as handle:
                    manifest = json.load(handle)
                plugins_root.mkdir(parents=True, exist_ok=True)
                final = plugins_root / repo_name
                if final.exists():
                    shutil.rmtree(final, ignore_errors=True)
                shutil.move(str(probe_path), str(final))
                return {
                    "kind": "plugin",
                    "name": manifest.get("name", repo_name),
                    "path": str(final),
                    "detail": "Cloned. Restart SMARAN.AI to load it.",
                }

            skills = self._index_skills(probe_path)
            if skills:
                return {
                    "kind": "skill",
                    "name": repo_name,
                    "path": str(probe_path),
                    "skills": skills,
                    "count": len(skills),
                    "detail": "%d skill%s installed from %s."
                              % (len(skills), "" if len(skills) == 1 else "s", repo_name),
                }

            shutil.rmtree(probe_path, ignore_errors=True)
            return {
                "kind": None,
                "detail": ("Cloned %s, but found neither a plugin.json nor any "
                           "markdown skill files in it, so there was nothing to "
                           "install. Removed the copy." % repo_name),
            }

        except subprocess.CalledProcessError as exc:
            # git's own words: a private repository, a wrong URL and no network
            # read very differently.
            message = (exc.stderr or b"").decode("utf-8", "replace").strip()
            logger.warning("git failed for %s: %s", repo_url, message[:200])
            return {"kind": None, "error": message[-300:] or "git failed."}
        except subprocess.TimeoutExpired:
            return {"kind": None, "error": "The clone took too long and was stopped."}
        except Exception as exc:
            logger.exception("Failed to install from %s", repo_url)
            return {"kind": None, "error": str(exc)[:200]}

    @staticmethod
    def _index_skills(path: Path) -> List[Dict[str, str]]:
        """The skills in a checkout.

        A skill is a markdown file that describes itself - SKILL.md at the
        root, or the .md files a collection keeps in agents/ or skills/. The
        README is not one of them, and neither is a licence.
        """
        import re

        SKIP = {"readme.md", "license.md", "licence.md", "contributing.md",
                "changelog.md", "code_of_conduct.md", "security.md",
                "pull_request_template.md", "issue_template.md"}
        found: List[Dict[str, str]] = []

        for file in sorted(path.rglob("*.md")):
            # Repository furniture is not a skill. Indexing agency-agents
            # listed its PULL_REQUEST_TEMPLATE among the agents, and .github
            # holds nothing anyone would want to run.
            if (file.name.lower() in SKIP or ".git" in file.parts
                    or ".github" in file.parts or "docs" in file.parts[:1]):
                continue
            try:
                text = file.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if len(text) < 200:
                continue

            # Prefer the name and description a skill states about itself in
            # YAML frontmatter; fall back to its first heading.
            name = description = ""
            front = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
            if front:
                for line in front.group(1).splitlines():
                    key, _, value = line.partition(":")
                    if key.strip() == "name":
                        name = value.strip().strip('"\'')
                    elif key.strip() == "description":
                        description = value.strip().strip('"\'')
            if not name:
                heading = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
                name = heading.group(1).strip() if heading else file.stem
            if not description:
                body = re.sub(r"^---.*?---", "", text, flags=re.DOTALL)
                body = re.sub(r"^#.*$", "", body, flags=re.MULTILINE).strip()
                description = " ".join(body.split())[:180]

            found.append({"name": name[:80], "description": description,
                          "file": str(file.relative_to(path))})
            if len(found) >= 400:
                break
        return found

# Global plugin manager instance
plugin_manager = PluginManager()

# Decorator for easy plugin registration
def plugin(metadata: PluginMetadata):
    """Decorator to register a plugin class"""
    def decorator(cls):
        plugin_manager.register_plugin(cls, metadata)
        return cls
    return decorator

# Built-in tool decorators
def tool(name: str, description: str, parameters: Dict):
    """Decorator to define a tool function"""
    def decorator(func):
        func._tool_metadata = {
            "name": name,
            "description": description,
            "parameters": parameters
        }
        return func
    return decorator

def skill(name: str, description: str, parameters: Dict = None):
    """Decorator to define a skill function"""
    def decorator(func):
        func._skill_metadata = {
            "name": name,
            "description": description,
            "parameters": parameters or {}
        }
        return func
    return decorator
