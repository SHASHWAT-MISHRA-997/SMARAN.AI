import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user", nullable=False)  # "admin" or "user"
    is_approved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)
    last_login = Column(DateTime, nullable=True)
    login_count = Column(Integer, default=0, nullable=False)

    # Relationships
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")
    memories = relationship("UserMemory", back_populates="user", cascade="all, delete-orphan")


class Collection(Base):
    __tablename__ = "collections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    documents = relationship("Document", back_populates="collection", cascade="all, delete-orphan")
    chunks = relationship("DocumentChunk", back_populates="collection", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    collection_id = Column(Integer, ForeignKey("collections.id"), nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    collection = relationship("Collection", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    collection_id = Column(Integer, ForeignKey("collections.id"), nullable=False)
    text = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)

    # Relationships
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
    source_session_id = Column(String, nullable=True)  # Which session it came from
    created_at = Column(DateTime, default=datetime.datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.now, nullable=False)

    # Relationships
    user = relationship("User", back_populates="memories")


class VisitorLog(Base):
    """Production-grade Visitor Analytics log for tracking developer metrics, logins, IP addresses, and user activity."""
    __tablename__ = "visitor_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String, nullable=False)
    role = Column(String, default="user", nullable=False)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    event_type = Column(String, default="login", nullable=False) # "login", "register", "password_reset"
    timestamp = Column(DateTime, default=datetime.datetime.now, nullable=False)


