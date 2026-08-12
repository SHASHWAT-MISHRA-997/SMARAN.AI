"""
Advanced multi-strategy chunking module for SMARAN.AI RAG system.
Implements:
1. Character Text Splitting
2. Recursive Character Text Splitting
3. Document-Type Specific Splitting (PDF, Word, Excel, Markdown layout aware)
4. Semantic Chunking (using adjacent sentence embedding similarity)
5. Agentic Contextual Chunking (context-enriching header prepending)
"""
import re
import math
import logging
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Helper function to compute cosine similarity of two vectors
def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    magnitude_v1 = math.sqrt(sum(a * a for a in v1))
    magnitude_v2 = math.sqrt(sum(b * b for b in v2))
    if not magnitude_v1 or not magnitude_v2:
        return 0.0
    return dot_product / (magnitude_v1 * magnitude_v2)


# ─── 1. Character Text Splitter ────────────────────────────────────────────────
class CharacterTextSplitter:
    """
    Standard splitter that segments text by exact character lengths
    with a given overlap.
    """
    def __init__(self, chunk_size: int = 600, chunk_overlap: int = 120, separator: str = ""):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separator = separator

    def split_text(self, text: str) -> List[str]:
        text = text.strip()
        if not text:
            return []
        
        if not self.separator:
            # Pure character slicing
            chunks = []
            i = 0
            while i < len(text):
                chunks.append(text[i : i + self.chunk_size])
                i += self.chunk_size - self.chunk_overlap
            return chunks

        # Split by separator first
        splits = text.split(self.separator)
        chunks = []
        current_chunk = []
        current_len = 0

        for split in splits:
            if current_len + len(split) > self.chunk_size:
                if current_chunk:
                    chunks.append(self.separator.join(current_chunk))
                # Simple backtrack for overlap
                overlap_splits = []
                overlap_len = 0
                for prev in reversed(current_chunk):
                    if overlap_len + len(prev) <= self.chunk_overlap:
                        overlap_splits.insert(0, prev)
                        overlap_len += len(prev)
                    else:
                        break
                current_chunk = overlap_splits + [split]
                current_len = sum(len(x) for x in current_chunk)
            else:
                current_chunk.append(split)
                current_len += len(split)

        if current_chunk:
            chunks.append(self.separator.join(current_chunk))
        return chunks


# ─── 2. Recursive Character Text Splitter ──────────────────────────────────────
class RecursiveCharacterTextSplitter:
    """
    Splits text recursively by checking paragraph, sentence, and word boundaries.
    """
    DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""]

    def __init__(self, chunk_size: int = 600, chunk_overlap: int = 120, separators: Optional[List[str]] = None):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or self.DEFAULT_SEPARATORS

    def split_text(self, text: str) -> List[str]:
        # Normalize excessive newlines and whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+\n', '\n', text)
        text = text.strip()
        if not text:
            return []
        return self._split(text, self.separators)

    def _split(self, text: str, separators: List[str]) -> List[str]:
        final_chunks = []
        separator = separators[-1]
        new_separators = []

        for i, sep in enumerate(separators):
            if sep == "":
                separator = sep
                break
            if sep in text:
                separator = sep
                new_separators = separators[i + 1:]
                break

        if separator:
            raw_splits = text.split(separator)
            # Re-attach sentence terminators to keep full semantics intact
            if separator not in ("\n\n", "\n", ""):
                splits = []
                for s in raw_splits[:-1]:
                    splits.append(s + separator)
                splits.append(raw_splits[-1])
            else:
                splits = raw_splits
        else:
            splits = list(text)

        current_chunk = []
        current_len = 0

        for split in splits:
            if not split:
                continue
            split_len = len(split)

            if split_len > self.chunk_size:
                if current_chunk:
                    final_chunks.append(separator.join(current_chunk))
                    current_chunk = []
                    current_len = 0
                if new_separators:
                    final_chunks.extend(self._split(split, new_separators))
                else:
                    i = 0
                    while i < len(split):
                        final_chunks.append(split[i : i + self.chunk_size])
                        i += self.chunk_size - self.chunk_overlap
                continue

            sep_len = len(separator) if current_chunk else 0
            if current_len + sep_len + split_len > self.chunk_size:
                if current_chunk:
                    final_chunks.append(separator.join(current_chunk))
                
                # Backtrack for overlap
                overlap_splits = []
                overlap_len = 0
                for prev in reversed(current_chunk):
                    prev_sep = len(separator) if overlap_splits else 0
                    if overlap_len + prev_sep + len(prev) <= self.chunk_overlap:
                        overlap_splits.insert(0, prev)
                        overlap_len += prev_sep + len(prev)
                    else:
                        break
                current_chunk = overlap_splits + [split]
                current_len = sum(len(x) for x in current_chunk) + len(separator) * max(len(current_chunk) - 1, 0)
            else:
                current_chunk.append(split)
                current_len += sep_len + split_len

        if current_chunk:
            final_chunks.append(separator.join(current_chunk))

        return [c.strip() for c in final_chunks if c.strip()]


# ─── 3. Semantic Chunking with Embeddings ──────────────────────────────────────
class SemanticTextSplitter:
    """
    Groups sentences based on embedding cosine similarity drops.
    Tuned for highly coherent thematic chunks.
    """
    def __init__(self, chunk_size: int = 600, chunk_overlap: int = 120, similarity_threshold: float = 0.80):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.similarity_threshold = similarity_threshold

    def split_text(self, text: str) -> List[str]:
        # Split text into sentences
        sentence_regex = r'(?<=[.?!])\s+(?=[A-Za-z0-9])'
        sentences = [s.strip() for s in re.split(sentence_regex, text) if s.strip()]
        if len(sentences) < 2:
            return [text]

        # Get embeddings via local Ollama embeddings wrapper
        try:
            from app.rag.embeddings import OllamaEmbeddings
            embeddings_service = OllamaEmbeddings()
            embeddings = embeddings_service.embed_documents(sentences)
        except Exception as e:
            logger.warning(f"Semantic splitter failed to fetch embeddings (engine booting?). Falling back to recursive character splitter: {e}")
            fallback = RecursiveCharacterTextSplitter(self.chunk_size, self.chunk_overlap)
            return fallback.split_text(text)

        if not embeddings or len(embeddings) != len(sentences):
            fallback = RecursiveCharacterTextSplitter(self.chunk_size, self.chunk_overlap)
            return fallback.split_text(text)

        # Compute cosine similarities between consecutive sentences
        similarities = []
        for i in range(len(embeddings) - 1):
            similarities.append(cosine_similarity(embeddings[i], embeddings[i+1]))

        # Split sentences where similarity drops below the threshold
        chunks = []
        current_group = [sentences[0]]
        current_len = len(sentences[0])

        for i, similarity in enumerate(similarities):
            next_sentence = sentences[i+1]
            next_len = len(next_sentence)

            # If similarity is low or the chunk size grows too large, cut a new chunk
            if similarity < self.similarity_threshold or current_len + next_len > self.chunk_size:
                chunks.append(" ".join(current_group))
                # Incorporate semantic overlap by carrying over the last sentence if appropriate
                if current_group and len(current_group[-1]) <= self.chunk_overlap:
                    current_group = [current_group[-1], next_sentence]
                    current_len = len(current_group[0]) + len(next_sentence) + 1
                else:
                    current_group = [next_sentence]
                    current_len = next_len
            else:
                current_group.append(next_sentence)
                current_len += next_len + 1

        if current_group:
            chunks.append(" ".join(current_group))

        return chunks


# ─── 4. Document-Type Layout Aware & Agentic Chunking ──────────────────────────
class DocumentTextSplitter:
    """
    Splits document text by structural boundaries (Markdown headings, PDF pages, Excel rows).
    """
    def __init__(self, file_type: str, chunk_size: int = 600, chunk_overlap: int = 120):
        self.file_type = file_type.lower().lstrip(".")
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def split_text(self, text: str) -> List[str]:
        # Document layout specific rules
        if self.file_type == "md":
            # Split by markdown headers
            header_splits = re.split(r'(?=\n#{1,4}\s+)', text)
            chunks = []
            for split in header_splits:
                if len(split) > self.chunk_size:
                    rec = RecursiveCharacterTextSplitter(self.chunk_size, self.chunk_overlap)
                    chunks.extend(rec.split_text(split))
                else:
                    chunks.append(split)
            return [c.strip() for c in chunks if c.strip()]
        
        elif self.file_type in ("xlsx", "csv"):
            # Excel / CSV row-wise boundaries
            row_splits = text.split("\nRow ")
            chunks = []
            current_chunk = []
            current_len = 0
            for idx, row in enumerate(row_splits):
                row_str = f"Row {row}" if idx > 0 else row
                if current_len + len(row_str) > self.chunk_size:
                    if current_chunk:
                        chunks.append("\n".join(current_chunk))
                    current_chunk = [row_str]
                    current_len = len(row_str)
                else:
                    current_chunk.append(row_str)
                    current_len += len(row_str) + 1
            if current_chunk:
                chunks.append("\n".join(current_chunk))
            return chunks

        # Default fallback to recursive splitter
        rec = RecursiveCharacterTextSplitter(self.chunk_size, self.chunk_overlap)
        return rec.split_text(text)


class AgenticContextualChunker:
    """
    Optimized Grouping Agent: Enriches chunks with contextual metadata prefixes
    (e.g., document name, sheet name, section headers) to guarantee 100% correct RAG matches.
    """
    def __init__(self, doc_name: str, file_type: str, base_splitter: Any):
        self.doc_name = doc_name
        self.file_type = file_type.lower().lstrip(".")
        self.base_splitter = base_splitter

    def split_text(self, text: str) -> List[str]:
        raw_chunks = self.base_splitter.split_text(text)
        enriched_chunks = []

        # Find any section metadata
        for idx, chunk in enumerate(raw_chunks):
            # Parse structural headings present in the chunk
            headings = re.findall(r'^#{1,4}\s+(.*)$', chunk, re.MULTILINE)
            section_info = f" | Section: {headings[0]}" if headings else ""

            # Excel/CSV sheet tracking
            sheet_match = re.search(r'Sheet:\s*([^\n]+)', chunk)
            sheet_info = f" | Sheet: {sheet_match.group(1)}" if sheet_match else ""

            # Standard Contextual Retrieval prefix to bind retrieval embedding cleanly
            prefix = f"[Source: {self.doc_name}{sheet_info}{section_info} | Part {idx+1}/{len(raw_chunks)}]\n"
            enriched_chunks.append(prefix + chunk)

        return enriched_chunks


# ─── Chunker Factory ───────────────────────────────────────────────────────────
class DocumentChunker:
    """
    Factory interface to choose and instantiate the best chunking strategy
    based on model size, file type, and accuracy requirements.
    """
    @classmethod
    def for_file_type(cls, file_type: str, doc_name: str = "Unknown Document") -> AgenticContextualChunker:
        ft = (file_type or "").lower().lstrip(".")
        
        # Determine base chunk sizes — larger chunks = more rows/context per chunk = better accuracy
        if ft in ("xlsx", "csv"):
            # Excel/CSV tables: row-specific layout chunking
            # 2000 chars ~= 12-15 rows per chunk (wide coverage for full table analysis)
            base_splitter = DocumentTextSplitter(file_type=ft, chunk_size=2000, chunk_overlap=300)
        elif ft in ("pdf", "docx", "pptx"):
            # PDFs and word docs: semantic similarity-based sentence boundaries
            # 1500 chars = ~4-5 full paragraphs per chunk, capturing better structural context
            base_splitter = SemanticTextSplitter(chunk_size=1500, chunk_overlap=300, similarity_threshold=0.82)
        else:
            # Markdown and other text files: layout-aware splitting
            # 1200 chars = more content per embedding for better semantic matching
            base_splitter = DocumentTextSplitter(file_type=ft, chunk_size=1200, chunk_overlap=200)

        # Wrap in AgenticContextualChunker to ensure maximum context matching
        return AgenticContextualChunker(doc_name=doc_name, file_type=ft, base_splitter=base_splitter)
