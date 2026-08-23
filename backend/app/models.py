import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    email_verified = Column(Boolean, default=False, nullable=False)
    password_hash = Column(String, nullable=True)
    role = Column(String, default="user", nullable=False)
    is_approved = Column(Boolean, default=False, nullable=False)
    device_fingerprint = Column(String, nullable=True)
    last_login = Column(DateTime, nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    session_token = Column(String, unique=True, index=True, nullable=True)
    session_expires = Column(DateTime, nullable=True)
    verification_token = Column(String, nullable=True)
    reset_token = Column(String, nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")
    memories = relationship("UserMemory", back_populates="user", cascade="all, delete-orphan")
    collections = relationship("Collection", back_populates="user", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="user", cascade="all, delete-orphan")
    chunks = relationship("DocumentChunk", back_populates="user", cascade="all, delete-orphan")


class Collection(Base):
    __tablename__ = "collections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    user = relationship("User", back_populates="collections")
    documents = relationship("Document", back_populates="collection", cascade="all, delete-orphan")
    chunks = relationship("DocumentChunk", back_populates="collection", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    collection_id = Column(Integer, ForeignKey("collections.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    user = relationship("User", back_populates="documents")
    collection = relationship("Collection", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    collection_id = Column(Integer, ForeignKey("collections.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)

    # Relationships
    user = relationship("User", back_populates="chunks")
    document = relationship("Document", back_populates="chunks")
    collection = relationship("Collection", back_populates="chunks")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    username = Column(String, nullable=False)
    prompt = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    model_used = Column(String, nullable=False)
    response_time_ms = Column(Float, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    user = relationship("User", back_populates="audit_logs")

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, index=True)  # UUID stored as string
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    user = relationship("User", back_populates="sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    references = Column(Text, nullable=True)  # JSON-serialized array of source references
    response_time_ms = Column(Float, nullable=True)
    model_used = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    session = relationship("ChatSession", back_populates="messages")

class UserMemory(Base):
    """Persistent long-term memory facts extracted from conversations, stored per user.
    Survives across all sessions, refreshes, and chat history deletions."""
    __tablename__ = "user_memory"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    fact = Column(Text, nullable=False)           # The extracted memory fact
    # Which part of the person this fact describes, so the memory can be
    # browsed by topic rather than as one long undifferentiated list.
    category = Column(String, nullable=True, default="durable_record")
    source_session_id = Column(String, nullable=True)  # Which session it came from
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.now, nullable=False)
    # Relationships
    user = relationship("User", back_populates="memories")

class PairedDevice(Base):
    """A phone or tablet linked to this desktop by scanning its QR code.

    The token is the device's only credential: it is generated when the QR is
    shown and handed over once, so it never travels except on the local
    network during pairing.
    """
    __tablename__ = "paired_devices"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    kind = Column(String, default="phone", nullable=False)  # phone | tablet | desktop
    token = Column(String, unique=True, index=True, nullable=False)
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    user = relationship("User")


class CustomPlugin(Base):
    """User-defined custom plugins, skills, and MCP connectors."""
    __tablename__ = "custom_plugins"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # "plugin", "skill", "connector", "mcp"
    url = Column(String, nullable=False)   # Git URL or MCP server endpoint
    description = Column(Text, nullable=True)
    config = Column(Text, nullable=True)   # JSON-serialized custom configuration/headers
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    user = relationship("User")




