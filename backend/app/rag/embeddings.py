import logging
import time
import hashlib
import os
import numpy as np
import requests
from fastapi import HTTPException
from app.config import settings

logger = logging.getLogger(__name__)

#: Which backend produced the last vector, and whether it meant anything.
#: Read by semantic_status(); set by the manager below.
_LAST_BACKEND = {"name": "none", "semantic": False, "why": "nothing embedded yet"}


def semantic_status() -> dict:
    """Whether embeddings here carry meaning, and why not when they do not.

    This exists because the fallback below is a random vector. Callers that
    offer "semantic search" need to be able to tell the difference, and
    before this they could not: they received a list of floats either way.
    """
    return dict(_LAST_BACKEND)


def _generate_fallback_embedding(text: str, dim: int = 1024) -> list[float]:
    """A random vector seeded from the text's hash. NOT an embedding.

    Two sentences meaning the same thing land nowhere near each other here,
    because nothing about meaning survives a hash. It exists only so that
    callers expecting a fixed-width vector do not crash when no real
    embedder is reachable, and any search built on it returns noise.

    Anything presenting results from this as semantic search is wrong.
    semantic_status() reports when it is in use.
    """
    seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)
    rng = np.random.RandomState(seed)
    vec = rng.randn(dim)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


class OpenRouterFreeEmbeddings:
    """Free OpenRouter NVIDIA Nemotron Embeddings API integration.
    Models:
    - nvidia/nemotron-3-embed-1b:free
    - nvidia/llama-nemotron-embed-vl-1b-v2:free
    """
    def __init__(self, api_key: str = None, model: str = "nvidia/nemotron-3-embed-1b:free"):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY", "")
        self.model = model
        self.endpoint = "https://openrouter.ai/api/v1/embeddings"

    def is_available(self) -> bool:
        return bool(self.api_key and len(self.api_key.strip()) > 5)

    def embed_query(self, text: str) -> list[float]:
        if not self.is_available():
            return []
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key.strip()}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3003",
                "X-Title": "SMARAN.AI"
            }
            payload = {"model": self.model, "input": text}
            res = requests.post(self.endpoint, headers=headers, json=payload, timeout=12)
            if res.status_code == 200:
                data = res.json()
                items = data.get("data", [])
                if items and "embedding" in items[0]:
                    return items[0]["embedding"]
        except Exception as e:
            logger.warning(f"OpenRouter free embedding query failed ({e})")
        return []

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts or not self.is_available():
            return []
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key.strip()}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3003",
                "X-Title": "SMARAN.AI"
            }
            payload = {"model": self.model, "input": texts}
            res = requests.post(self.endpoint, headers=headers, json=payload, timeout=25)
            if res.status_code == 200:
                data = res.json()
                items = data.get("data", [])
                if items:
                    return [item["embedding"] for item in sorted(items, key=lambda x: x.get("index", 0))]
        except Exception as e:
            logger.warning(f"OpenRouter batch free embedding failed ({e})")
        return []


class OllamaEmbeddings:
    def __init__(self):
        self.base_url = settings.OLLAMA_URL
        self.model = getattr(settings, 'DEFAULT_EMBEDDING_MODEL', 'nomic-embed-text')
        self._resolved_url = None
        self._retry_after = 0
        self.enabled = os.getenv("OLLAMA_EMBEDDINGS_ENABLED", "1" if settings.INFERENCE_ENGINE == "ollama" else "0") == "1"
        self.openrouter_embedder = OpenRouterFreeEmbeddings()

    def semantic_search_available(self) -> bool:
        """Return True when either Ollama local embeddings or OpenRouter Free Embeddings are reachable."""
        if self.openrouter_embedder.is_available():
            return True
        return bool(self._resolve_url())

    def _resolve_url(self) -> str:
        if not self.enabled:
            return ""
        if self._resolved_url:
            return self._resolved_url
        if time.time() < self._retry_after:
            return ""
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
                    self._resolved_url = c
                    return c
            except Exception:
                continue
        self._retry_after = time.time() + 300
        return ""

    def embed_query(self, text: str) -> list[float]:
        # 1. Try OpenRouter Free NVIDIA Nemotron 3 Embed 1B if key is available
        if self.openrouter_embedder.is_available():
            vec = self.openrouter_embedder.embed_query(text)
            if vec:
                _LAST_BACKEND.update(name="openrouter", semantic=True, why="")
                return vec

        # 2. Try Local Ollama Embeddings
        try:
            url_base = self._resolve_url()
            if url_base:
                url = f"{url_base}/api/embed"
                payload = {"model": self.model, "input": text}
                # 10 seconds was not enough for the first call after a
                # restart: Ollama loads the embedding model on demand, that
                # took longer, the request timed out and the manager fell
                # through to hash vectors - so the first search after every
                # restart silently returned noise. Measured cold load here
                # was over ten seconds and well under sixty.
                response = requests.post(url, json=payload, timeout=60)
                if response.status_code == 200:
                    embeddings = response.json().get("embeddings", [])
                    if embeddings:
                        _LAST_BACKEND.update(name="ollama", semantic=True, why="")
                        return embeddings[0]
        except Exception as e:
            logger.warning(f"Ollama embed query unavailable ({e})")
        
        # Loud, once per reason: silently returning noise is how "semantic
        # search" ends up meaning nothing.
        _LAST_BACKEND.update(
            name="hash-fallback", semantic=False,
            why=("No embedding backend answered. OpenRouter needs a working "
                 "key and Ollama needs an embedding model pulled and the "
                 "server started with --embeddings. Results from this are "
                 "not semantic."))
        logger.warning("Embeddings fell back to hash vectors - search is not semantic. %s",
                       _LAST_BACKEND["why"])
        return _generate_fallback_embedding(text)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        # 1. Try OpenRouter Free NVIDIA Nemotron 3 Embed 1B if key is available
        if self.openrouter_embedder.is_available():
            vecs = self.openrouter_embedder.embed_documents(texts)
            if vecs and len(vecs) == len(texts):
                _LAST_BACKEND.update(name="openrouter", semantic=True, why="")
                return vecs

        # 2. Try Local Ollama Embeddings
        try:
            url_base = self._resolve_url()
            if url_base:
                url = f"{url_base}/api/embed"
                payload = {"model": self.model, "input": texts}
                # Same reason as embed_query, with more to do.
                response = requests.post(url, json=payload, timeout=120)
                if response.status_code == 200:
                    embeddings = response.json().get("embeddings", [])
                    if embeddings and len(embeddings) == len(texts):
                        _LAST_BACKEND.update(name="ollama", semantic=True, why="")
                        return embeddings
        except Exception as e:
            logger.warning(f"Ollama batch embed unavailable ({e})")

        _LAST_BACKEND.update(
            name="hash-fallback", semantic=False,
            why="No embedding backend answered; these vectors carry no meaning.")
        logger.warning("Batch embeddings fell back to hash vectors - not semantic.")
        return [_generate_fallback_embedding(t) for t in texts]
