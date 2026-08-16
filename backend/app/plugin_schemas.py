"""
Plugin System Schemas
=====================
Pydantic models for the plugin system API
"""

from typing import Optional, Dict, List, Any
from pydantic import BaseModel, Field
from enum import Enum

class PluginType(str, Enum):
    TOOL = "tool"
    SKILL = "skill"
    CONNECTOR = "connector"
    PLUGIN = "plugin"
    PROVIDER = "provider"

class PluginStatus(str, Enum):
    LOADED = "loaded"
    ENABLED = "enabled"
    DISABLED = "disabled"
    ERROR = "error"
    NOT_INSTALLED = "not_installed"

class PluginMetadata(BaseModel):
    name: str
    version: str
    description: str
    author: str
    plugin_type: PluginType
    entry_point: str
    dependencies: List[str] = []
    config_schema: Dict = {}
    tags: List[str] = []
    homepage: Optional[str] = None
    repository: Optional[str] = None
    license: Optional[str] = None

class PluginConfig(BaseModel):
    enabled: bool = True
    config: Dict = {}
    priority: int = 0

class PluginStatusResponse(BaseModel):
    name: str
    metadata: Dict
    config: Dict
    loaded: bool
    capabilities: List[str]

class PluginListResponse(BaseModel):
    plugins: Dict[str, Dict]

class PluginInstallRequest(BaseModel):
    repo_url: str
    install_path: Optional[str] = None

class PluginInstallResponse(BaseModel):
    success: bool
    message: str
    plugin_name: Optional[str] = None

class PluginConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    config: Optional[Dict] = None
    priority: Optional[int] = None

class ToolExecuteRequest(BaseModel):
    tool_name: str
    arguments: Dict

class ToolExecuteResponse(BaseModel):
    success: bool
    result: Any = None
    error: Optional[str] = None

class SkillExecuteRequest(BaseModel):
    skill_name: str
    context: Dict

class SkillExecuteResponse(BaseModel):
    success: bool
    result: Any = None
    error: Optional[str] = None

class ConnectorOperationRequest(BaseModel):
    operation: str
    parameters: Dict

class ConnectorOperationResponse(BaseModel):
    success: bool
    result: Any = None
    error: Optional[str] = None

# Built-in system tools/schemas
class SystemInfo(BaseModel):
    cpu_usage: float
    cpu_cores: int
    cpu_threads: int
    cpu_name: str
    memory_usage: float
    memory_used_gb: float
    memory_total_gb: float
    gpu_available: bool
    gpu_usage: float
    gpu_name: str
    gpu_vram_used: float
    gpu_vram_total: float
    gpu_temperature: float

class FileOperation(BaseModel):
    operation: str  # read, write, delete, list, copy, move
    path: str
    content: Optional[str] = None
    destination: Optional[str] = None

class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 10
    recency_days: Optional[int] = None

class CodeExecutionRequest(BaseModel):
    code: str
    language: str = "python"
    timeout: int = 30

class ImageGenerationRequest(BaseModel):
    prompt: str
    width: int = 1024
    height: int = 1024
    model: Optional[str] = None
    negative_prompt: Optional[str] = None
    steps: int = 20
    guidance_scale: float = 7.5

class DocumentProcessingRequest(BaseModel):
    file_path: str
    operation: str  # extract_text, extract_images, summarize, extract_tables
    options: Dict = {}

class WebScrapingRequest(BaseModel):
    url: str
    selector: Optional[str] = None
    wait_for: Optional[str] = None
    screenshot: bool = False

class DatabaseQueryRequest(BaseModel):
    query: str
    database: str = "default"
    params: Dict = {}