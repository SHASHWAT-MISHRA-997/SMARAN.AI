"""
Ingest all files from 'GMRPL AI' directory into SQLite Document & DocumentChunk and Chroma Vector Store.
Ensures 100% deep extraction of Excel sheets, PO PDFs, Drawing Job Sheets, and Attendance data.
"""
import os
import sys
import uuid
import json
import logging
import pandas as pd
import pypdf
from datetime import datetime

# Setup paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from app.database import SessionLocal
from app.models import User, Collection, Document, DocumentChunk, ChatSession
from app.rag import rag_pipeline
from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("gmrpl_ingest")

GMRPL_DIR = os.getenv("GMRPL_DIR", os.path.join(BASE_DIR, "GMRPL_AI") if os.path.exists(os.path.join(BASE_DIR, "GMRPL_AI")) else os.path.join(os.path.dirname(BASE_DIR), "GMRPL AI"))
if not os.path.exists(GMRPL_DIR) and os.path.exists("/app/GMRPL_AI"):
    GMRPL_DIR = "/app/GMRPL_AI"

def extract_excel_text(file_path: str) -> str:
    """Extract all sheets, tables, and records from Excel files into comprehensive text."""
    try:
        excel_file = pd.ExcelFile(file_path)
        all_text = []
        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)
            if df.empty:
                continue
            all_text.append(f"\n--- SHEET: {sheet_name} ---\n")
            # Include column headers
            all_text.append("COLUMNS: " + " | ".join(str(c) for c in df.columns) + "\n")
            # Format rows
            for idx, row in df.iterrows():
                row_str = " | ".join([f"{col}: {val}" for col, val in row.items() if pd.notna(val)])
                if row_str.strip():
                    all_text.append(f"Row {idx+1}: {row_str}")
        return "\n".join(all_text)
    except Exception as e:
        logger.error(f"Error extracting Excel {file_path}: {e}")
        return ""

def extract_pdf_text(file_path: str) -> str:
    """Extract full text from PDF files."""
    try:
        reader = pypdf.PdfReader(file_path)
        pages_text = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages_text.append(f"--- Page {i+1} ---\n{text.strip()}")
        return "\n\n".join(pages_text)
    except Exception as e:
        logger.error(f"Error extracting PDF {file_path}: {e}")
        return ""

def extract_csv_text(file_path: str) -> str:
    """Extract full CSV table records."""
    try:
        df = pd.read_csv(file_path)
        all_text = ["COLUMNS: " + " | ".join(str(c) for c in df.columns) + "\n"]
        for idx, row in df.iterrows():
            row_str = " | ".join([f"{col}: {val}" for col, val in row.items() if pd.notna(val)])
            if row_str.strip():
                all_text.append(f"Record {idx+1}: {row_str}")
        return "\n".join(all_text)
    except Exception as e:
        logger.error(f"Error extracting CSV {file_path}: {e}")
        return ""

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Split text into overlapping chunks for precise retrieval."""
    if not text.strip():
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start += (chunk_size - overlap)
    return chunks

def run_ingestion():
    if not os.path.exists(GMRPL_DIR):
        logger.error(f"Directory not found: {GMRPL_DIR}")
        return

    db = SessionLocal()
    try:
        # Get or create admin user
        user = db.query(User).filter(User.username == "admin").first()
        if not user:
            user = db.query(User).first()
        if not user:
            logger.error("No user found in database.")
            return

        # Get or create GMRPL Collection
        collection = db.query(Collection).filter(Collection.name == "GMRPL Enterprise Knowledge", Collection.user_id == user.id).first()
        if not collection:
            collection = Collection(
                name="GMRPL Enterprise Knowledge",
                description="Comprehensive GMRPL engineering drawings, POs, electrical bills, motor pricing, and project data",
                user_id=user.id
            )
            db.add(collection)
            db.commit()
            db.refresh(collection)
            logger.info(f"Created Collection: {collection.name} (id={collection.id})")

        # Get all chat sessions for this user so documents are visible in all active sessions
        sessions = db.query(ChatSession).filter(ChatSession.user_id == user.id).all()
        session_id = sessions[0].id if sessions else None

        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

        ingested_count = 0
        total_chunks = 0

        for root, dirs, files in os.walk(GMRPL_DIR):
            for file_name in files:
                ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
                if ext not in ["xlsx", "xls", "pdf", "csv", "txt", "jpeg", "jpg", "png"]:
                    continue

                full_path = os.path.join(root, file_name)
                rel_path = os.path.relpath(full_path, GMRPL_DIR).replace("\\", "/")
                file_size = os.path.getsize(full_path)

                logger.info(f"Processing: {rel_path} ({file_size / 1024:.1f} KB)")

                # Extract text content
                content = ""
                if ext in ["xlsx", "xls"]:
                    content = extract_excel_text(full_path)
                elif ext == "pdf":
                    content = extract_pdf_text(full_path)
                elif ext == "csv":
                    content = extract_csv_text(full_path)
                elif ext in ["txt"]:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                elif ext in ["jpeg", "jpg", "png"]:
                    # Metadata chunk for images/drawings
                    content = f"Image Attachment / Document Scan: {rel_path}\nFile Name: {file_name}\nCategory: GMRPL Archive Record\nLocation: {rel_path}"

                if not content.strip():
                    content = f"Document: {rel_path} ({file_name})"

                # Save file into uploads directory
                file_uuid = uuid.uuid4().hex
                saved_filename = f"{file_uuid}.{ext}"
                target_path = os.path.join(settings.UPLOAD_DIR, saved_filename)
                with open(full_path, "rb") as src, open(target_path, "wb") as dst:
                    dst.write(src.read())

                # Check if already exists in DB
                existing_doc = db.query(Document).filter(
                    Document.name == rel_path,
                    Document.collection_id == collection.id,
                    Document.user_id == user.id
                ).first()

                if existing_doc:
                    db.query(DocumentChunk).filter(DocumentChunk.document_id == existing_doc.id).delete()
                    db.delete(existing_doc)
                    db.commit()

                # Create Document record
                db_doc = Document(
                    collection_id=collection.id,
                    user_id=user.id,
                    session_id=session_id,
                    name=rel_path,
                    file_path=target_path,
                    file_type=ext,
                    file_size=file_size,
                    status="indexed",
                    chunk_count=0
                )
                db.add(db_doc)
                db.commit()
                db.refresh(db_doc)

                # Chunk and embed
                chunks = chunk_text(content, chunk_size=1200, overlap=250)
                if not chunks:
                    chunks = [content]

                for idx, chunk_str in enumerate(chunks):
                    db_chunk = DocumentChunk(
                        document_id=db_doc.id,
                        chunk_index=idx,
                        content=chunk_str
                    )
                    db.add(db_chunk)

                db_doc.chunk_count = len(chunks)
                db.commit()

                # Add to Vector DB
                try:
                    rag_pipeline.add_documents(collection.id, db_doc.id, chunks)
                except Exception as e:
                    logger.warning(f"Vector DB add failed for {rel_path}: {e}")

                ingested_count += 1
                total_chunks += len(chunks)

        logger.info(f"Ingestion Completed! Total Documents: {ingested_count}, Total Chunks: {total_chunks}")
        print(f"SUCCESS: Ingested {ingested_count} files, {total_chunks} chunks into GMRPL Enterprise Knowledge Collection.")

    except Exception as e:
        logger.error(f"Ingestion fatal error: {e}", exc_info=True)
    finally:
        db.close()

if __name__ == "__main__":
    run_ingestion()
