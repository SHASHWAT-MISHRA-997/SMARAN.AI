import json
import logging
import os
import uuid
import time
import shutil
import magic
from datetime import datetime, timedelta
from typing import Generator, List, Optional
from pydantic import BaseModel as PydanticBaseModel
import requests
import httpx
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.config import settings
from app.database import engine, Base, SessionLocal, get_db
from app.models import User, Collection, Document, DocumentChunk, AuditLog, ChatSession, ChatMessage, UserMemory, VisitorLog
from app.schemas import (
    UserCreate, UserResponse, UserUpdate, Token, PasswordResetRequest, MasterRecoveryRequest, VisitorLogResponse, DeveloperAnalyticsResponse, UserMemoryCreate, UserMemoryResponse,
    CollectionCreate, CollectionResponse, DocumentResponse,
    ChatRequest, ChatSessionResponse, ChatMessageResponse, ChatSessionCreate,
    SystemStatsResponse, AuditLogResponse
)
from app.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, get_current_approved_user, get_admin_user
)
import asyncio
import gc
from app.rag.chunking import RecursiveCharacterTextSplitter, DocumentChunker
from app.rag.pipeline import RAGPipeline
from app.utils import parse_file_content, get_system_telemetry, zep_add_message, zep_get_history, fetch_url_content
from app.vision import pdf_to_images, encode_image_base64, call_vision_model, stream_vision_response, cleanup_after_processing
from app.models_catalog import get_full_catalog, MODELS_CATALOG, check_download_status
from app.web_search import perform_web_search

# SlowAPI Rate Limiting Setup
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)

# Setup Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("main")

# Initialize database tables
Base.metadata.create_all(bind=engine)

# Programmatic database migration: add model_used column & create user_memory table
try:
    from sqlalchemy import text as _sql_text
    with engine.begin() as conn:
        conn.execute(_sql_text("ALTER TABLE chat_messages ADD COLUMN model_used VARCHAR(50);"))
    logger.info("Migrated SQL: added model_used column.")
except Exception:
    pass  # Column already exists

try:
    from sqlalchemy import text as _sql_text
    with engine.begin() as conn:
        conn.execute(_sql_text("ALTER TABLE documents ADD COLUMN session_id VARCHAR(50);"))
    logger.info("Migrated SQL: added session_id column to documents.")
except Exception:
    pass

Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.PROJECT_NAME)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from app.telemetry import start_periodic_telemetry, get_or_create_installation_id, send_creator_heartbeat

# Start Creator Telemetry (anonymous heartbeat for Shashwat to track active installations)
start_periodic_telemetry()

# Global Exception Handler (Zero information leakage)
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    if isinstance(exc, HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail}
        )
    logger.exception("Global unhandled exception caught")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"Request processing failed: {str(exc)}"}
    )

app.mount("/api/static", StaticFiles(directory=settings.UPLOAD_DIR), name="static")

# CORS configuration - Allow all local/LAN client origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global trackers for latency average
latency_metrics = []
_model_latencies = {}

# Global set: tracks model IDs that are currently downloading (not yet ready)
# This is updated by /api/model/status and used by /api/models to avoid false "Ready" status
_model_download_in_progress: set = set()


# Initialize RAG Pipeline
rag_pipeline = RAGPipeline()

# Async Semaphore to serialize inference requests and prevent VRAM OOM crashes
inference_semaphore = asyncio.Semaphore(1)

# Seeding first user as admin on startup and auto-migrating DB schema
@app.on_event("startup")
def seed_admin():
    # 1. Ensure all SQLAlchemy tables exist and columns are migrated
    try:
        Base.metadata.create_all(bind=engine)
        from sqlalchemy import text
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(users)")).fetchall()
            columns = [row[1] for row in result]
            if "last_login" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN last_login DATETIME"))
            if "login_count" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0"))
            conn.commit()
    except Exception as me:
        logger.warning(f"Database auto-migration note: {me}")

    # 2. Seed default admin if database is new
    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count == 0:
            admin_user = User(
                username="admin",
                password_hash=hash_password("admin@123"),
                role="admin",
                is_approved=True,
                login_count=0
            )
            db.add(admin_user)
            db.commit()
            logger.info("Database was empty. Seeded default user: admin / admin@123")
    except Exception as e:
        logger.error(f"Error seeding default admin: {e}")
    finally:
        db.close()



def get_real_client_ip(request: Request) -> str:
    if not request:
        return "127.0.0.1 (Local Host)"
    # 1. Check X-Forwarded-For header
    x_forwarded = request.headers.get("X-Forwarded-For")
    if x_forwarded:
        ip = x_forwarded.split(",")[0].strip()
        if ip and not ip.startswith("172."):
            return ip
            
    # 2. Check X-Real-IP header
    x_real = request.headers.get("X-Real-IP")
    if x_real and not x_real.startswith("172."):
        return x_real

    # 3. Fallback to client host
    raw_ip = request.client.host if (request and request.client) else "127.0.0.1"
    if raw_ip.startswith("172.") or raw_ip == "127.0.0.1":
        try:
            import socket
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            lan_ip = s.getsockname()[0]
            s.close()
            return f"127.0.0.1 (LAN: {lan_ip})"
        except Exception:
            return "127.0.0.1 (Local Host)"
            
    return raw_ip


# --- Authentication Endpoints ---

@app.post("/api/auth/register", response_model=UserResponse)
@limiter.limit("5/minute")
def register(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
    # Check if username exists
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    # Check if this is the first user
    user_count = db.query(User).count()
    role = "admin" if user_count == 0 else "user"
    # Auto-approve so new users can log in immediately without friction
    is_approved = True

    new_user = User(
        username=user_data.username,
        password_hash=hash_password(user_data.password),
        role=role,
        is_approved=is_approved,
        login_count=0
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    client_ip = get_real_client_ip(request)
    user_agent = request.headers.get("user-agent", "Unknown Browser/Device")
    try:
        v_log = VisitorLog(
            user_id=new_user.id,
            username=new_user.username,
            role=new_user.role,
            ip_address=client_ip,
            user_agent=user_agent,
            event_type="register"
        )
        db.add(v_log)
        db.commit()
    except Exception:
        pass

    return new_user

@app.post("/api/auth/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_data.username).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
        
    if not user.is_approved:
        # Auto-heal approval if blocked
        user.is_approved = True
        db.commit()
        
    # Update login metrics & visitor log
    user.last_login = datetime.now()
    user.login_count = (user.login_count or 0) + 1
    db.commit()

    client_ip = get_real_client_ip(request)
    user_agent = request.headers.get("user-agent", "Unknown Browser/Device")
    try:
        v_log = VisitorLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            ip_address=client_ip,
            user_agent=user_agent,
            event_type="login"
        )
        db.add(v_log)
        db.commit()
    except Exception:
        pass

    # Generate JWT token
    access_token = create_access_token(data={"sub": user.username, "id": user.id, "role": user.role})
    return Token(
        access_token=access_token,
        token_type="bearer",
        role=user.role,
        username=user.username
    )

@app.post("/api/auth/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, reset_data: PasswordResetRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == reset_data.username.strip()).first()
    if not user:
        raise HTTPException(status_code=404, detail="Username not found. Please verify your username.")
    
    user.password_hash = hash_password(reset_data.new_password)
    user.is_approved = True
    db.commit()

    client_ip = request.client.host if request.client else "127.0.0.1"
    user_agent = request.headers.get("user-agent", "Unknown Browser/Device")
    try:
        v_log = VisitorLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            ip_address=client_ip,
            user_agent=user_agent,
            event_type="password_reset"
        )
        db.add(v_log)
        db.commit()
    except Exception:
        pass

    return {"message": f"Password for '{user.username}' reset successfully! You can now log in."}

@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_approved_user)):
    return current_user

@app.post("/api/auth/master-recovery")
@limiter.limit("5/minute")
def master_recovery(request: Request, body: MasterRecoveryRequest, db: Session = Depends(get_db)):
    """Master Developer Recovery Mode: If user forgets BOTH username and password."""
    valid_master_keys = {"SMARAN-DEV-RECOVERY", "admin@123", settings.JWT_SECRET}
    if body.master_key.strip() not in valid_master_keys:
        raise HTTPException(status_code=401, detail="Invalid Master Developer Recovery Key.")
        
    all_users = db.query(User).all()
    user_list = [{"username": u.username, "role": u.role, "created_at": str(u.created_at)} for u in all_users]
    
    if body.target_username and body.new_password:
        target = db.query(User).filter(User.username == body.target_username.strip()).first()
        if not target:
            # Create target admin account if not found
            target = User(
                username=body.target_username.strip(),
                password_hash=hash_password(body.new_password),
                role="admin",
                is_approved=True,
                login_count=0
            )
            db.add(target)
        else:
            target.password_hash = hash_password(body.new_password)
            target.is_approved = True
            target.role = "admin"
        db.commit()
        
        # Refresh user list after modification
        all_users = db.query(User).all()
        user_list = [{"username": u.username, "role": u.role, "created_at": str(u.created_at)} for u in all_users]
        
        return {
            "message": f"Master Recovery Success! Account '{target.username}' (Admin) updated with new password. You can now log in.",
            "accounts": user_list
        }
        
    return {
        "message": "Master Key Verified! Registered software accounts retrieved below.",
        "accounts": user_list
    }


# --- Collections Endpoints ---

@app.post("/api/collections", response_model=CollectionResponse)
def create_collection(col_data: CollectionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    existing = db.query(Collection).filter(Collection.name == col_data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists")
        
    col = Collection(name=col_data.name, description=col_data.description)
    db.add(col)
    db.commit()
    db.refresh(col)
    return col

@app.get("/api/collections", response_model=List[CollectionResponse])
def list_collections(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    collections = db.query(Collection).all()
    results = []
    for col in collections:
        doc_count = db.query(Document).filter(Document.collection_id == col.id).count()
        results.append(
            CollectionResponse(
                id=col.id,
                name=col.name,
                description=col.description,
                created_at=col.created_at,
                doc_count=doc_count
            )
        )
    return results

@app.delete("/api/collections/{col_id}")
def delete_collection(col_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    # Delete associated file paths from local drive
    for doc in col.documents:
        if os.path.exists(doc.file_path):
            try:
                os.remove(doc.file_path)
            except Exception:
                pass
                
    # Delete vectors from database(s)
    try:
        rag_pipeline.delete_collection(col_id)
    except Exception as e:
        logger.error(f"Error clearing vectors for collection {col_id}: {e}")
        
    db.delete(col)
    db.commit()
    return {"message": f"Collection '{col.name}' and all associated files deleted successfully"}


# --- Document Upload & Management Endpoints ---

@app.post("/api/collections/{col_id}/upload", response_model=DocumentResponse)
async def upload_document(
    col_id: int,
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    # Validate the supplied filename before persisting anything.
    filename = os.path.basename(file.filename or "")
    if not filename or "." not in filename:
        raise HTTPException(status_code=400, detail="Please choose a file with a supported extension.")
    file_type = filename.rsplit(".", 1)[1].lower()
    supported_types = {
        "pdf", "csv", "xlsx", "docx", "pptx", "txt", "md", "xml", "py", "cpp", "h", "json", "yaml", "yml", "log", "html", "htm",
        "mp3", "wav", "m4a", "ogg", "flac",
        "mp4", "avi", "mkv", "webm", "mov", "flv",
        "png", "jpg", "jpeg", "webp", "bmp", "tiff"
    }
    if file_type not in supported_types:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload PDF, CSV, Excel, Docx, PPTX, TXT, Audio (MP3/WAV), Video (MP4/MKV/AVI), Images (PNG/JPG), or source files.")
    
    # Smart Re-Upload: If file with same name exists, auto-replace (delete old chunks + re-ingest)
    existing_doc = db.query(Document).filter(Document.name == filename, Document.collection_id == col_id).first()
    if existing_doc:
        logger.info(f"Smart re-upload: replacing existing '{filename}' (doc_id={existing_doc.id}) with updated version.")
        # Delete old chunks from vector DB
        try:
            rag_pipeline.delete_document(existing_doc.collection_id, existing_doc.id)
        except Exception as e:
            logger.warning(f"Vector delete during re-upload failed: {e}")
        # Delete old chunks from SQL
        db.query(DocumentChunk).filter(DocumentChunk.document_id == existing_doc.id).delete()
        # Delete old file from disk
        if os.path.exists(existing_doc.file_path):
            try:
                os.remove(existing_doc.file_path)
            except Exception:
                pass
        # Delete old document record
        db.delete(existing_doc)
        db.commit()

    file_uuid = uuid.uuid4().hex
    saved_filename = f"{file_uuid}.{file_type}"
    file_path = os.path.join(settings.UPLOAD_DIR, saved_filename)
    
    db_doc = None
    try:
        content = await file.read()
        file_size = len(content)
        if file_size == 0:
            raise HTTPException(status_code=400, detail="The selected file is empty.")
        if file_size > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"File is larger than the {settings.MAX_UPLOAD_SIZE_MB} MB upload limit.")
        
        # Write to temporary uploads directory
        with open(file_path, "wb") as f:
            f.write(content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # -- FILE SAFETY CHECK (python-magic + signature fallback) --
    mime_type = None
    try:
        mime = magic.Magic(mime_only=True)
        mime_type = mime.from_file(file_path)
    except Exception as e:
        logger.warning(f"python-magic failed to read MIME: {e}. Falling back to byte signature validation.")
        # Pure-python byte signature fallback
        try:
            with open(file_path, 'rb') as f:
                head = f.read(1024)
            if head.startswith(b'MZ'):
                mime_type = 'application/x-msdownload'
            elif head.startswith(b'#!/bin/sh') or head.startswith(b'#!/bin/bash'):
                mime_type = 'text/x-shellscript'
            elif head.startswith(b'%PDF'):
                mime_type = 'application/pdf'
            elif head.startswith(b'PK\x03\x04'):
                mime_type = 'application/zip'
            else:
                import mimetypes
                mime_type, _ = mimetypes.guess_type(file_path)
        except Exception:
            pass

    # Reject executables and system scripts
    forbidden_mimes = [
        'application/x-msdownload',   # EXE, DLL
        'application/x-sh',            # shell script
        'application/x-shellscript',   # shell script
        'application/x-bat',           # batch
        'application/x-msdos-program',  # EXE
        'application/x-executable'     # ELF binary
    ]
    if mime_type in forbidden_mimes:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security violation: upload of executables or system script files is strictly forbidden."
        )

    # Heavy media check - Archive media files larger than 20MB
    is_media = mime_type and (mime_type.startswith("video/") or mime_type.startswith("audio/"))
    if is_media and file_size > 20 * 1024 * 1024:
        try:
            archive_dir = os.path.join(settings.DATA_DIR, "archive")
            os.makedirs(archive_dir, exist_ok=True)
            archive_path = os.path.join(archive_dir, filename)
            shutil.copy2(file_path, archive_path)
            logger.info(f"Archived heavy media file: {filename} to {archive_path}")
        except Exception as ae:
            logger.error(f"Failed to archive media: {ae}")

    try:
        # 1. Parse File Content
        parsed_text = parse_file_content(file_path, file_type)
        if not parsed_text.strip():
            raise ValueError("File is empty or contains no extractable text.")

        # 2. Chunking — use document-type-aware and semantic settings with contextual prefixes for best accuracy
        splitter = DocumentChunker.for_file_type(file_type, doc_name=filename)
        chunks = splitter.split_text(parsed_text)
        
        # Save document entity to SQLite
        db_doc = Document(
            name=filename,
            collection_id=col_id,
            file_path=file_path,
            file_type=file_type,
            file_size=file_size,
            session_id=session_id
        )
        db.add(db_doc)
        db.commit()
        db.refresh(db_doc)
        
        # Save chunks to SQLite for BM25 and reference searches
        db_chunks = []
        chunk_texts = []
        chunk_ids = []
        
        for idx, chunk_text in enumerate(chunks):
            db_chunk = DocumentChunk(
                document_id=db_doc.id,
                collection_id=col_id,
                text=chunk_text,
                chunk_index=idx
            )
            db_chunks.append(db_chunk)
            chunk_texts.append(chunk_text)
            chunk_ids.append(f"chunk-{db_chunk.chunk_index}-{file_uuid}")
            
        db.add_all(db_chunks)
        db.commit()
        
        # Refresh chunk IDs from DB to save in Qdrant
        qdrant_ids = [f"chunk-{c.id}" for c in db_chunks]
        
        # 3. Vector Embeddings and Database Insertion
        embeddings = rag_pipeline.embeddings.embed_documents(chunk_texts)
        rag_pipeline.add_chunks(
            collection_id=col_id,
            document_id=db_doc.id,
            chunk_ids=qdrant_ids,
            texts=chunk_texts,
            embeddings=embeddings
        )
        
        return db_doc
    except Exception as e:
        # Keep SQLite, Qdrant, and disk in sync when any ingestion stage fails.
        db.rollback()
        if db_doc:
            try:
                rag_pipeline.delete_document(col_id, db_doc.id)
                stored_doc = db.query(Document).filter(Document.id == db_doc.id).first()
                if stored_doc:
                    db.delete(stored_doc)
                    db.commit()
            except Exception as cleanup_error:
                db.rollback()
                logger.error(f"Ingestion cleanup failed for {filename}: {cleanup_error}")
        if os.path.exists(file_path):
            os.remove(file_path)
        logger.error(f"Ingestion pipeline failed for {filename}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to process document: {str(e)}")

@app.get("/api/collections/{col_id}/documents", response_model=List[DocumentResponse])
def get_documents(
    col_id: int,
    session_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
    if session_id:
        return db.query(Document).filter(Document.collection_id == col_id, Document.session_id == session_id).all()
    return col.documents

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Delete from filesystem
    if os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except Exception:
            pass
            
    # Delete from database(s)
    try:
        rag_pipeline.delete_document(doc.collection_id, doc.id)
    except Exception as e:
        logger.error(f"Vector delete failed for document {doc_id}: {e}")
        
    db.delete(doc)
    db.commit()
    return {"message": f"Document '{doc.name}' deleted successfully"}



# --- Chat Routing & streaming RAG ---

@app.post("/api/chat/sessions", response_model=ChatSessionResponse)
def create_session(session_data: ChatSessionResponse = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    session_id = uuid.uuid4().hex
    title = f"Chat Session {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    session = ChatSession(id=session_id, user_id=current_user.id, title=title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@app.get("/api/chat/sessions", response_model=List[ChatSessionResponse])
def list_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    return db.query(ChatSession).order_by(ChatSession.updated_at.desc()).all()

@app.delete("/api/chat/sessions/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    db.delete(session)
    db.commit()
    return {"message": "Chat session deleted"}

@app.put("/api/chat/sessions/{session_id}", response_model=ChatSessionResponse)
def rename_session(session_id: str, rename_data: ChatSessionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    session.title = rename_data.title
    session.updated_at = datetime.now()
    db.commit()
    db.refresh(session)
    return session


@app.get("/api/chat/sessions/{session_id}/messages")
def get_session_messages(session_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
        
    messages = []
    for msg in session.messages:
        refs = None
        if msg.references:
            try:
                refs = json.loads(msg.references)
            except Exception:
                pass
        messages.append({
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "references": refs,
            "response_time_ms": msg.response_time_ms,
            "model_used": msg.model_used,
            "created_at": msg.created_at
        })
    return messages


class MessageEditRequest(PydanticBaseModel):
    content: str

@app.put("/api/chat/messages/{msg_id}")
def edit_chat_message(msg_id: int, edit_req: MessageEditRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    msg = db.query(ChatMessage).filter(ChatMessage.id == msg_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    session = db.query(ChatSession).filter(ChatSession.id == msg.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    # Delete all subsequent messages in this session
    db.query(ChatMessage).filter(
        ChatMessage.session_id == msg.session_id,
        ChatMessage.created_at > msg.created_at
    ).delete()
    
    # Update this user message content
    msg.content = edit_req.content
    msg.created_at = datetime.now()
    db.commit()
    
    return {"status": "ok", "message": "Message edited and subsequent dialogue branched."}


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENT MEMORY — extract key facts from each conversation & store per user
# ─────────────────────────────────────────────────────────────────────────────

async def _extract_and_save_memory(user_id: int, session_id: str, user_prompt: str, ai_response: str):
    """Background task: extract meaningful facts from the turn and persist them in user_memory table.
    Runs in a fire-and-forget asyncio task — never blocks the streaming response."""
    try:
        import re
        facts_to_save = []

        # 1. Regex rule-based extraction as fallback/primary
        name_match = re.search(
            r"(?:my name is|i am|i'm|call me|mera naam)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)",
            user_prompt, re.IGNORECASE
        )
        if name_match:
            facts_to_save.append(f"User's name: {name_match.group(1).strip()}")

        role_match = re.search(
            r"(?:i am|i'm|i work as|my role is|my designation is)\s+(a |an )?([a-zA-Z ]{3,40})",
            user_prompt, re.IGNORECASE
        )
        if role_match:
            role = role_match.group(2).strip().rstrip('.,')
            if len(role) > 3:
                facts_to_save.append(f"User's role/designation: {role}")

        pref_match = re.search(
            r"(?:i prefer|i like|i always|i usually|i love|i hate|i don't like|yaad rakhna ki|yaad rakho ki)\s+(.{5,80})",
            user_prompt, re.IGNORECASE
        )
        if pref_match:
            pref = pref_match.group(1).strip().rstrip('.,')
            if len(pref) > 5:
                facts_to_save.append(f"User preference: {pref}")

        dept_match = re.search(
            r"(?:i'm from|i work in|my department is|my team is)\s+(the )?([a-zA-Z ]{3,50})",
            user_prompt, re.IGNORECASE
        )
        if dept_match:
            dept = dept_match.group(2).strip().rstrip('.,')
            if len(dept) > 3:
                facts_to_save.append(f"User's department/team: {dept}")

        # 2. Advanced LLM-based fact extraction (Gemini/Claude style)
        hw_cfg = {}
        try:
            hw_path = os.path.join(settings.DATA_DIR, "hardware_config.json")
            if os.path.exists(hw_path):
                with open(hw_path) as _hf:
                    hw_cfg = json.load(_hf)
        except Exception:
            pass

        engine = hw_cfg.get("engine", settings.INFERENCE_ENGINE)
        api_url = hw_cfg.get("api_url", settings.VLLM_URL if engine == "vllm" else settings.OLLAMA_URL)
        model_to_use = hw_cfg.get("model_id", settings.ACTIVE_MODEL)

        prompt_text = (
            "You are a memory processor. Analyze the conversation turn and extract any new key facts, preferences, user info, "
            "names, roles, projects, or interests about the user. "
            "Ignore temporary conversation details, generic questions, or greetings. "
            "Output the extracted facts as a list, one fact per line, with no bullets, no numbering, and no intro/outro text. "
            "Example:\n"
            "User's name is Rahul\n"
            "User prefers Python\n"
            "User is calibrating the GMR robotic arm\n\n"
            "If no persistent user facts are present, reply with 'NONE'.\n\n"
            f"User Prompt: {user_prompt}\n"
            f"Assistant Response: {ai_response}"
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                if engine == "vllm":
                    url = f"{api_url.rstrip('/')}/chat/completions"
                    payload = {
                        "model": model_to_use,
                        "messages": [{"role": "user", "content": prompt_text}],
                        "temperature": 0.0,
                        "max_tokens": 256
                    }
                    r = await client.post(url, json=payload)
                    if r.status_code == 200:
                        content = r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                    else:
                        content = ""
                else:
                    url = f"{api_url.rstrip('/')}/api/generate"
                    payload = {
                        "model": model_to_use,
                        "prompt": prompt_text,
                        "stream": False,
                        "options": {
                            "temperature": 0.0,
                            "num_predict": 256
                        }
                    }
                    r = await client.post(url, json=payload)
                    if r.status_code == 200:
                        content = r.json().get("response", "")
                    else:
                        content = ""

            if content and content.strip().upper() != "NONE":
                # Strip out <think>...</think> tags if model did reasoning
                if "<think>" in content:
                    parts = content.split("</think>", 1)
                    content = parts[1] if len(parts) > 1 else ""

                for line in content.splitlines():
                    line = line.strip().strip("-*•# ").strip()
                    if not line:
                        continue
                    line_upper = line.upper()
                    if any(x in line_upper for x in ["NONE", "EXTRACT", "CONVERSATION", "PROMPT", "ASSISTANT", "FACT:", "HERE IS", "HERE ARE"]):
                        continue
                    if len(line) > 5 and not line.startswith("[") and "?" not in line:
                        facts_to_save.append(line)
        except Exception as llm_err:
            logger.error(f"LLM fact extraction failed: {llm_err}")

        if not facts_to_save:
            return  # Nothing worth saving from this turn

        db_mem = SessionLocal()
        try:
            existing_facts = {m.fact for m in db_mem.query(UserMemory).filter(UserMemory.user_id == user_id).all()}
            for fact in facts_to_save:
                fact_clean = fact.strip().lower()
                if not any(ef.strip().lower() == fact_clean for ef in existing_facts):
                    db_mem.add(UserMemory(
                        user_id=user_id,
                        fact=fact,
                        source_session_id=session_id
                    ))
            db_mem.commit()
            logger.info(f"Saved {len(facts_to_save)} memory facts for user_id={user_id}")
        except Exception as e:
            db_mem.rollback()
            logger.error(f"Memory save error: {e}")
        finally:
            db_mem.close()
    except Exception as ex:
        logger.error(f"_extract_and_save_memory outer error: {ex}")


@app.get("/api/memory")
async def get_user_memory(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    """Return all persistent memory facts stored for the current user."""
    memories = db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id
    ).order_by(UserMemory.created_at.desc()).all()
    return [{"id": m.id, "fact": m.fact, "created_at": m.created_at} for m in memories]


@app.delete("/api/memory/clear")
async def clear_user_memory(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    """Permanently erase ALL persistent memory facts for the current user."""
    deleted = db.query(UserMemory).filter(UserMemory.user_id == current_user.id).delete()
    db.commit()
    logger.info(f"Cleared {deleted} memory facts for user_id={current_user.id} ({current_user.username})")
    return {"message": f"Memory cleared. {deleted} facts erased.", "cleared_count": deleted}


@app.delete("/api/memory/{memory_id}")
async def delete_single_memory(memory_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    """Delete a single memory fact by its ID (selective memory management)."""
    fact = db.query(UserMemory).filter(
        UserMemory.id == memory_id,
        UserMemory.user_id == current_user.id  # Ensure user can only delete their own facts
    ).first()
    if not fact:
        raise HTTPException(status_code=404, detail="Memory fact not found or access denied")
    db.delete(fact)
    db.commit()
    logger.info(f"Deleted memory fact id={memory_id} for user_id={current_user.id}")
    return {"message": "Memory fact deleted.", "id": memory_id}


def _installed_ollama_models() -> list[str]:
    try:
        response = requests.get(f"{settings.OLLAMA_URL.rstrip('/')}/api/tags", timeout=3)
        response.raise_for_status()
        return [item.get("name", "") for item in response.json().get("models", [])]
    except requests.RequestException:
        return []

def _matches_installed(preferred: str, installed: list[str]) -> Optional[str]:
    """Resolve tag aliases, such as qwen2.5vl and qwen2.5-vl:7b."""
    preferred_base = preferred.split(":", 1)[0].replace("-", "").lower()
    for model in installed:
        if model == preferred:
            return model
    for model in installed:
        if model.split(":", 1)[0].replace("-", "").lower() == preferred_base:
            return model
    return None

def _auto_route_model(prompt: str, installed: list[str]) -> str:
    p = prompt.lower().strip()
    
    # 1. Vision / Image / Document OCR / Multi-modal
    vision_kw = ["image", "photo", "picture", "pdf", "ocr", "document", "scan", "diagram", "screenshot", "visual", "look at", "see"]
    if any(kw in p for kw in vision_kw):
        if check_download_status("microsoft/phi-3.5-vision-instruct"):
            return "microsoft/phi-3.5-vision-instruct"
        return "Qwen/Qwen3-4B-AWQ"

    # 2. Complex Reasoning / Math / Logic / Deep Analysis
    reasoning_kw = [
        "calculate", "compute", "solve", "equation", "formula", "math",
        "sql", "query", "database", "logic", "proof", "derive", "analyze",
        "analysis", "compare", "reason", "think step", "why does", "explain how",
        "algorithm", "statistics", "predict", "forecast", "deep"
    ]
    if any(kw in p for kw in reasoning_kw):
        for candidate in ["Qwen/Qwen3-8B", "microsoft/phi-3.5-vision-instruct", "Qwen/Qwen3-4B-AWQ"]:
            if check_download_status(candidate):
                return candidate

    # 3. Default fallback to active downloaded model or Qwen3-4B-AWQ
    if settings.ACTIVE_MODEL and check_download_status(settings.ACTIVE_MODEL):
        return settings.ACTIVE_MODEL
    return "Qwen/Qwen3-4B-AWQ"


def generate_fallback_image(prompt: str) -> str:
    import uuid
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (512, 512), "#1e1e2f")
    draw = ImageDraw.Draw(img)
    for i in range(0, 512, 32):
        draw.line([(i, 0), (i, 512)], fill="#2d2d44")
        draw.line([(0, i), (512, i)], fill="#2d2d44")
    
    draw.text((20, 20), "SMARAN.AI — GRAPHICS ENGINE", fill="#8ab4f8")
    wrapped_text = prompt[:60] + ("..." if len(prompt) > 60 else "")
    draw.text((20, 240), f"Prompt: {wrapped_text}", fill="#ffffff")
    draw.text((20, 470), "Mode: Offline Fallback Active", fill="#a8a8af")
    
    filename = f"gen_{uuid.uuid4().hex[:8]}.png"
    filepath = os.path.join(os.getenv("DATA_DIR", "./data"), "uploads", filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    img.save(filepath, format="PNG")
    return f"![Generated Image](/api/static/{filename})"


def generate_fallback_video(prompt: str) -> str:
    import uuid
    from PIL import Image, ImageDraw
    frames = []
    for f_idx in range(8):
        img = Image.new("RGB", (320, 240), "#11111b")
        draw = ImageDraw.Draw(img)
        x = 40 + f_idx * 30
        draw.ellipse([(x - 20, 100), (x + 20, 140)], fill="#8ab4f8")
        draw.text((10, 10), "SMARAN.AI — VIDEO ENGINE", fill="#a8a8af")
        draw.text((10, 200), f"Prompt: {prompt[:30]}...", fill="#ffffff")
        frames.append(img)
        
    filename = f"gen_video_{uuid.uuid4().hex[:8]}.gif"
    filepath = os.path.join(os.getenv("DATA_DIR", "./data"), "uploads", filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    frames[0].save(filepath, save_all=True, append_images=frames[1:], duration=150, loop=0)
    return f"![Generated Video](/api/static/{filename})"


def call_sd_txt2img_bridge(prompt: str) -> str:
    url = os.getenv("SD_WEBUI_URL", "http://localhost:7860") + "/sdapi/v1/txt2img"
    payload = {
        "prompt": prompt,
        "steps": 20,
        "width": 512,
        "height": 512,
        "cfg_scale": 7.0
    }
    try:
        resp = requests.post(url, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            images = data.get("images", [])
            if images:
                import base64
                img_data = base64.b64decode(images[0])
                filename = f"sd_gen_{int(time.time())}.png"
                filepath = os.path.join(os.getenv("DATA_DIR", "./data"), "uploads", filename)
                os.makedirs(os.path.dirname(filepath), exist_ok=True)
                with open(filepath, "wb") as f:
                    f.write(img_data)
                return f"![Generated Image](/api/static/{filename})"
    except Exception:
        pass
    
    return generate_fallback_image(prompt)


@app.post("/api/chat")
async def chat_interaction(chat_req: ChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    # Validate session
    session = db.query(ChatSession).filter(ChatSession.id == chat_req.session_id).first()
    if not session:
        # Create dynamically if doesn't exist
        session = ChatSession(id=chat_req.session_id, user_id=current_user.id, title=chat_req.prompt[:30])
        db.add(session)
        db.commit()
        db.refresh(session)

    # 1. Pipeline RAG Search
    retrieved_chunks = []
    if chat_req.collections:
        retrieved_chunks = rag_pipeline.search(
            db=db,
            query=chat_req.prompt,
            collection_ids=chat_req.collections,
            limit=10  # Increased from 5 to 10 — covers large BoM/PO/Invoice tables better
        )

    # Compile Context String
    context_str = ""
    if retrieved_chunks:
        context_parts = []
        for idx, c in enumerate(retrieved_chunks):
            context_parts.append(f"Source Document [{idx+1}]: {c['document_name']} (Chunk {c['chunk_index']})\nText: {c['text']}\n")
        context_str = "\n".join(context_parts)

    # 2. Retrieve Persistent Long-term User Memory (survives across sessions, refresh, chat deletions)
    memory_context = ""
    try:
        user_memories = db.query(UserMemory).filter(
            UserMemory.user_id == current_user.id
        ).order_by(UserMemory.updated_at.desc()).limit(20).all()
        if user_memories:
            mem_lines = [f"- {m.fact}" for m in user_memories]
            memory_context = "Long-term memory facts about this user:\n" + "\n".join(mem_lines)
    except Exception as me:
        logger.error(f"Error retrieving user memory: {me}")

    # Load auto-selected model info for system prompt context
    _hw_cfg_sp = {}
    try:
        _hw_p = "/app/data/hardware_config.json"
        if os.path.exists(_hw_p):
            with open(_hw_p) as _hf: _hw_cfg_sp = json.load(_hf)
    except Exception: pass
    _is_reasoning_model = _hw_cfg_sp.get("reasoning_model", False)

    # Build context-aware thinking instruction
    _thinking_instruction = (
        "THINKING MODE: Before giving your final answer, reason step-by-step inside <think>...</think> tags. "
        "Analyze the question carefully, consider all angles, verify your logic, then provide the final clean answer outside the tags. "
        "This applies especially to complex, analytical, or multi-part questions.\n\n"
        if _is_reasoning_model else ""
    )

    system_prompt = (
        f"{_thinking_instruction}"
        "You are Smaran AI — the intelligent AI assistant for Smaran Robotics & Manufacturing Pvt. Ltd. "
        "Respond like a top-tier AI: precise, clean, and direct. "
        "Answer ONLY what is asked. Never add unrequested information, disclaimers, suggestions, or caveats.\n\n"

        "═══ IDENTITY & DEVELOPER PROFILE (AUTHORITATIVE FACTS — NO HALLUCINATION) ═══\n"
        "① DEVELOPER PROFILE — SHASHWAT MISHRA:\n"
        "   • Name: Shashwat Mishra\n"
        "   • Professional Title: AI & Robotics Engineer | MTech Graduate | Lead Developer of Smaran AI\n"
        "   • Core Expertise: Artificial Intelligence, Generative AI, Machine Learning, Robotics, Data Science, Full-Stack Web Systems (React, Python, FastAPI, vLLM), and Power BI.\n"
        "   • Creator & Architect of: Smaran AI — Enterprise Knowledge & RAG Intelligence Console.\n"
        "   • Official LinkedIn: https://www.linkedin.com/in/sm980/\n"
        "   • Official Portfolio: https://shashwatmishra-portfolio.netlify.app/\n"
        "   • ABSOLUTE RULE FOR DEVELOPER QUERIES: When asked 'tell me about Shashwat Mishra', 'who is Shashwat Mishra', 'who made you', 'who developed you', 'who is the developer', or any query about Shashwat Mishra, provide ONLY these exact verified facts with his LinkedIn and Portfolio links. NEVER invent or hallucinate fake degrees, fake companies, fake projects, or random unverified facts.\n\n"
        "═══ RULE 1 — ACCURACY & STRICT SOURCE GROUNDING (NO HALLUCINATIONS) ═══════════════\n"
        "• State strictly what is known from provided documents or authoritative system context.\n"
        "• NEVER invent facts, fake company names, fabricated dates, or non-existent details.\n"
        "• If CONTEXT DOCUMENTS are provided below: answer primarily from those documents and cite sources.\n"
        "• Read ALL provided document chunks before answering.\n"
        "• For tabular data (Excel, CSV, BoM, Invoice): scan every row in the provided chunks.\n\n"
        "═══ RULE 2 — DEFENDING CORRECT ANSWERS ════════════════════════════════\n"
        "• If a user's claim contradicts the document, politely correct them with exact document evidence.\n"
        "• NEVER agree with incorrect information to be polite.\n"
        "• Only use '⚠️' prefix when there is a GENUINE factual conflict with the documents. NOT for regular answers.\n\n"
        "═══ RULE 3 — SOURCE CITATION ════════════════════════════════════════════\n"
        "• Only cite sources ACTUALLY provided in the CONTEXT DOCUMENTS section.\n"
        "• Use the real document name as given. NEVER invent document names or chunk numbers.\n"
        "• If a real source exists, cite it briefly at the end: **Source:** [Document Name]\n"
        "• If no documents were provided for a query, answer directly without fake source tags.\n\n"
        "═══ RULE 4 — RESPONSE STYLE (CRITICAL) ════════════════════════════════\n"
        "• Answer ONLY what the user asked. Nothing more, nothing less.\n"
        "• NEVER add: 'please note', 'I'd like to mention', 'feel free to ask', disclaimers, or off-topic suggestions.\n"
        "• NEVER volunteer advice or information the user did not ask for.\n"
        "• NEVER add any note, disclaimer, or comment about your own behavior, policies, or identity (e.g. 'As Grey Matter AI...', 'Note: I may not always agree...').\n"
        "• Be concise: use bullet points, bold, and tables only when it aids readability.\n"
        "• No filler: Never say 'Sure!', 'Great question!', 'Certainly!', 'As an AI...'. Start directly with the answer.\n"
        "• Greetings: respond warmly and briefly, then ask 'How can I help you?'\n"
        "• Charts: output ```chart``` JSON blocks ONLY when explicitly asked for a visualization.\n\n"
        "═══ RULE 5 — REASONING & VERIFICATION ══════════════════════════════════\n"
        "• For complex or analytical questions: think step-by-step inside <think> tags.\n"
        "• Verify your logic before outputting the final answer.\n"
        "• For numerical answers: show the calculation steps so the user can verify.\n\n"
        "═══ ABSOLUTE PROHIBITIONS ════════════════════════════════════════════════\n"
        "✗ NEVER hallucinate document names, chunk numbers, or fake source references.\n"
        "✗ NEVER add unrequested information, caveats, suggestions, or disclaimers.\n"
        "✗ NEVER add any 'Note:', footer, or self-referential comment about your own behavior or identity.\n"
        "✗ NEVER use LaTeX — write math in plain readable text.\n"
        "✓ Answer only what was asked. Cite only real sources. Defend truth. Stay concise.\n"
    )

    # Fetch active user memory vault facts
    user_mems = db.query(UserMemory).filter(UserMemory.user_id == current_user.id).all()
    if user_mems:
        mem_lines = [f"• {m.fact}" for m in user_mems]
        system_prompt += "\n\n═══ STORED USER MEMORY VAULT FACTS ═════════════════════════════\n" + "\n".join(mem_lines) + "\n"

    # Auto-extract user personal facts into Memory Vault
    prompt_strip = chat_req.prompt.strip()
    prompt_lower_strip = prompt_strip.lower()
    fact_triggers = ["my name is", "i am ", "i work at", "i am working on", "my role is", "my preference is", "i prefer"]
    if any(ft in prompt_lower_strip for ft in fact_triggers) and len(prompt_strip) > 5:
        try:
            existing_fact = db.query(UserMemory).filter(UserMemory.user_id == current_user.id, UserMemory.fact == prompt_strip).first()
            if not existing_fact:
                db.add(UserMemory(user_id=current_user.id, fact=prompt_strip, source_session_id=session.id))
                db.commit()
        except Exception:
            db.rollback()

    messages_payload = [{"role": "system", "content": system_prompt}]
    
    # 4. Sliding Window Chat History (Zep AI with DB fallback)
    pruned_history = await zep_get_history(session.id)
    if not pruned_history:
        # Fallback to local SQL pruner if Zep is empty or offline
        max_history_words = 3000
        pruned_history = []
        current_words = 0
        past_messages = db.query(ChatMessage).filter(ChatMessage.session_id == session.id).order_by(ChatMessage.created_at.desc()).all()
        for pm in past_messages:
            msg_words = len(pm.content.split())
            if current_words + msg_words > max_history_words:
                break
            pruned_history.append({"role": pm.role, "content": pm.content})
            current_words += msg_words
        pruned_history.reverse()
    
    for msg in pruned_history:
        messages_payload.append(msg)

    user_content = ""
    # ── Live Web Search Grounding (Gemini-Style) ──
    web_references = []
    if getattr(chat_req, "web_search", False):
        try:
            logger.info(f"Executing Gemini-style live web search for: '{chat_req.prompt}'")
            web_results = perform_web_search(chat_req.prompt, max_results=5)
            if web_results:
                web_str_lines = []
                for idx, item in enumerate(web_results, 1):
                    web_str_lines.append(f"[{idx}] Title: {item['title']}\nURL: {item['url']}\nSnippet: {item['snippet']}")
                    web_references.append({
                        "document_name": item["title"],
                        "chunk_index": idx,
                        "text": item["snippet"],
                        "url": item["url"],
                        "score": 1.0
                    })
                web_context_formatted = "\n\n".join(web_str_lines)
                user_content += f"\n\nLIVE WEB SEARCH RESULTS:\n{web_context_formatted}\n\n(Instruction: Synthesize the answer using these real-time web search results. Cite sources when helpful.)"
                
                # Prepend web references to retrieved_chunks for UI pill rendering
                retrieved_chunks = web_references + retrieved_chunks
        except Exception as e:
            logger.error(f"Web search execution error: {e}")

    user_content += f"USER PROMPT:\n{chat_req.prompt}"

    # If the user is asking for a chart, append prompt injection to ensure the model outputs chart schema
    prompt_lower = chat_req.prompt.lower()
    chart_keywords = ["chart", "graph", "figure", "visualize", "visualise", "plot", "pie chart", "bar graph", "histogram", "curve", "distribution", "statistics", "dashboard"]
    if any(kw in prompt_lower for kw in chart_keywords):
        user_content += (
            "\n\n(Instruction: Please visualize this analysis. If appropriate, render a chart using the format:\n"
            "```chart\n"
            "{\n"
            "  \"type\": \"bar\" | \"line\" | \"pie\",\n"
            "  \"title\": \"Chart Title\",\n"
            "  \"labels\": [\"Label 1\", ...],\n"
            "  \"datasets\": [\n"
            "    {\n"
            "      \"label\": \"Legend Label\",\n"
            "      \"data\": [value1, ...]\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "```\n"
            "Use plain text labels only; never use LaTex or backslashes. Do not include any extra text inside the markdown code block. Rest of the response can be regular text analysis.)"
        )
        
    # If user sent a greeting, the system prompt already handles greeting behavior.
    # Do not inject user-facing instructions into the prompt content.
    is_greeting = chat_req.prompt.lower().strip() in ["hello", "hi", "hey", "namaste", "good morning", "good evening", "good afternoon", "hlo", "hii", "test"]
    if is_greeting:
        user_content = chat_req.prompt
    else:
        # If user is asking about Shashwat Mishra / Developer, inject exact verified facts
        dev_keywords = ["shashwat", "mishra", "developer", "who made you", "who created you", "who built you", "who developed you", "about developer"]
        if any(dk in prompt_lower for dk in dev_keywords):
            user_content += (
                "\n\n[VERIFIED AUTHORITATIVE DEVELOPER FACTS]:\n"
                "• Full Name: Shashwat Mishra\n"
                "• Professional Title: AI & Robotics Engineer | MTech Graduate | Lead Developer of Smaran AI\n"
                "• Core Expertise: Artificial Intelligence, Generative AI, Machine Learning, Robotics, Data Science, Full-Stack Web Systems (React, Python, FastAPI, vLLM), and Power BI.\n"
                "• Creator & Architect of: Smaran AI — Enterprise Knowledge & RAG Intelligence Console.\n"
                "• Official LinkedIn: https://www.linkedin.com/in/sm980/\n"
                "• Official Portfolio: https://shashwatmishra-portfolio.netlify.app/\n"
                "(Instruction: Answer the user's question using ONLY these verified facts. Always include the LinkedIn and Portfolio links. Never invent fake degrees, fake jobs, or unverified stories.)"
            )

    messages_payload.append({"role": "user", "content": user_content})

    # Resolve final model: manual > auto > default
    raw_model = chat_req.model or "auto"
    installed_models = _installed_ollama_models()
    if raw_model == "auto" or not raw_model:
        selected_model = _auto_route_model(chat_req.prompt, installed_models)
        logger.info(f"Auto-routing: '{chat_req.prompt[:60]}...' → {selected_model}")
    else:
        selected_model = _matches_installed(raw_model, installed_models) or raw_model


    # Streaming Response Generator
    async def stream_generator():
        nonlocal selected_model
        start_time = time.time()
        accumulated_response = ""
        
        # Yield the source references and routed model immediately at the start of stream
        yield json.dumps({"references": retrieved_chunks, "model_routed": selected_model}) + "\n"

        prompt_lower = chat_req.prompt.lower().strip()
        if prompt_lower.startswith("/image") or prompt_lower.startswith("/txt2img"):
            clean_prompt = chat_req.prompt.split(" ", 1)[1] if " " in chat_req.prompt else chat_req.prompt
            img_tag = call_sd_txt2img_bridge(clean_prompt)
            # Log results to SQLite DB
            db_session = SessionLocal()
            try:
                db_session.add(ChatMessage(session_id=session.id, role="user", content=chat_req.prompt))
                db_session.add(ChatMessage(session_id=session.id, role="assistant", content=f"Generated image for prompt: '{clean_prompt}'\n\n{img_tag}", references="[]"))
                active_session = db_session.query(ChatSession).filter(ChatSession.id == session.id).first()
                if active_session: active_session.updated_at = datetime.now()
                db_session.commit()
            except Exception:
                db_session.rollback()
            yield json.dumps({"token": f"Generating image for prompt: '{clean_prompt}'...\n\n{img_tag}"}) + "\n"
            yield json.dumps({
                "token_count": 0,
                "prompt_tokens": 0,
                "total_context": 4096,
                "context_remaining": 4096,
                "execution_time_sec": round(time.time() - start_time, 2),
                "local_datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }) + "\n"
            return
            
        elif prompt_lower.startswith("/video") or prompt_lower.startswith("/txt2video"):
            clean_prompt = chat_req.prompt.split(" ", 1)[1] if " " in chat_req.prompt else chat_req.prompt
            video_tag = generate_fallback_video(clean_prompt)
            # Log results to SQLite DB
            db_session = SessionLocal()
            try:
                db_session.add(ChatMessage(session_id=session.id, role="user", content=chat_req.prompt))
                db_session.add(ChatMessage(session_id=session.id, role="assistant", content=f"Generated video for prompt: '{clean_prompt}'\n\n{video_tag}", references="[]"))
                active_session = db_session.query(ChatSession).filter(ChatSession.id == session.id).first()
                if active_session: active_session.updated_at = datetime.now()
                db_session.commit()
            except Exception:
                db_session.rollback()
            yield json.dumps({"token": f"Generating video for prompt: '{clean_prompt}'...\n\n{video_tag}"}) + "\n"
            yield json.dumps({
                "token_count": 0,
                "prompt_tokens": 0,
                "total_context": 4096,
                "context_remaining": 4096,
                "execution_time_sec": round(time.time() - start_time, 2),
                "local_datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }) + "\n"
            return

        try:
            async with inference_semaphore:
                # ── Determine active inference engine from hardware_config.json ──────
                hw_cfg = {}
                try:
                    hw_path = os.path.join(os.getenv("DATA_DIR", "./data"), "hardware_config.json")
                    if os.path.exists(hw_path):
                        with open(hw_path) as _hf:
                            hw_cfg = json.load(_hf)
                except Exception:
                    pass

                engine   = hw_cfg.get("engine", settings.INFERENCE_ENGINE)
                api_url  = hw_cfg.get("api_url", settings.VLLM_URL if engine == "vllm" else settings.OLLAMA_URL)
                if not selected_model or selected_model == "auto":
                    selected_model = settings.ACTIVE_MODEL
                model_to_use = selected_model

                loop = asyncio.get_event_loop()

                inference_success = False

                # ── Candidate lists for vLLM & Ollama ──
                vllm_candidates = []
                if api_url and "11434" not in api_url:
                    vllm_candidates.append(api_url.rstrip("/"))
                vllm_candidates.extend([
                    os.getenv("VLLM_URL", "").rstrip("/"),
                    settings.VLLM_URL.rstrip("/") if settings.VLLM_URL else "",
                    "http://smaran-inference:8000/v1",
                    "http://inference-server:8000/v1",
                    "http://127.0.0.1:8001/v1",
                    "http://127.0.0.1:8000/v1",
                    "http://localhost:8001/v1",
                    "http://localhost:8000/v1"
                ])
                vllm_candidates = [u for u in dict.fromkeys(vllm_candidates) if u]

                ollama_candidates = [
                    os.getenv("OLLAMA_URL", "").rstrip("/"),
                    settings.OLLAMA_URL.rstrip("/") if settings.OLLAMA_URL else "",
                    "http://127.0.0.1:11434",
                    "http://localhost:11434",
                    "http://ollama:11434",
                    "http://host.docker.internal:11434"
                ]
                ollama_candidates = [u for u in dict.fromkeys(ollama_candidates) if u]

                # 1. If engine == "vllm", try vLLM candidate endpoints first
                if engine == "vllm":
                    for vurl in vllm_candidates:
                        if inference_success:
                            break
                        vllm_model_id = settings.ACTIVE_MODEL or "Qwen/Qwen3-4B-AWQ"
                        try:
                            async with httpx.AsyncClient(timeout=3.0) as client:
                                res_m = await client.get(f"{vurl}/models")
                                if res_m.status_code == 200:
                                    served = [m["id"] for m in res_m.json().get("data", [])]
                                    if served:
                                        vllm_model_id = model_to_use if model_to_use in served else served[0]
                        except Exception:
                            pass

                        chat_url = f"{vurl}/chat/completions"
                        payload = {
                            "model":       vllm_model_id,
                            "messages":    messages_payload,
                            "stream":      True,
                            "temperature": 0.3,
                            "max_tokens":  1024,
                        }
                        try:
                            async with httpx.AsyncClient(timeout=600.0) as client:
                                async with client.stream("POST", chat_url, json=payload) as r:
                                    if r.status_code == 200:
                                        async for raw_line in r.aiter_lines():
                                            line = raw_line.strip()
                                            if not line or line == "data: [DONE]":
                                                continue
                                            if line.startswith("data: "):
                                                line = line[6:]
                                            try:
                                                chunk = json.loads(line)
                                                choices = chunk.get("choices", [])
                                                if choices:
                                                    delta = choices[0].get("delta", {})
                                                    token = delta.get("content") or delta.get("reasoning_content") or ""
                                                    if token:
                                                        inference_success = True
                                                        selected_model = vllm_model_id
                                                        accumulated_response += token
                                                        yield json.dumps({"token": token}) + "\n"
                                            except Exception:
                                                continue
                        except Exception as he:
                            logger.warning(f"vLLM stream error on {vurl}: {he}")

                # 2. If vLLM failed or engine == "ollama", try Ollama endpoints
                if not inference_success:
                    installed_ollama = _installed_ollama_models()
                    ollama_model = _matches_installed(model_to_use, installed_ollama) or model_to_use

                    for ourl in ollama_candidates:
                        if inference_success:
                            break
                        # Try Ollama native /api/chat
                        try:
                            chat_url = f"{ourl}/api/chat"
                            payload = {
                                "model": ollama_model,
                                "messages": messages_payload,
                                "stream": True,
                                "options": {
                                    "temperature": 0.3,
                                    "num_ctx": hw_cfg.get("ctx_window", 4096)
                                }
                            }
                            async with httpx.AsyncClient(timeout=600.0) as client:
                                async with client.stream("POST", chat_url, json=payload) as r:
                                    if r.status_code == 200:
                                        async for raw_line in r.aiter_lines():
                                            line = raw_line.strip()
                                            if not line:
                                                continue
                                            try:
                                                chunk = json.loads(line)
                                                token = chunk.get("message", {}).get("content", "")
                                                if token:
                                                    inference_success = True
                                                    selected_model = ollama_model
                                                    accumulated_response += token
                                                    yield json.dumps({"token": token}) + "\n"
                                            except Exception:
                                                continue
                        except Exception as oe:
                            logger.warning(f"Ollama native stream error on {ourl}: {oe}")

                        # Try Ollama OpenAI /v1/chat/completions fallback
                        if not inference_success:
                            try:
                                chat_url = f"{ourl}/v1/chat/completions"
                                payload = {
                                    "model": ollama_model,
                                    "messages": messages_payload,
                                    "stream": True,
                                    "temperature": 0.3
                                }
                                async with httpx.AsyncClient(timeout=600.0) as client:
                                    async with client.stream("POST", chat_url, json=payload) as r:
                                        if r.status_code == 200:
                                            async for raw_line in r.aiter_lines():
                                                line = raw_line.strip()
                                                if not line or line == "data: [DONE]":
                                                    continue
                                                if line.startswith("data: "):
                                                    line = line[6:]
                                                try:
                                                    chunk = json.loads(line)
                                                    choices = chunk.get("choices", [])
                                                    if choices:
                                                        delta = choices[0].get("delta", {})
                                                        token = delta.get("content") or delta.get("reasoning_content") or ""
                                                        if token:
                                                            inference_success = True
                                                            selected_model = ollama_model
                                                            accumulated_response += token
                                                            yield json.dumps({"token": token}) + "\n"
                                                except Exception:
                                                    continue
                            except Exception as oe:
                                logger.warning(f"Ollama OpenAI stream error on {ourl}: {oe}")

                # 3. If everything failed (model still initializing / downloading), yield status warning
                if not inference_success:
                    msg = f"⚠️ AI Engine ({selected_model}) is initializing. Please wait a few seconds and try again."
                    accumulated_response = msg
                    yield json.dumps({"token": msg}) + "\n"


            
            # Compute latency and token stats
            elapsed = (time.time() - start_time) * 1000.0
            latency_metrics.append(elapsed)
            if len(latency_metrics) > 100:
                latency_metrics.pop(0)
            
            # Track per-model latency
            _model_latencies.setdefault(selected_model, []).append(elapsed)
            if len(_model_latencies[selected_model]) > 100:
                _model_latencies[selected_model].pop(0)

            # Approximate token count: word_count × 1.33 ≈ tokens
            word_count = len(accumulated_response.split())
            approx_tokens = int(word_count * 1.33)
            elapsed_sec = elapsed / 1000.0
            tokens_per_sec = round(approx_tokens / elapsed_sec, 1) if elapsed_sec > 0 else 0.0
            
            # Approximate prompt tokens
            prompt_word_count = sum(len(msg.get("content", "").split()) for msg in messages_payload)
            approx_prompt_tokens = int(prompt_word_count * 1.33)
            
            total_context = int(hw_cfg.get("max_model_len", settings.MAX_MODEL_LEN))
            context_remaining = max(0, total_context - (approx_prompt_tokens + approx_tokens))

            # Yield final metadata with response time + token stats + context window size + remaining context
            yield json.dumps({
                "response_time_ms": round(elapsed, 1),
                "model_routed":     selected_model,
                "token_count":      approx_tokens,
                "prompt_tokens":    approx_prompt_tokens,
                "total_context":    total_context,
                "context_remaining": context_remaining,
                "execution_time_sec": round(elapsed_sec, 2),
                "local_datetime":   datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }) + "\n"
                
            # Stream completed successfully. Now write metadata & logs to SQLite.
            db_session = SessionLocal()
            try:
                # 1. Update session timestamp & title if needed
                active_session = db_session.query(ChatSession).filter(ChatSession.id == session.id).first()
                if active_session:
                    active_session.updated_at = datetime.now()
                    if active_session.title == "Chat Session" or len(active_session.title) <= 25:
                        active_session.title = chat_req.prompt[:40] + ("..." if len(chat_req.prompt) > 40 else "")
                
                # 2. Add user message (avoid duplicate if we are streaming an edited message edit branch)
                last_db_msg = db_session.query(ChatMessage).filter(ChatMessage.session_id == session.id).order_by(ChatMessage.created_at.desc()).first()
                if last_db_msg and last_db_msg.role == "user" and last_db_msg.content == chat_req.prompt:
                    # Already exists as the edited message in database! Do not insert duplicate.
                    pass
                else:
                    user_msg = ChatMessage(
                        session_id=session.id,
                        role="user",
                        content=chat_req.prompt
                    )
                    db_session.add(user_msg)
                
                # 3. Add AI message with response time
                ai_msg = ChatMessage(
                    session_id=session.id,
                    role="assistant",
                    content=accumulated_response,
                    references=json.dumps(retrieved_chunks),
                    response_time_ms=round(elapsed, 1),
                    model_used=selected_model
                )
                db_session.add(ai_msg)
                
                # 4. Write to Audit Log with response time
                audit = AuditLog(
                    user_id=current_user.id,
                    username=current_user.username,
                    prompt=chat_req.prompt,
                    response=accumulated_response,
                    model_used=selected_model,
                    response_time_ms=round(elapsed, 1)
                )
                db_session.add(audit)
                
                db_session.commit()

                # 5. Extract & persist memory facts from this conversation turn (async background)
                asyncio.create_task(_extract_and_save_memory(
                    user_id=current_user.id,
                    session_id=session.id,
                    user_prompt=chat_req.prompt,
                    ai_response=accumulated_response
                ))
                # 6. Store in Zep Memory asynchronously
                asyncio.create_task(zep_add_message(session.id, "user", chat_req.prompt))
                asyncio.create_task(zep_add_message(session.id, "assistant", accumulated_response))
            except Exception as se:
                logger.error(f"Failed to record message history inside generator: {se}")
                db_session.rollback()
            finally:
                db_session.close()
                
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield json.dumps({"error": f"Streaming interruption occurred: {str(e)}"}) + "\n"

    return StreamingResponse(stream_generator(), media_type="application/x-ndjson")

@app.post("/api/chat/vision")
async def chat_vision_interaction(
    session_id: str = Form(...),
    prompt: str = Form(...),
    model: Optional[str] = Form("auto"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    # Validate session
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        session = ChatSession(id=session_id, user_id=current_user.id, title=prompt[:30])
        db.add(session)
        db.commit()
        db.refresh(session)

    # 1. Save uploaded file permanently to parse it and serve it
    filename = file.filename
    file_type = filename.split(".")[-1].lower() if "." in filename else ""
    saved_uuid = uuid.uuid4().hex
    saved_filename = f"vision_{saved_uuid}.{file_type}"
    saved_path = os.path.join(settings.UPLOAD_DIR, saved_filename)

    try:
        content = await file.read()
        with open(saved_path, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"Failed to write vision file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to write upload content: {str(e)}")

    # 2. Convert and Encode to Base64 in-memory
    images_b64 = []
    try:
        if file_type == "pdf":
            # PDF to Vision Pipeline - Convert PDF pages to PNG bytes
            page_images_bytes = pdf_to_images(saved_path, max_pages=5)
            for page_bytes in page_images_bytes:
                b64 = encode_image_base64(page_bytes)
                images_b64.append(b64)
        elif file_type in ["png", "jpg", "jpeg", "webp", "bmp", "tiff"]:
            with open(saved_path, "rb") as f:
                img_bytes = f.read()
            b64 = encode_image_base64(img_bytes)
            images_b64.append(b64)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported vision document type: {file_type}. Supported: PDF, PNG, JPG, JPEG, WEBP, BMP, TIFF."
            )
            
        if not images_b64:
            raise ValueError("No pages or images extracted.")
            
    except Exception as e:
        # Cleanup saved file on early error
        if os.path.exists(saved_path):
            os.remove(saved_path)
        logger.error(f"Vision preprocessing failed: {e}")
        raise HTTPException(status_code=400, detail=f"Vision document processing failed: {str(e)}")

    # Determine Model — always use vLLM's ACTIVE_MODEL (Qwen2.5-VL multimodal)
    selected_model = settings.ACTIVE_MODEL

    # Async generator to stream response via vLLM OpenAI-compatible endpoint
    async def vision_stream_generator():
        start_time = time.time()
        accumulated_response = ""

        # Yield metadata block immediately
        yield json.dumps({"references": [], "model_routed": selected_model, "vision_mode": True}) + "\n"

        try:
            async with inference_semaphore:
                sys_prompt = (
                    "You are Smaran AI — a precise multimodal vision document analysis assistant. "
                    "When analyzing images of invoices, bills, attendance reports, or technical documents, "
                    "extract ALL line items, quantities, prices, dates, employee names, and totals into structured text. "
                    "Use markdown tables for tabular data. Be thorough and accurate. "
                    "If you see a chart or graph, describe the data points and trends precisely.\n"
                    "IMPORTANT FOR VISUAL GRAPHS & CHARTS:\n"
                    "If the user asks for a chart or visualization, "
                    "output a markdown code block with language 'chart' containing valid JSON:\n"
                    "```chart\n"
                    "{\n"
                    '  "type": "bar" | "line" | "pie",\n'
                    '  "title": "Chart Title",\n'
                    '  "labels": ["Label1", ...],\n'
                    '  "datasets": [{"label": "Dataset", "data": [num1, ...]}]\n'
                    "}\n"
                    "```\n"
                )

                # Build vLLM OpenAI-compatible multimodal messages
                image_content_blocks = [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
                    for b64 in images_b64
                ]
                image_content_blocks.append({"type": "text", "text": prompt})

                payload = {
                    "model": selected_model,
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": image_content_blocks}
                    ],
                    "stream": True,
                    "max_tokens": 4096,
                    "temperature": 0.2,
                }

                vllm_base = settings.VLLM_URL.rstrip("/")
                url = f"{vllm_base}/chat/completions"

                try:
                    async with httpx.AsyncClient(timeout=600.0) as client:
                        async with client.stream("POST", url, json=payload) as r:
                            if r.status_code != 200:
                                err_text = await r.aread()
                                yield json.dumps({"error": f"vLLM Vision API Error: {err_text.decode()}"}) + "\n"
                                return
                            async for line in r.aiter_lines():
                                if not line or line == "data: [DONE]":
                                    continue
                                if line.startswith("data: "):
                                    data_str = line[6:]
                                    try:
                                        chunk = json.loads(data_str)
                                        token = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                        if token:
                                            accumulated_response += token
                                            yield json.dumps({"token": token}) + "\n"
                                    except Exception:
                                        continue
                except Exception as he:
                    yield json.dumps({"error": f"vLLM vision streaming failure: {str(he)}"}) + "\n"
                    return
            
            # Compute latency
            elapsed = (time.time() - start_time) * 1000.0
            latency_metrics.append(elapsed)
            if len(latency_metrics) > 100:
                latency_metrics.pop(0)
                
            # Yield final metadata with response time
            yield json.dumps({"response_time_ms": round(elapsed, 1), "model_routed": selected_model}) + "\n"
                
            # Log results to SQLite DB
            db_session = SessionLocal()
            try:
                active_session = db_session.query(ChatSession).filter(ChatSession.id == session_id).first()
                if active_session:
                    active_session.updated_at = datetime.now()
                    if active_session.title == "Chat Session" or len(active_session.title) <= 25:
                        active_session.title = f"Vision: {prompt[:30]}"
                        
                # Add User query with visual indicator
                vision_ref = [{"type": "vision", "filename": filename, "url": f"/api/static/{saved_filename}"}]
                user_msg = ChatMessage(
                    session_id=session_id,
                    role="user",
                    content=f"📎 [Uploaded {filename}] {prompt}",
                    references=json.dumps(vision_ref)
                )
                db_session.add(user_msg)
                
                # Add AI response
                ai_msg = ChatMessage(
                    session_id=session_id,
                    role="assistant",
                    content=accumulated_response,
                    model_used=selected_model,
                    response_time_ms=round(elapsed, 1)
                )
                db_session.add(ai_msg)
                
                # Write to audit logs
                audit = AuditLog(
                    user_id=current_user.id,
                    username=current_user.username,
                    prompt=f"[Vision File: {filename}] {prompt}",
                    response=accumulated_response,
                    model_used=selected_model
                )
                db_session.add(audit)
                
                db_session.commit()
            except Exception as se:
                logger.error(f"Failed to save vision chat to DB logs: {se}")
                db_session.rollback()
            finally:
                db_session.close()
                
        except Exception as err:
            logger.error(f"Vision stream error: {err}")
            yield json.dumps({"error": f"Vision processing interruption: {str(err)}"}) + "\n"
            
        finally:
            # Call explicit garbage collection
            cleanup_after_processing()

    return StreamingResponse(vision_stream_generator(), media_type="application/x-ndjson")


# --- Admin Dashboard Endpoints ---

@app.get("/api/admin/visitor-analytics", response_model=DeveloperAnalyticsResponse)
def get_developer_visitor_analytics(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """Production-grade Visitor & Usage Analytics Dashboard endpoint strictly for Developer / Admin."""
    total_users = db.query(User).count()
    total_logins = db.query(VisitorLog).filter(VisitorLog.event_type == "login").count()
    
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_visitors = db.query(VisitorLog).filter(VisitorLog.timestamp >= today_start).count()
    
    last_24h = datetime.now() - timedelta(days=1)
    active_24h = db.query(User).filter(User.last_login >= last_24h).count()
    
    total_prompts = db.query(AuditLog).count()
    total_sessions = db.query(ChatSession).count()
    
    db_size_mb = 0.0
    try:
        if settings.DATABASE_URL.startswith("sqlite"):
            db_path = settings.DATABASE_URL.replace("sqlite:///", "")
            if os.path.exists(db_path):
                db_size_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)
    except Exception:
        pass
        
    recent_visitors = db.query(VisitorLog).order_by(VisitorLog.timestamp.desc()).limit(50).all()
    
    return DeveloperAnalyticsResponse(
        total_registered_users=total_users,
        total_logins_all_time=total_logins,
        today_visitors_count=today_visitors,
        active_users_last_24h=active_24h,
        total_chat_prompts_processed=total_prompts,
        total_active_sessions=total_sessions,
        database_size_mb=db_size_mb,
        recent_visitors=recent_visitors
    )


@app.get("/api/admin/users", response_model=List[UserResponse])
def get_users(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    return db.query(User).all()

@app.get("/api/admin/sessions")
def get_admin_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """Retrieve all chat sessions for all users to allow admin interventions."""
    sessions = db.query(ChatSession).all()
    results = []
    for s in sessions:
        user = db.query(User).filter(User.id == s.user_id).first()
        username = user.username if user else "unknown"
        results.append({
            "id": s.id,
            "title": s.title,
            "username": username,
            "created_at": s.created_at,
            "updated_at": s.updated_at
        })
    return results


@app.put("/api/admin/users/{user_id}", response_model=UserResponse)
def update_user_status(user_id: int, update_data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.username == "admin" and update_data.is_approved is False:
        raise HTTPException(status_code=400, detail="Cannot disable primary administrator account")

    if update_data.is_approved is not None:
        user.is_approved = update_data.is_approved
    if update_data.role is not None:
        user.role = update_data.role
    if update_data.password is not None:
        user.password_hash = hash_password(update_data.password)
        
    db.commit()
    db.refresh(user)
    return user

@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.username == "admin" or user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own or primary administrator account")
        
    db.delete(user)
    db.commit()
    return {"message": f"User {user.username} deleted successfully"}

@app.get("/api/admin/audit-logs", response_model=List[AuditLogResponse])
def get_audit_logs(search: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    query = db.query(AuditLog)
    if search:
        search_term = search.strip()
        if search_term:
            query = query.filter(
                AuditLog.prompt.ilike(f"%{search_term}%") | 
                AuditLog.response.ilike(f"%{search_term}%") | 
                AuditLog.username.ilike(f"%{search_term}%")
            )
    return query.order_by(AuditLog.timestamp.desc()).all()

@app.delete("/api/admin/audit-logs")
def delete_all_audit_logs(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    try:
        db.query(AuditLog).delete()
        db.commit()
        return {"message": "All audit transaction logs have been successfully cleared"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear audit logs: {str(e)}")


@app.get("/api/admin/system-stats", response_model=SystemStatsResponse)
def get_system_stats(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    # Calculate active concurrent sessions in the last 15 minutes
    time_limit = datetime.now() - timedelta(minutes=15)
    active_sessions = db.query(ChatSession).filter(ChatSession.updated_at >= time_limit).count()
    
    # Calculate average latency
    avg_latency = sum(latency_metrics) / len(latency_metrics) if latency_metrics else 0.0
    
    # Call telemetries helper
    stats = get_system_telemetry(db, active_sessions, avg_latency)
    return SystemStatsResponse(**stats)


@app.get("/api/creator/usage-telemetry")
def get_creator_telemetry_status(current_user: User = Depends(get_admin_user)):
    """Secret Creator telemetry status endpoint — accessible only by Admin."""
    inst_id = get_or_create_installation_id()
    # Trigger heartbeat ping
    send_creator_heartbeat("admin_check")
    return {
        "creator": "SHASHWAT MISHRA",
        "installation_id": inst_id,
        "telemetry_active": True,
        "app": "SMARAN.AI",
        "version": "2.2.0"
    }


@app.post("/api/admin/chat/inject")
async def admin_chat_inject(
    session_id: str = Form(...),
    prompt: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Allows an administrator to inject themselves into an employee's session to continue the chat."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
        
    # Append the injection note into message history
    inj_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=f"📝 **[ADMIN OVERRIDE: {current_user.username}]** {prompt}",
        model_used="admin-override"
    )
    db.add(inj_msg)
    
    # Track in audit logs
    audit = AuditLog(
        user_id=current_user.id,
        username=current_user.username,
        prompt=f"[ADMIN INJECTION into Session: {session_id}]",
        response=prompt,
        model_used="admin-override"
    )
    db.add(audit)
    
    # Also inject user prompt into Zep memory if available so context updates
    asyncio.create_task(zep_add_message(session_id, "assistant", f"[ADMIN: {current_user.username}] {prompt}"))
    
    db.commit()
    return {"status": "ok", "message": "Admin response successfully injected"}


@app.get("/api/admin/reports/activity")
def get_admin_reports(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """Retrieve usage stats, most active users, and model distribution for admin charts."""
    from sqlalchemy import func
    
    # 1. Most active users (prompt count)
    active_users = db.query(
        AuditLog.username,
        func.count(AuditLog.id).label("total_prompts"),
        func.avg(AuditLog.response_time_ms).label("avg_latency")
    ).group_by(AuditLog.username).order_by(func.count(AuditLog.id).desc()).all()
    
    # 2. Model distribution
    model_counts = db.query(
        AuditLog.model_used,
        func.count(AuditLog.id).label("count")
    ).group_by(AuditLog.model_used).all()
    
    return {
        "most_active_users": [
            {"username": row.username, "total_prompts": row.total_prompts, "avg_latency": round(row.avg_latency or 0.0, 1)}
            for row in active_users
        ],
        "model_distribution": [
            {"model": row.model_used or "unknown", "count": row.count}
            for row in model_counts
        ],
        "total_transactions": db.query(AuditLog).count()
    }


@app.get("/api/admin/visitor-analytics", response_model=DeveloperAnalyticsResponse)
def get_visitor_analytics(db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    total_users = db.query(User).count()
    
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    visitors_today = db.query(VisitorLog).filter(VisitorLog.timestamp >= today_start).count()
    
    total_logins = db.query(VisitorLog).filter(VisitorLog.event_type == "login").count()
    prompts_served = db.query(AuditLog).count()
    
    twenty_four_hours_ago = datetime.now() - timedelta(hours=24)
    active_users_24h = db.query(User).filter(User.last_login >= twenty_four_hours_ago).count()
    
    fifteen_mins_ago = datetime.now() - timedelta(minutes=15)
    active_sessions = db.query(ChatSession).filter(ChatSession.updated_at >= fifteen_mins_ago).count()
    
    db_size_mb = 0.0
    db_path = os.path.join(settings.DATA_DIR, "sqlite.db")
    if os.path.exists(db_path):
        db_size_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)
        
    recent_logs = db.query(VisitorLog).order_by(VisitorLog.timestamp.desc()).limit(50).all()
    
    return DeveloperAnalyticsResponse(
        total_users=total_users,
        visitors_today=visitors_today,
        total_logins=total_logins,
        prompts_served=prompts_served,
        active_users_24h=active_users_24h,
        active_sessions=active_sessions,
        database_size_mb=db_size_mb,
        recent_logs=[
            VisitorLogResponse(
                id=l.id,
                user_id=l.user_id,
                username=l.username,
                role=l.role,
                ip_address=l.ip_address or "127.0.0.1 (Local Host)",
                user_agent=l.user_agent or "Unknown",
                event_type=l.event_type,
                timestamp=l.timestamp
            )
            for l in recent_logs
        ]
    )


# ── AI MEMORY VAULT ENDPOINTS ──────────────────────────────────────────────────
@app.get("/api/memory", response_model=List[UserMemoryResponse])
def get_user_memory_facts(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    facts = db.query(UserMemory).filter(UserMemory.user_id == current_user.id).order_by(UserMemory.created_at.desc()).all()
    
    # Auto-seed initial system memory facts if vault is empty for user
    if not facts:
        default_facts = [
            f"User profile initialized for {current_user.username} (Role: {current_user.role.upper()}).",
            "Node Environment: Smaran AI Enterprise Knowledge Engine (100% Offline LAN Node).",
            "Active Inference Engine: vLLM & Ollama Local Router with RAG Vector Store."
        ]
        for df in default_facts:
            mem = UserMemory(user_id=current_user.id, fact=df)
            db.add(mem)
        db.commit()
        facts = db.query(UserMemory).filter(UserMemory.user_id == current_user.id).order_by(UserMemory.created_at.desc()).all()
        
    return facts

@app.post("/api/memory", response_model=UserMemoryResponse)
def add_user_memory_fact(mem_req: UserMemoryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    mem = UserMemory(
        user_id=current_user.id,
        fact=mem_req.fact.strip(),
        source_session_id=mem_req.source_session_id
    )
    db.add(mem)
    db.commit()
    db.refresh(mem)
    return mem

@app.delete("/api/memory/clear")
def clear_all_user_memory(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    db.query(UserMemory).filter(UserMemory.user_id == current_user.id).delete()
    db.commit()
    return {"message": "All memory facts cleared successfully"}

@app.delete("/api/memory/{fact_id}")
def delete_user_memory_fact(fact_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    fact = db.query(UserMemory).filter(UserMemory.id == fact_id, UserMemory.user_id == current_user.id).first()
    if not fact:
        raise HTTPException(status_code=404, detail="Memory fact not found")
    db.delete(fact)
    db.commit()
    return {"message": "Memory fact deleted successfully"}



@app.get("/api/system/models")
def get_available_models(current_user: User = Depends(get_current_approved_user)):
    import json
    hw_config = {}
    hw_path = os.path.join(settings.DATA_DIR, "hardware_config.json")
    try:
        with open(hw_path) as f:
            hw_config = json.load(f)
    except Exception:
        pass

    engine = hw_config.get("engine", settings.INFERENCE_ENGINE)
    active_model = hw_config.get("model_id", settings.ACTIVE_MODEL)
    display_name = hw_config.get("display_name") or hw_config.get("inference", {}).get("display_name") or active_model

    # Query Ollama for installed models
    installed = []
    try:
        resp = requests.get(f"{settings.OLLAMA_URL}/api/tags", timeout=5)
        if resp.status_code == 200:
            installed = [m["name"] for m in resp.json().get("models", []) if m["name"] != "nomic-embed-text:latest"]
    except Exception:
        pass

    # Normalize model names: strip the ':latest' suffix so that
    # 'nemotron-nano-12b-v2:latest' and 'nemotron-nano-12b-v2' are treated as the same entry.
    # Always prefer the name WITHOUT ':latest' for cleaner display.
    def _normalize(name: str) -> str:
        return name[:-len(":latest")] if name.endswith(":latest") else name

    # De-duplicate while preserving order (keep the first occurrence of each normalized name)
    seen = set()
    deduped = []
    for m in installed:
        key = _normalize(m)
        if key not in seen:
            seen.add(key)
            deduped.append(_normalize(m))   # store the normalized (no ':latest') version
    installed = deduped

    # Include auto, core model Qwen3-4B-AWQ, plus any catalog model that is actually downloaded/ready
    requested_models = [
        "auto",
        "Qwen/Qwen3-4B-AWQ"
    ]
    for cat_item in MODELS_CATALOG:
        m_id = cat_item["id"]
        if check_download_status(m_id):
            if m_id not in installed:
                installed.append(m_id)
    for req_m in requested_models:
        if req_m not in installed:
            installed.append(req_m)

    models_status = {}
    downloaded_models = []
    for m in installed:
        if m == "auto":
            models_status[m] = {"ready": True, "status": "Ready", "progress_pct": 100.0}
            downloaded_models.append(m)
            continue
        
        # Check HuggingFace cache, Ollama, or local storage using authoritative check_download_status
        is_ready = check_download_status(m)
        progress = 100.0 if is_ready else 0.0

        if is_ready:
            # Double-check: if this model is the currently-downloading one, mark it as downloading
            # by checking model_status_cache global (set by /api/model/status)
            global _model_download_in_progress
            if hasattr(_model_download_in_progress, '__contains__') and m in _model_download_in_progress:
                models_status[m] = {"ready": False, "status": f"Downloading ({progress:.1f}%)...", "progress_pct": progress}
            else:
                models_status[m] = {"ready": True, "status": "Ready", "progress_pct": 100.0}
                downloaded_models.append(m)
        elif progress > 0:
            models_status[m] = {"ready": False, "status": f"Downloading ({progress:.1f}%)", "progress_pct": progress}
        else:
            models_status[m] = {"ready": False, "status": "Not Downloaded", "progress_pct": 0.0}

    return {
        "engine": engine,
        "active_model": active_model,
        "installed_models": installed,
        "downloaded_models": downloaded_models,
        "models_status": models_status,
        "auto_model": "auto",
        "display_name": display_name
    }


@app.get("/api/system/device-specs")
def get_device_specs(db: Session = Depends(get_db), current_user: User = Depends(get_current_approved_user)):
    avg_latency = sum(latency_metrics) / len(latency_metrics) if latency_metrics else 0.0
    stats = get_system_telemetry(db, 0, avg_latency)
    return {
        "gpu_name": stats.get("gpu_name"),
        "gpu_vram_total": stats.get("gpu_vram_total"),
        "gpu_vram_used": stats.get("gpu_vram_used"),
        "gpu_usage": stats.get("gpu_usage"),
        "memory_total_gb": stats.get("memory_total_gb"),
        "memory_used_gb": stats.get("memory_used_gb"),
        "cpu_name": stats.get("cpu_name"),
        "cpu_cores": stats.get("cpu_cores"),
        "cpu_usage": stats.get("cpu_usage"),
        "disk_total_gb": stats.get("disk_total_gb"),
        "disk_used_gb": stats.get("disk_used_gb"),
        "disk_usage": stats.get("disk_usage")
    }


@app.get("/api/test/ping")
def ping():
    return {"status": "ok"}


@app.get("/api/model/status")
def model_status():
    """
    Check if the AI model is downloaded and ready.
    Returns: { ready: bool, model_id: str, downloading: bool, progress_pct: float }
    Frontend polls this to show a download progress banner.
    """
    hw = {}
    try:
        hw_path = os.path.join(os.getenv("DATA_DIR", "/app/data"), "hardware_config.json")
        if os.path.exists(hw_path):
            with open(hw_path) as f:
                hw = json.load(f)
    except Exception:
        pass

    model_id = hw.get("model_id", settings.ACTIVE_MODEL)
    display_name = hw.get("display_name", "Nemotron-3 Nano 4B")
    engine = hw.get("engine", settings.INFERENCE_ENGINE)

    # Check Ollama for installed models
    try:
        ollama_url = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
        resp = requests.get(f"{ollama_url}/api/tags", timeout=3)
        if resp.ok:
            installed = [m["name"] for m in resp.json().get("models", [])]
            # Normalize: check if model_id matches any installed model (with or without :latest)
            model_base = model_id.split(":")[0] if ":" in model_id else model_id
            for m in installed:
                m_base = m.split(":")[0] if ":" in m else m
                if m_base == model_base or m == model_id:
                    return {
                        "ready": True,
                        "downloading": False,
                        "model_id": model_id,
                        "display_name": display_name,
                        "progress_pct": 100.0,
                        "status_msg": "Ready"
                    }
    except Exception:
        pass

    # If vLLM engine, check if model is actually LOADED (not just server started)
    if engine == "vllm" or True:  # always check vLLM
        vllm_candidates = [
            os.getenv("VLLM_URL", "").rstrip('/'),
            settings.VLLM_URL.rstrip('/') if settings.VLLM_URL else "",
            "http://smaran-inference:8000/v1",
            "http://inference-server:8000/v1",
            "http://127.0.0.1:8001/v1",
        ]
        for vurl in vllm_candidates:
            if not vurl:
                continue
            try:
                endpoint = f"{vurl}/models"
                resp = requests.get(endpoint, timeout=3)
                if resp.ok:
                    served_models = [m.get("id", "") for m in resp.json().get("data", [])]
                    if served_models:
                        # Model is fully loaded and serving requests in vLLM
                        _model_download_in_progress.discard(model_id)
                        return {
                            "ready": True,
                            "downloading": False,
                            "model_id": served_models[0],
                            "display_name": display_name,
                            "progress_pct": 100.0,
                            "status_msg": "Ready"
                        }
            except Exception:
                continue

    # Check Ollama pull progress
    try:
        ollama_url = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
        ps_resp = requests.get(f"{ollama_url}/api/ps", timeout=3)
        if ps_resp.ok:
            status_msg = f"Downloading model {model_id}... Ollama is pulling weights."
            progress_pct = 50.0
    except Exception:
        pass

    # Check blobs dir for HF-style downloads (vLLM)
    progress_pct = 0.0
    status_msg = f"Connecting to Hugging Face to fetch model weights ({model_id})..."
    try:
        hf_folder_name = f"models--{model_id.replace('/', '--')}"
        possible_dirs = [
            os.path.join("/root/.cache/huggingface/hub", hf_folder_name),
            os.path.join(os.getenv("DATA_DIR", "/app/data"), "models", "hub", hf_folder_name),
            os.path.join(os.getenv("DATA_DIR", "/app/data"), "models", hf_folder_name),
        ]
        
        blobs_dir = None
        model_hub_dir = None
        for d in possible_dirs:
            b = os.path.join(d, "blobs")
            if os.path.exists(b):
                blobs_dir = b
                model_hub_dir = d
                break

        if blobs_dir and os.path.exists(blobs_dir):
            total_size = 0
            try:
                snapshots_dir = os.path.join(model_hub_dir, "snapshots")
                if os.path.exists(snapshots_dir):
                    for snap in os.listdir(snapshots_dir):
                        idx_file = os.path.join(snapshots_dir, snap, "model.safetensors.index.json")
                        if os.path.exists(idx_file):
                            with open(idx_file) as f:
                                idx_data = json.load(f)
                                total_size = idx_data.get("metadata", {}).get("total_size", 0)
                                if total_size > 0:
                                    break
            except Exception:
                pass

            current_size = 0
            for root, dirs, files in os.walk(blobs_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    try:
                        current_size += os.path.getsize(file_path)
                    except Exception:
                        pass

            if current_size > 0:
                # If index total_size isn't available yet during blob download, estimate based on model size
                if total_size <= 0:
                    if "awq" in model_id.lower() or "gptq" in model_id.lower():
                        total_size = int(2.8 * 1024**3)  # Quantized models ~2.8GB
                    elif "8b" in model_id.lower():
                        total_size = int(15.5 * 1024**3)
                    elif "4b" in model_id.lower() or "3b" in model_id.lower():
                        total_size = int(8.5 * 1024**3)
                    else:
                        total_size = int(8.0 * 1024**3)
                # Always ensure total >= current to prevent "7.51 / 7.49" display bug
                total_size = max(total_size, current_size)

                progress_pct = min(99.9, round((current_size / total_size) * 100.0, 1))
                current_gb = round(current_size / (1024**3), 2)
                total_gb = round(total_size / (1024**3), 2)
                status_msg = f"Downloading {model_id}... {progress_pct:.1f}% ({current_gb:.2f} GB / {total_gb:.2f} GB)"
            else:
                status_msg = f"Initializing Hugging Face download for {model_id}..."
    except Exception as e:
        logger.error(f"Error calculating download progress: {e}")

    # Mark this model as currently downloading so /api/models doesn't show it as "Ready"
    _model_download_in_progress.add(model_id)

    return {
        "ready": False,
        "downloading": True,
        "model_id": model_id,
        "display_name": display_name,
        "progress_pct": progress_pct,
        "status_msg": status_msg
    }



@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    db = SessionLocal()
    try:
        while True:
            time_limit = datetime.now() - timedelta(minutes=15)
            active_sessions = db.query(ChatSession).filter(ChatSession.updated_at >= time_limit).count()
            avg_latency = sum(latency_metrics) / len(latency_metrics) if latency_metrics else 0.0
            
            stats = get_system_telemetry(db, active_sessions, avg_latency)
            await websocket.send_json(stats)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        logger.info("Telemetry WebSocket disconnected")
    except Exception as e:
        logger.error(f"Telemetry WebSocket error: {e}")
    finally:
        db.close()


# ─── URL Content Fetching Endpoint ────────────────────────────────────────────
@app.post("/api/fetch-url")
async def fetch_url_endpoint(
    request: Request,
    current_user: User = Depends(get_current_approved_user)
):
    """Fetch and extract text content from a URL.
    
    Supports web pages, YouTube (title/channel), and any publicly accessible URL.
    Returns extracted text that can be used as AI context.
    """
    body = await request.json()
    url = body.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="'url' field is required.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        content = fetch_url_content(url)
        word_count = len(content.split())
        return {
            "url": url,
            "content": content,
            "word_count": word_count,
            "success": True
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL fetch failed: {str(e)}")


# ─── Enterprise Model Hub & Comparison API Routes ─────────────────────────────
@app.get("/api/models/catalog")
def get_models_catalog_endpoint(current_user: User = Depends(get_current_approved_user)):
    """Return enterprise model hub catalog with verified benchmarks & dynamic hardware compatibility."""
    user_gpu_vram = 6.0
    user_ram_gb = 16.0
    gpu_name = "NVIDIA GeForce RTX 2060"
    is_integrated = False
    try:
        telemetry = get_system_telemetry(db_session=None)
        if telemetry.get("gpu_vram_total") is not None:
            user_gpu_vram = float(telemetry["gpu_vram_total"])
        if telemetry.get("memory_total_gb") is not None:
            user_ram_gb = float(telemetry["memory_total_gb"])
        if telemetry.get("gpu_name"):
            gpu_name = str(telemetry["gpu_name"])
            if "intel" in gpu_name.lower() or "uhd" in gpu_name.lower() or "iris" in gpu_name.lower() or "radeon graphics" in gpu_name.lower():
                is_integrated = True
    except Exception:
        pass

    return {
        "catalog": get_full_catalog(
            user_gpu_vram=user_gpu_vram,
            user_ram_gb=user_ram_gb,
            is_integrated_gpu=is_integrated
        ),
        "user_gpu_vram_gb": user_gpu_vram,
        "user_ram_gb": user_ram_gb,
        "gpu_name": gpu_name,
        "is_integrated_gpu": is_integrated,
        "active_model_id": "Qwen/Qwen3-4B-AWQ"
    }


@app.post("/api/models/compare")
async def compare_models_endpoint(
    request: Request,
    current_user: User = Depends(get_current_approved_user)
):
    """Return side-by-side comparison metadata for up to 4 selected models."""
    body = await request.json()
    model_ids = body.get("model_ids", [])
    if not isinstance(model_ids, list) or not model_ids:
        raise HTTPException(status_code=400, detail="Please select at least 1 model to compare.")
    if len(model_ids) > 4:
        model_ids = model_ids[:4]
    
    full_catalog = get_full_catalog()
    catalog_map = {m["id"]: m for m in full_catalog}
    
    selected_models = [catalog_map[mid] for mid in model_ids if mid in catalog_map]
    return {
        "models": selected_models,
        "count": len(selected_models)
    }


import threading
import time as _time

# Global download progress tracker: { model_id: { percent, downloaded_mb, total_mb, speed_mbps, eta_secs, status, error } }
_download_progress: dict = {}
_cancel_events: dict = {}

def _run_bg_download(model_id: str):
    """Background download thread with real-time progress tracking and cancellation support."""
    cancel_event = threading.Event()
    _cancel_events[model_id] = cancel_event

    _download_progress[model_id] = {
        "status": "starting",
        "percent": 0,
        "downloaded_mb": 0,
        "total_mb": 0,
        "speed_mbps": 0,
        "eta_secs": 0,
        "error": None
    }
    try:
        model_entry = next((m for m in MODELS_CATALOG if m["id"] == model_id), None)
        hf_repo = model_entry.get("hf_repo") if model_entry else model_id
        logger.info(f"Initiating background download for {model_id} (HF Repo: {hf_repo})...")

        _download_progress[model_id]["status"] = "downloading"

        from huggingface_hub import snapshot_download, HfApi
        import os as _os

        # ── Get total repo size (files_metadata=True gives accurate sizes) ──
        total_bytes = 0
        try:
            api = HfApi()
            info = api.model_info(repo_id=hf_repo, files_metadata=True)
            if info.siblings:
                total_bytes = sum(getattr(s, 'size', 0) or 0 for s in info.siblings)
            logger.info(f"Model {hf_repo} total size: {total_bytes / (1024*1024):.1f} MB ({len(info.siblings or [])} files)")
        except Exception as e:
            logger.warning(f"Could not get repo info for {hf_repo}: {e}")
            total_bytes = 0

        total_mb = round(total_bytes / (1024 * 1024), 1) if total_bytes > 0 else 0
        _download_progress[model_id]["total_mb"] = total_mb

        hf_folder = f"models--{hf_repo.replace('/', '--')}"
        cache_dir = f"/root/.cache/huggingface/hub/{hf_folder}"

        # ── Measure initial cache size to subtract (so progress starts from 0) ──
        initial_bytes = 0
        if _os.path.exists(cache_dir):
            for root, _, files in _os.walk(cache_dir):
                for f in files:
                    try:
                        initial_bytes += _os.path.getsize(_os.path.join(root, f))
                    except OSError:
                        pass
        initial_mb = round(initial_bytes / (1024 * 1024), 1)
        logger.info(f"Initial cache size for {hf_repo}: {initial_mb} MB")

        start_time = _time.time()
        prev_mb = 0
        prev_time = start_time

        stop_monitor = threading.Event()

        def _monitor_progress():
            nonlocal prev_mb, prev_time
            while not stop_monitor.is_set() and not cancel_event.is_set():
                try:
                    if _os.path.exists(cache_dir):
                        current_bytes = 0
                        for root, _, files in _os.walk(cache_dir):
                            for f in files:
                                try:
                                    current_bytes += _os.path.getsize(_os.path.join(root, f))
                                except OSError:
                                    pass
                        # Subtract initial cache size so download starts from 0
                        net_bytes = max(current_bytes - initial_bytes, 0)
                        net_mb = round(net_bytes / (1024 * 1024), 1)

                        # Calculate speed from delta (last 2 seconds)
                        now = _time.time()
                        dt = now - prev_time
                        if dt >= 1.0:
                            delta_mb = net_mb - prev_mb
                            speed_mbps = round(max(delta_mb / dt, 0), 2)
                            prev_mb = net_mb
                            prev_time = now
                        else:
                            speed_mbps = _download_progress[model_id].get("speed_mbps", 0)

                        pct = 0
                        eta = 0
                        if total_mb > 0:
                            pct = min(int((net_mb / total_mb) * 100), 99)
                            remaining_mb = max(total_mb - net_mb, 0)
                            eta = int(remaining_mb / speed_mbps) if speed_mbps > 0.1 else 0

                        _download_progress[model_id].update({
                            "percent": pct,
                            "downloaded_mb": net_mb,
                            "total_mb": total_mb,
                            "speed_mbps": speed_mbps,
                            "eta_secs": eta
                        })
                except Exception:
                    pass
                stop_monitor.wait(2.0)

        monitor_thread = threading.Thread(target=_monitor_progress, daemon=True)
        monitor_thread.start()

        # Check for cancel before starting snapshot
        if cancel_event.is_set():
            _download_progress[model_id]["status"] = "cancelled"
            return

        snapshot_download(repo_id=hf_repo, resume_download=True)

        stop_monitor.set()
        monitor_thread.join(timeout=2)

        if cancel_event.is_set():
            _download_progress[model_id]["status"] = "cancelled"
        else:
            _download_progress[model_id].update({
                "status": "completed",
                "percent": 100,
                "speed_mbps": 0,
                "eta_secs": 0
            })
            logger.info(f"Successfully downloaded model weights for {model_id} via HuggingFace Hub.")

    except Exception as e:
        if cancel_event.is_set():
            _download_progress[model_id]["status"] = "cancelled"
        else:
            logger.warning(f"HuggingFace download failed for {model_id}: {e}. Attempting Ollama pull...")
            _download_progress[model_id]["status"] = "ollama_fallback"
            try:
                import subprocess
                model_entry = next((m for m in MODELS_CATALOG if m["id"] == model_id), None)
                ollama_tag = model_entry.get("ollama_tag") if model_entry else None
                if ollama_tag and not cancel_event.is_set():
                    subprocess.run(["ollama", "pull", ollama_tag], check=False)
                    _download_progress[model_id].update({"status": "completed", "percent": 100})
                    logger.info(f"Successfully pulled Ollama model {ollama_tag} for {model_id}.")
            except Exception as o_err:
                _download_progress[model_id].update({"status": "error", "error": str(o_err)})
                logger.error(f"Ollama pull failed for {model_id}: {o_err}")
    finally:
        _model_download_in_progress.discard(model_id)
        _cancel_events.pop(model_id, None)


@app.post("/api/models/download")
async def download_model_endpoint(
    request: Request,
    current_user: User = Depends(get_current_approved_user)
):
    """Trigger on-demand background download for a catalog model."""
    body = await request.json()
    model_id = body.get("model_id", "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required.")
    
    _model_download_in_progress.add(model_id)
    thread = threading.Thread(target=_run_bg_download, args=(model_id,), daemon=True)
    thread.start()
    
    return {
        "message": f"Download initiated for {model_id}. Weights are loading in background.",
        "model_id": model_id,
        "status": "downloading"
    }


@app.post("/api/models/cancel-download")
async def cancel_download_endpoint(
    request: Request,
    current_user: User = Depends(get_current_approved_user)
):
    """Cancel an active model download in progress and remove partial files."""
    body = await request.json()
    model_id = body.get("model_id", "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required.")

    if model_id in _cancel_events:
        _cancel_events[model_id].set()

    _model_download_in_progress.discard(model_id)
    if model_id in _download_progress:
        _download_progress[model_id]["status"] = "cancelled"

    try:
        import shutil
        model_entry = next((m for m in MODELS_CATALOG if m["id"] == model_id), None)
        hf_repo = model_entry.get("hf_repo", model_id) if model_entry else model_id
        hf_folder_name = f"models--{hf_repo.replace('/', '--')}"
        home_dir = os.path.expanduser("~")
        possible_dirs = [
            os.path.join(home_dir, ".cache", "huggingface", "hub", hf_folder_name),
            os.path.join("/root/.cache/huggingface/hub", hf_folder_name),
            os.path.join(os.getenv("DATA_DIR", "./data"), "models", "hub", hf_folder_name),
        ]
        for d in possible_dirs:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)
    except Exception as ce:
        logger.error(f"Failed to cleanup partial files on cancel for {model_id}: {ce}")

    return {
        "message": f"Download cancelled for {model_id}.",
        "model_id": model_id,
        "status": "cancelled"
    }


@app.get("/api/models/download-status")
async def download_status_endpoint(
    current_user: User = Depends(get_current_approved_user)
):
    """Return real-time download progress for all active downloads."""
    return {
        "downloads": dict(_download_progress),
        "in_progress": list(_model_download_in_progress)
    }


@app.delete("/api/models/delete")
async def delete_model_endpoint(
    request: Request,
    current_user: User = Depends(get_current_approved_user)
):
    """Permanently delete cached model weights and free VRAM/RAM disk space."""
    body = await request.json()
    model_id = body.get("model_id", "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required.")

    import shutil
    import gc
    model_entry = next((m for m in MODELS_CATALOG if m["id"] == model_id), None)
    hf_repo = model_entry.get("hf_repo", model_id) if model_entry else model_id
    hf_folder_name = f"models--{hf_repo.replace('/', '--')}"
    
    home_dir = os.path.expanduser("~")
    possible_dirs = [
        os.path.join(home_dir, ".cache", "huggingface", "hub", hf_folder_name),
        os.path.join("/root/.cache/huggingface/hub", hf_folder_name),
        os.path.join(os.getenv("DATA_DIR", "./data"), "models", "hub", hf_folder_name),
        os.path.join(os.getenv("DATA_DIR", "./data"), "models", hf_folder_name),
    ]
    deleted = False
    for d in possible_dirs:
        if os.path.exists(d):
            try:
                shutil.rmtree(d, ignore_errors=True)
                deleted = True
                logger.info(f"Deleted model directory: {d}")
            except Exception as e:
                logger.error(f"Failed to delete model directory {d}: {e}")

    try:
        if model_entry and model_entry.get("ollama_tag"):
            import subprocess
            subprocess.run(["ollama", "rm", model_entry["ollama_tag"]], check=False)
            deleted = True
    except Exception:
        pass

    # Flush GPU VRAM & Garbage Collector
    try:
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass

    _model_download_in_progress.discard(model_id)
    return {
        "message": f"Successfully deleted model weights for '{model_id}'. Disk space & VRAM reclaimed.",
        "model_id": model_id,
        "deleted": deleted
    }


# Serve frontend React SPA from frontend_dist folder
@app.get("/{path_name:path}")
async def serve_frontend(path_name: str):
    # Build complete path to file
    frontend_dist_dir = "frontend_dist"
    file_path = os.path.join(frontend_dist_dir, path_name)
    
    # If the file exists, serve it (e.g. assets/index.js, manifest.json, sw.js, favicon.ico)
    if path_name and os.path.isfile(file_path):
        response = FileResponse(file_path)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
        
    # Otherwise, fall back to index.html (client-side routing handles the view)
    index_path = os.path.join(frontend_dist_dir, "index.html")
    if os.path.isfile(index_path):
        response = FileResponse(index_path)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    
    raise HTTPException(status_code=404, detail="SPA entry index.html not found in frontend_dist")
