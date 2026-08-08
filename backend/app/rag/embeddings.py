import logging
import time
import hashlib
import numpy as np
import requests
from fastapi import HTTPException
from app.config import settings

logger = logging.getLogger(__name__)

def _generate_fallback_embedding(text: str, dim: int = 768) -> list[float]:
    """Generate a deterministic 768-dimensional normalized embedding vector from text hash."""
    seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)
    rng = np.random.RandomState(seed)
    vec = rng.randn(dim)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


class OllamaEmbeddings:
    def __init__(self):
        self.base_url = settings.OLLAMA_URL
        self.model = getattr(settings, 'DEFAULT_EMBEDDING_MODEL', 'nomic-embed-text')

    def _resolve_url(self) -> str:
        candidates = []
        if self.base_url:
            candidates.append(self.base_url.rstrip('/'))
        candidates.extend([
            'http://host.docker.internal:11434',
            'http://127.0.0.1:11434',
            'http://ollama:11434',
        ])
        for c in candidates:
            try:
                resp = requests.get(f"{c}/api/tags", timeout=2)
                if resp.status_code == 200:
                    return c
            except Exception:
                continue
        return candidates[0] if candidates else 'http://127.0.0.1:11434'

    def embed_query(self, text: str) -> list[float]:
        try:
            url_base = self._resolve_url()
            url = f"{url_base}/api/embed"
            payload = {"model": self.model, "input": text}
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                embeddings = response.json().get("embeddings", [])
                if embeddings:
                    return embeddings[0]
        except Exception as e:
            logger.warning(f"Ollama embed query unavailable ({e}). Using local fallback embedding...")
        
        return _generate_fallback_embedding(text)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            url_base = self._resolve_url()
            url = f"{url_base}/api/embed"
            payload = {"model": self.model, "input": texts}
            response = requests.post(url, json=payload, timeout=30)
            if response.status_code == 200:
                embeddings = response.json().get("embeddings", [])
                if embeddings and len(embeddings) == len(texts):
                    return embeddings
        except Exception as e:
            logger.warning(f"Ollama batch embed unavailable ({e}). Using local fallback embeddings...")

        return [_generate_fallback_embedding(t) for t in texts]
