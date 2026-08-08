from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# --- Auth Schemas ---
class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)

class UserLogin(BaseModel):
    username: str
    password: str

class PasswordResetRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    new_password: str = Field(..., min_length=6)

class MasterRecoveryRequest(BaseModel):
    master_key: str
    target_username: Optional[str] = None
    new_password: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_approved: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    login_count: Optional[int] = 0

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    role: Optional[str] = None
    is_approved: Optional[bool] = None
    password: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None
    role: Optional[str] = None

class VisitorLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: str
    role: str
    ip_address: Optional[str] = "127.0.0.1"
    user_agent: Optional[str] = "Unknown"
    event_type: str
    timestamp: datetime

    class Config:
        from_attributes = True

class DeveloperAnalyticsResponse(BaseModel):
    total_registered_users: int
    total_logins_all_time: int
    today_visitors_count: int
    active_users_last_24h: int
    total_chat_prompts_processed: int
    total_active_sessions: int
    database_size_mb: float
    recent_visitors: List[VisitorLogResponse]



# --- RAG/Collection Schemas ---
class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class CollectionResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    created_at: datetime
    doc_count: int = 0

    class Config:
        from_attributes = True

class DocumentResponse(BaseModel):
    id: int
    name: str
    collection_id: int
    file_type: str
    file_size: int
    session_id: Optional[str] = None
    uploaded_at: datetime

    class Config:
        from_attributes = True


# --- Chat Schemas ---
class ChatRequest(BaseModel):
    session_id: str
    prompt: str
    collections: List[int] = []  # Collection IDs to search from
    model: Optional[str] = None
    turbo: bool = False
    web_search: bool = False

class VisionChatRequest(BaseModel):
    """Schema for vision-based chat requests (image analysis)."""
    session_id: str
    prompt: str
    model: Optional[str] = "qwen2.5-vl:latest"

class SourceReference(BaseModel):
    document_name: str
    chunk_index: int
    text: str
    score: float

class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    references: Optional[List[SourceReference]] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ChatSessionResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class ChatSessionCreate(BaseModel):
    title: str


# --- Admin Audit & Stats ---
class AuditLogResponse(BaseModel):
    id: int
    username: str
    prompt: str
    response: str
    model_used: str
    timestamp: datetime

    class Config:
        from_attributes = True

class SystemStatsResponse(BaseModel):
    cpu_usage: float
    cpu_cores: Optional[int] = None
    cpu_name: Optional[str] = None
    memory_usage: float
    memory_used_gb: Optional[float] = None
    memory_total_gb: Optional[float] = None
    gpu_usage: float
    gpu_name: str
    gpu_vram_used: Optional[float] = None
    gpu_vram_total: Optional[float] = None
    gpu_temperature: Optional[float] = None
    disk_usage: Optional[float] = None
    disk_used_gb: Optional[float] = None
    disk_total_gb: Optional[float] = None
    disk_read_kb: Optional[float] = None
    disk_write_kb: Optional[float] = None
    net_up_kb: Optional[float] = None
    net_down_kb: Optional[float] = None
    active_sessions: int
    database_size_mb: float
    average_latency_ms: float
    model_display_name: Optional[str] = None
    model_id: Optional[str] = None
    ctx_window: Optional[int] = None
    reasoning_model: Optional[bool] = None

class UserMemoryCreate(BaseModel):
    fact: str = Field(..., min_length=1)
    source_session_id: Optional[str] = None

class UserMemoryResponse(BaseModel):
    id: int
    user_id: int
    fact: str
    source_session_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class UserMemoryResponse(BaseModel):
    id: int
    user_id: int
    fact: str
    source_session_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

