"""
Plugin System API Routes
=======================
Endpoints for managing and interacting with the plugin system.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
import asyncio
import logging
import uuid
import json
import httpx
import time
from urllib.parse import urlparse
from dataclasses import asdict

from app.database import get_db
from app.plugin_system import plugin_manager, PluginType, PluginStatus
from app.plugin_schemas import (
    PluginMetadata, PluginConfig, PluginStatusResponse, PluginListResponse,
    PluginInstallRequest, PluginInstallResponse,
    PluginConfigUpdate,
    ToolExecuteRequest, ToolExecuteResponse,
    SkillExecuteRequest, SkillExecuteResponse,
    ConnectorOperationRequest, ConnectorOperationResponse
)

logger = logging.getLogger("plugin_routes")

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

# Initialize plugin manager with app context (will be set by main app)
def set_app_context(context: Dict[str, Any]):
    plugin_manager.set_app_context(context)

@router.get("")
def list_plugins(db: Session = Depends(get_db)):
    """List all registered plugins with their status and custom plugins."""
    statuses = plugin_manager.get_status()
    try:
        from app.models import CustomPlugin
        custom_items = db.query(CustomPlugin).all()
        for c in custom_items:
            statuses[c.id] = {
                "name": c.name,
                "version": "custom",
                "description": c.description or "User-defined custom extension",
                "type": c.type,
                "enabled": c.enabled,
                # A database registration is not proof that the remote/custom
                # extension initialized successfully in this process.
                "loaded": False,
                "available": False,
                "registered": True,
                "runtime_status": "setup_required" if c.enabled else "registered",
                "status_detail": (
                    "Registered target only; this backend has not initialized or authenticated it."
                    if c.enabled
                    else "Saved target only; it is not connected to this backend."
                ),
                "load_attempted": False,
                "capabilities": [],
                "author": "User Defined",
                "website": c.url,
                "dependencies": [],
                "tags": ["custom", c.type],
                "is_custom": True
            }
    except Exception as e:
        logger.warning(f"Failed to load custom plugins into list: {e}")
    return {"plugins": statuses}


@router.get("/health")
def plugin_system_health():
    """Report registry health separately from active runtime extensions."""
    statuses = plugin_manager.get_status()
    active = [name for name, item in statuses.items() if item.get("runtime_status") == "active"]
    return {
        "status": "ok",
        "registered_plugins": len(plugin_manager.metadata),
        "loaded_plugins": len(active),
        "active_plugins": active,
    }

@router.get("/{plugin_name}", response_model=PluginStatusResponse)
def get_plugin_status(plugin_name: str):
    """Get the status of a specific plugin."""
    if plugin_name not in plugin_manager.metadata:
        raise HTTPException(status_code=404, detail=f"Plugin {plugin_name} not found")
    
    metadata = plugin_manager.metadata[plugin_name]
    config = plugin_manager.configs.get(plugin_name, PluginConfig())
    plugin_instance = plugin_manager.plugins.get(plugin_name)
    
    loaded = plugin_manager.is_plugin_active(plugin_name)
    capabilities = plugin_instance.get_capabilities() if plugin_instance and loaded else []
    
    metadata_payload = asdict(metadata)
    metadata_payload["plugin_type"] = metadata.plugin_type.value
    return PluginStatusResponse(
        name=plugin_name,
        metadata=metadata_payload,
        config=config.dict(),
        loaded=loaded,
        capabilities=capabilities
    )

@router.post("/install", response_model=PluginInstallResponse)
async def install_plugin_from_repo(request: PluginInstallRequest):
    """Install a plugin from a git repository, and report what happened.

    This used to hand the work to a background task and return success=True
    immediately - before the clone had even started. A repository that did not
    exist, a network that was down and a missing manifest all reported success
    and left a failure in the log where nobody would see it.

    Cloning a plugin repository takes seconds, so it is worth waiting for the
    answer rather than inventing one.
    """
    url = (request.repo_url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="A repository URL is required.")
    if not url.startswith(("https://", "http://", "git@")):
        raise HTTPException(
            status_code=400,
            detail="That does not look like a repository URL. Expected one starting https:// or git@.",
        )

    name = url.rstrip("/").split("/")[-1].replace(".git", "")

    try:
        # The clone is blocking, so it runs off the event loop rather than
        # stalling every other request while it downloads.
        ok = await asyncio.to_thread(
            plugin_manager.install_plugin_from_repo, url, request.install_path
        )
    except Exception as exc:
        logger.exception("plugin install failed for %s", url)
        raise HTTPException(status_code=502, detail="Could not install: %s" % exc)

    if not ok:
        raise HTTPException(
            status_code=422,
            detail=(
                "Cloned nothing usable from %s. A plugin repository needs a "
                "plugin.json or smaran_plugin.json at its root." % url
            ),
        )

    logger.info("installed plugin from %s", url)
    return PluginInstallResponse(
        success=True,
        message="Installed %s. Enable it to load its tools." % name,
        plugin_name=name,
    )

@router.post("/{plugin_name}/enable")
async def enable_plugin(plugin_name: str):
    """Enable a plugin and load it, reporting what actually happened.

    This used to set a flag and return, so a plugin stayed at
    setup_required however many times it was switched on. It now attempts
    the load and reports the real outcome, including the reason when a
    plugin cannot start - which is usually a missing key rather than a
    fault, and is worth saying plainly.
    """
    if plugin_name not in plugin_manager.configs:
        raise HTTPException(status_code=404, detail=f"Plugin {plugin_name} not found")
    
    plugin_manager.configs[plugin_name].enabled = True
    loaded = await plugin_manager.load_plugin(plugin_name)
    status = plugin_manager.get_status().get(plugin_name, {})
    return {
        "message": (
            f"Plugin {plugin_name} is running."
            if loaded
            else f"Plugin {plugin_name} is enabled but could not start: "
                 f"{status.get('status_detail', 'no detail available')}"
        ),
        "enabled": True,
        "loaded": loaded,
        "runtime_status": "active" if plugin_manager.is_plugin_active(plugin_name) else "setup_required",
    }

@router.post("/{plugin_name}/disable")
async def disable_plugin(plugin_name: str):
    """Disable a plugin."""
    if plugin_name not in plugin_manager.configs:
        raise HTTPException(status_code=404, detail=f"Plugin {plugin_name} not found")
    
    plugin_manager.configs[plugin_name].enabled = False
    if getattr(plugin_manager.plugins.get(plugin_name), "_initialized", False):
        await plugin_manager.unload_plugin(plugin_name)
    return {
        "message": f"Plugin {plugin_name} disabled",
        "enabled": False,
        "loaded": False,
        "runtime_status": "disabled",
    }

@router.post("/{plugin_name}/config")
async def update_plugin_config(plugin_name: str, config_update: PluginConfigUpdate):
    """Update the configuration for a plugin."""
    if plugin_name not in plugin_manager.configs:
        raise HTTPException(status_code=404, detail=f"Plugin {plugin_name} not found")
    
    config = plugin_manager.configs[plugin_name]
    if config_update.enabled is not None:
        config.enabled = config_update.enabled
    if config_update.config is not None:
        config.config = config_update.config
    if config_update.priority is not None:
        config.priority = config_update.priority

    if config_update.enabled is False and getattr(plugin_manager.plugins.get(plugin_name), "_initialized", False):
        await plugin_manager.unload_plugin(plugin_name)
    loaded = plugin_manager.is_plugin_active(plugin_name)
    return {
        "message": f"Plugin {plugin_name} configuration updated",
        "enabled": config.enabled,
        "loaded": loaded,
        "runtime_status": "active" if loaded else ("setup_required" if config.enabled else "disabled"),
    }


def _require_active_plugin(plugin_name: str):
    plugin = plugin_manager.get_plugin(plugin_name)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin {plugin_name} not found")
    if not plugin.is_enabled():
        raise HTTPException(status_code=409, detail=f"Plugin {plugin_name} is disabled")
    if not plugin_manager.is_plugin_active(plugin_name):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Plugin {plugin_name} is registered but not initialized in this backend process. "
                "Install/configure its real runtime dependencies before execution."
            ),
        )
    return plugin

@router.post("/{plugin_name}/tools/{tool_name}/execute", response_model=ToolExecuteResponse)
async def execute_tool(plugin_name: str, tool_name: str, request: ToolExecuteRequest):
    """Execute a tool from a specific plugin."""
    plugin = _require_active_plugin(plugin_name)
    
    # Check if the plugin is a tool plugin
    if plugin.metadata.plugin_type != PluginType.TOOL:
        raise HTTPException(status_code=400, detail=f"Plugin {plugin_name} is not a tool plugin")
    
    from app.plugin_system import ToolPlugin
    if not isinstance(plugin, ToolPlugin):
        raise HTTPException(status_code=400, detail=f"Plugin {plugin_name} is not a tool plugin")

    declared_tools = {item.get("name") for item in plugin.get_tools()}
    if tool_name not in declared_tools:
        raise HTTPException(status_code=404, detail=f"Tool {tool_name} is not exposed by {plugin_name}")
    if request.tool_name and request.tool_name != tool_name:
        raise HTTPException(status_code=400, detail="Path tool name and request tool_name do not match")
    
    try:
        result = await plugin.execute_tool(tool_name, request.arguments)
        return ToolExecuteResponse(success=True, result=result)
    except Exception as e:
        logger.error(f"Error executing tool {tool_name} from plugin {plugin_name}: {e}")
        return ToolExecuteResponse(success=False, error=str(e))

@router.post("/{plugin_name}/skills/{skill_name}/execute", response_model=SkillExecuteResponse)
async def execute_skill(plugin_name: str, skill_name: str, request: SkillExecuteRequest):
    """Execute a skill from a specific plugin."""
    plugin = _require_active_plugin(plugin_name)
    
    if plugin.metadata.plugin_type != PluginType.SKILL:
        raise HTTPException(status_code=400, detail=f"Plugin {plugin_name} is not a skill plugin")
    
    from app.plugin_system import SkillPlugin
    if not isinstance(plugin, SkillPlugin):
        raise HTTPException(status_code=400, detail=f"Plugin {plugin_name} is not a skill plugin")
    
    try:
        declared_skills = {item.get("name") for item in plugin.get_skills()}
        if skill_name not in declared_skills:
            raise HTTPException(status_code=404, detail=f"Skill {skill_name} is not exposed by {plugin_name}")
        if request.skill_name and request.skill_name != skill_name:
            raise HTTPException(status_code=400, detail="Path skill name and request skill_name do not match")
        result = await plugin.execute_skill(skill_name, request.context)
        return SkillExecuteResponse(success=True, result=result)
    except Exception as e:
        logger.error(f"Error executing skill {skill_name} from plugin {plugin_name}: {e}")
        return SkillExecuteResponse(success=False, error=str(e))

@router.post("/{plugin_name}/connectors/{operation}/execute", response_model=ConnectorOperationResponse)
async def execute_connector_operation(plugin_name: str, operation: str, request: ConnectorOperationRequest):
    """Execute an operation from a specific connector plugin."""
    plugin = _require_active_plugin(plugin_name)
    
    if plugin.metadata.plugin_type != PluginType.CONNECTOR:
        raise HTTPException(status_code=400, detail=f"Plugin {plugin_name} is not a connector plugin")
    
    from app.plugin_system import ConnectorPlugin
    if not isinstance(plugin, ConnectorPlugin):
        raise HTTPException(status_code=400, detail=f"Plugin {plugin_name} is not a connector plugin")
    
    try:
        declared_operations = {item.get("name") for item in plugin.get_operations()}
        if operation not in declared_operations:
            raise HTTPException(status_code=404, detail=f"Operation {operation} is not exposed by {plugin_name}")
        if request.operation and request.operation != operation:
            raise HTTPException(status_code=400, detail="Path operation and request operation do not match")
        result = await plugin.execute_operation(operation, request.parameters)
        return ConnectorOperationResponse(success=True, result=result)
    except Exception as e:
        logger.error(f"Error executing connector operation {operation} from plugin {plugin_name}: {e}")
        return ConnectorOperationResponse(success=False, error=str(e))

class PluginGenericTestRequest(BaseModel):
    text: Optional[str] = None
    query: Optional[str] = None
    operation: Optional[str] = None
    context: Optional[Dict[str, Any]] = None

@router.post("/{plugin_name}/diagnostic")
async def live_test_plugin(plugin_name: str, req: PluginGenericTestRequest = PluginGenericTestRequest()):
    """Report measured runtime state; do not simulate plugin output or metrics."""
    _require_active_plugin(plugin_name)
    status = plugin_manager.get_status()[plugin_name]
    return {
        "success": True,
        "status": "active",
        "plugin": plugin_name,
        "initialized": status["loaded"],
        "capabilities": status["capabilities"],
        "message": (
            "The backend process reports initialized=true. This check did not invoke a capability "
            "or independently verify an external service."
        ),
    }

from app.models import CustomPlugin

class CustomPluginCreate(BaseModel):
    name: str
    type: str  # "plugin", "skill", "connector", "mcp"
    url: str
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

class CustomPluginTestRequest(BaseModel):
    type: str
    url: str
    config: Optional[Dict[str, Any]] = None

@router.get("/custom/all")
def get_custom_plugins(db: Session = Depends(get_db)):
    """List all custom plugins registered by users."""
    items = db.query(CustomPlugin).order_by(CustomPlugin.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "type": p.type,
            "url": p.url,
            "description": p.description or "",
            "config": json.loads(p.config) if p.config else {},
            "enabled": p.enabled,
            "loaded": False,
            "available": False,
            "registered": True,
            "runtime_status": "setup_required" if p.enabled else "registered",
            "status_detail": "Saved target only; not initialized or authenticated.",
            "capabilities": [],
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "is_custom": True
        }
        for p in items
    ]

@router.post("/custom")
def create_custom_plugin(req: CustomPluginCreate, db: Session = Depends(get_db)):
    """Register a new user-defined custom plugin, skill, or MCP server."""
    clean_name = req.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Plugin name is required")
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="Plugin repository or MCP URL is required")
    clean_type = req.type.strip().lower()
    if clean_type not in {"plugin", "skill", "connector", "mcp"}:
        raise HTTPException(status_code=400, detail="Type must be plugin, skill, connector, or mcp")
    
    plugin_id = f"custom-{uuid.uuid4().hex[:8]}"
    custom_item = CustomPlugin(
        id=plugin_id,
        user_id=0,
        name=clean_name,
        type=clean_type,
        url=req.url.strip(),
        description=req.description.strip() if req.description else "",
        config=json.dumps(req.config) if req.config else "{}",
        # Saving a target is registration only.  It must not be advertised as
        # enabled/connected until a real loader and protocol handshake exist.
        enabled=False
    )
    db.add(custom_item)
    db.commit()
    db.refresh(custom_item)
    return {
        "id": custom_item.id,
        "name": custom_item.name,
        "type": custom_item.type,
        "url": custom_item.url,
        "description": custom_item.description,
        "enabled": custom_item.enabled,
        "loaded": False,
        "available": False,
        "registered": True,
        "runtime_status": "registered",
        "status_detail": "Saved target only; not initialized or authenticated.",
        "capabilities": [],
        "is_custom": True
    }

@router.delete("/custom/{plugin_id}")
def delete_custom_plugin(plugin_id: str, db: Session = Depends(get_db)):
    """Delete a custom plugin."""
    item = db.query(CustomPlugin).filter(CustomPlugin.id == plugin_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Custom plugin not found")
    db.delete(item)
    db.commit()
    return {"message": "Custom plugin deleted successfully"}

@router.post("/custom/test")
async def test_custom_plugin(req: CustomPluginTestRequest):
    """Measure network reachability without claiming MCP/plugin readiness."""
    url = req.url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return {
            "success": False,
            "reachable": False,
            "protocol_verified": False,
            "status": "not_verified",
            "message": (
                "Only HTTP(S) reachability can be checked here. Git/stdio/local commands "
                "are saved as targets but are not connected or executed by this backend."
            ),
        }
    
    try:
        import time
        start_time = time.perf_counter()
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)
            reachable = resp.status_code < 500
            return {
                "success": reachable,
                "reachable": reachable,
                "protocol_verified": False,
                "status": "reachable_unverified" if reachable else "http_error",
                "status_code": resp.status_code,
                "message": (
                    f"HTTP endpoint responded with {resp.status_code} in {elapsed_ms} ms. "
                    "This verifies reachability only, not MCP compatibility, authentication, or capabilities."
                ),
                "latency_ms": elapsed_ms
            }
    except Exception as e:
        return {
            "success": False,
            "reachable": False,
            "protocol_verified": False,
            "status": "unreachable",
            "error": str(e),
            "message": f"Could not reach endpoint: {e}"
        }
