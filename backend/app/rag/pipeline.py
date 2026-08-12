import logging
import os
import re
import time
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from app.rag.embeddings import OllamaEmbeddings
from app.rag.bm25 import BM25Searcher
from app.models import DocumentChunk, Document

logger = logging.getLogger(__name__)

class RAGPipeline:
    def __init__(self):
        self.embeddings = OllamaEmbeddings()
        
        # Initialize Qdrant Manager conditionally
        self.use_qdrant = False
        try:
            if os.getenv("QDRANT_ENABLED", "0") != "1":
                raise RuntimeError("Qdrant disabled; using local Chroma")
            from app.rag.qdrant import QdrantManager
            self.qdrant_manager = QdrantManager()
            self.use_qdrant = True
            logger.info("RAGPipeline initialized with Qdrant vector engine.")
        except Exception as e:
            logger.warning(f"Could not load QdrantManager: {e}. Falling back to Chroma.")

        # Always initialize Chroma Manager as fallback/default
        try:
            from app.rag.chroma import ChromaManager
            self.chroma_manager = ChromaManager()
            logger.info("RAGPipeline initialized with Chroma vector engine fallback.")
        except Exception as e:
            logger.error(f"Failed to initialize ChromaManager: {e}")
            self.chroma_manager = None

    def add_chunks(self, collection_id: int, document_id: int, chunk_ids: list[str], texts: list[str], embeddings: list[list[float]]):
        """Indexes document chunks into the active vector database(s)."""
        success = False
        if self.use_qdrant:
            try:
                self.qdrant_manager.add_chunks(collection_id, document_id, chunk_ids, texts, embeddings)
                success = True
            except Exception as e:
                logger.error(f"Qdrant add_chunks error: {e}. Falling back to Chroma.")
        
        if (not success or not self.use_qdrant) and self.chroma_manager:
            try:
                self.chroma_manager.add_chunks(collection_id, document_id, chunk_ids, texts, embeddings)
            except Exception as e:
                logger.error(f"Chroma add_chunks error: {e}")

    def delete_document(self, collection_id: int, document_id: int):
        """Deletes a document from the vector database(s)."""
        if self.use_qdrant:
            try:
                self.qdrant_manager.delete_document(collection_id, document_id)
            except Exception as e:
                logger.error(f"Qdrant delete_document error: {e}")
        if self.chroma_manager:
            try:
                self.chroma_manager.delete_document(collection_id, document_id)
            except Exception as e:
                logger.error(f"Chroma delete_document error: {e}")

    def delete_collection(self, collection_id: int):
        """Deletes a collection from the vector database(s)."""
        if self.use_qdrant:
            try:
                self.qdrant_manager.delete_collection(collection_id)
            except Exception as e:
                logger.error(f"Qdrant delete_collection error: {e}")
        if self.chroma_manager:
            try:
                self.chroma_manager.delete_collection(collection_id)
            except Exception as e:
                logger.error(f"Chroma delete_collection error: {e}")

    def search(self, db: Session, query: str, collection_ids: List[int], limit: int = 5, session_id: str = None) -> List[Dict[str, Any]]:
        search_started = time.perf_counter()
        if not collection_ids:
            return []

        # Wider candidate pool = better RRF reranking quality (6x vs old 4x)
        candidate_multiplier = 3

        allowed_doc_ids = None
        if session_id:
            allowed_doc_ids = {row[0] for row in db.query(Document.id).filter(
                Document.collection_id.in_(collection_ids),
                (Document.session_id == session_id) | (Document.session_id == None)
            ).all()}

        # --- 1. Dense Semantic Search (Vector) ---
        vector_results = []
        try:
            if not self.embeddings.semantic_search_available():
                logger.info("Real embedding service unavailable; using BM25-only retrieval instead of random fallback vectors.")
                raise RuntimeError("semantic embeddings unavailable")
            query_vector = self.embeddings.embed_query(query)

            for col_id in collection_ids:
                col_results = []
                # Try Qdrant first if active
                if self.use_qdrant:
                    try:
                        col_results = self.qdrant_manager.query_collection(
                            collection_id=col_id,
                            query_embedding=query_vector,
                            n_results=limit * candidate_multiplier
                        )
                    except Exception as q_err:
                        logger.warning(f"Qdrant query failed: {q_err}. Reverting to Chroma.")
                
                # Revert to Chroma if Qdrant is inactive or failed
                if (not col_results) and self.chroma_manager:
                    col_results = self.chroma_manager.query_collection(
                        collection_id=col_id,
                        query_embedding=query_vector,
                        n_results=limit * candidate_multiplier
                    )
                if allowed_doc_ids is not None:
                    col_results = [item for item in col_results if item.get("document_id") in allowed_doc_ids]
                vector_results.extend(col_results)

            # Sort all combined vector results by score desc
            vector_results.sort(key=lambda x: x["score"], reverse=True)
        except Exception as e:
            logger.error(f"Error during vector search in pipeline: {e}")

        # --- 2. Sparse Keyword Search (BM25) ---
        bm25_results = []
        try:
            chunks_query = db.query(DocumentChunk).join(Document, Document.id == DocumentChunk.document_id).filter(DocumentChunk.collection_id.in_(collection_ids))
            if session_id:
                chunks_query = chunks_query.filter(
                    (Document.session_id == session_id) | (Document.session_id == None)
                )
            # Avoid rebuilding BM25 over an unbounded collection on every turn.
            # SQLite performs a fast keyword prefilter; BM25 then ranks the
            # bounded candidate set. Generic summarize/explain requests bypass
            # this method in the chat route and therefore remain unaffected.
            query_terms = list(dict.fromkeys(
                token.lower() for token in re.findall(r'[a-zA-Z0-9_-]+', query)
                if len(token) >= 2
            ))[:8]
            if query_terms:
                chunks_query = chunks_query.filter(or_(*[
                    DocumentChunk.text.ilike(f'%{term}%') for term in query_terms
                ]))
            chunks_in_db = chunks_query.limit(2000).all()

            if chunks_in_db:
                corpus = [
                    {
                        "id": f"chunk-{chunk.id}",
                        "document_id": chunk.document_id,
                        "chunk_index": chunk.chunk_index,
                        "text": chunk.text
                    }
                    for chunk in chunks_in_db
                ]
                bm25_searcher = BM25Searcher(corpus)
                bm25_results = bm25_searcher.search(query, n_results=limit * candidate_multiplier)
        except Exception as e:
            logger.error(f"Error during BM25 search in pipeline: {e}")

        # --- 3. Reciprocal Rank Fusion (RRF) ---
        # k=40 is recommended by recent RAG research (default 60 is too conservative).
        rrf_scores: Dict[tuple, float] = {}
        k = 40

        for rank, item in enumerate(vector_results, start=1):
            key = (item["document_id"], item["chunk_index"])
            rrf_scores[key] = rrf_scores.get(key, 0.0) + (1.0 / (k + rank))

        for rank, item in enumerate(bm25_results, start=1):
            key = (item["document_id"], item["chunk_index"])
            rrf_scores[key] = rrf_scores.get(key, 0.0) + (1.0 / (k + rank))

        # Sort by RRF score desc and take top chunks
        sorted_keys = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
        top_keys = sorted_keys[:limit]

        # Keep indexed files usable when their wording does not overlap the query
        # and the optional embedding service is offline.
        if not top_keys:
            fallback_query = db.query(DocumentChunk).join(
                Document, Document.id == DocumentChunk.document_id
            ).filter(DocumentChunk.collection_id.in_(collection_ids))
            if session_id:
                fallback_query = fallback_query.filter(
                    (Document.session_id == session_id) | (Document.session_id == None)
                )
            fallback_chunks = fallback_query.order_by(
                Document.uploaded_at.desc(), DocumentChunk.chunk_index.asc()
            ).limit(limit).all()
            top_keys = [(chunk.document_id, chunk.chunk_index) for chunk in fallback_chunks]
            for rank, key in enumerate(top_keys, start=1):
                rrf_scores[key] = 1.0 / (100 + rank)

        # --- 4. Build final retrieval set ---
        retrieved_chunks = []
        doc_names: Dict[int, str] = {}

        # Batch-load all needed docs in one query for efficiency
        needed_doc_ids = list({key[0] for key in top_keys})
        if needed_doc_ids:
            docs_query = db.query(Document).filter(Document.id.in_(needed_doc_ids))
            if session_id:
                docs_query = docs_query.filter(
                    (Document.session_id == session_id) | (Document.session_id == None)
                )
            docs = docs_query.all()
            for doc in docs:
                doc_names[doc.id] = doc.name

        for key in top_keys:
            doc_id, chunk_idx = key
            if doc_id not in doc_names:
                doc_names[doc_id] = "Unknown Document"

            chunk_obj = db.query(DocumentChunk).filter(
                DocumentChunk.document_id == doc_id,
                DocumentChunk.chunk_index == chunk_idx
            ).first()

            if chunk_obj:
                rrf_val = round(rrf_scores[key], 6)
                retrieved_chunks.append({
                    "document_name": doc_names[doc_id],
                    "document_id": doc_id,
                    "chunk_index": chunk_idx,
                    "text": chunk_obj.text,
                    # 'score' is what SourceReference Pydantic schema requires
                    "score": rrf_val,
                    "rrf_score": rrf_val,
                })

        logger.info(
            "RAG retrieval completed in %.1f ms (collections=%d candidates=%d results=%d)",
            (time.perf_counter() - search_started) * 1000.0,
            len(collection_ids),
            len(chunks_in_db) if 'chunks_in_db' in locals() else 0,
            len(retrieved_chunks),
        )
        return retrieved_chunks
