from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


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
    rag_enabled: bool = False
    voice_mode: bool = False  # Spoken conversation: short, proactive replies
    target_language: Optional[str] = "en"  # Default English
    cloud_provider: Optional[str] = None
    cloud_model: Optional[str] = None
    cloud_api_key: Optional[str] = None
    cloud_fallbacks: List[dict] = []

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


# --- Translation Schemas ---
class TranslationRequest(BaseModel):
    text: str
    target_language: str = "en"
    source_language: Optional[str] = "auto"

class TranslationResponse(BaseModel):
    original_text: str
    translated_text: str
    source_language: str
    target_language: str

class LanguageDetectionRequest(BaseModel):
    text: str

class LanguageDetectionResponse(BaseModel):
    language: str
    language_name: str
    confidence: Optional[float] = None
