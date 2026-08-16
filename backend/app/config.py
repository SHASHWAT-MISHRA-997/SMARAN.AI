import os
import json
from pydantic_settings import BaseSettings

# ── Read auto-detected hardware config written by bootstrapper.py ─────────────
_hw_config = {}
_hw_config_path = os.path.join(os.getenv("DATA_DIR", "./data"), "hardware_config.json")
try:
    if os.path.exists(_hw_config_path):
        with open(_hw_config_path) as _f:
            _hw_config = json.load(_f)
except Exception:
    pass

# Infer active inference engine from hardware config (vllm | ollama)
_detected_engine  = _hw_config.get("engine", "ollama")
_detected_model   = _hw_config.get("model_id", "llama3.2:3b")
_detected_api_url = _hw_config.get("api_url", "http://127.0.0.1:11434")


class Settings(BaseSettings):
    PROJECT_NAME: str = "SMARAN.AI Knowledge Management"

    # Storage Directories
    DATA_DIR: str = os.getenv("DATA_DIR", "./data")
    UPLOAD_DIR: str = os.path.join(os.getenv("DATA_DIR", "./data"), "uploads")
    CHROMA_DIR: str = os.path.join(os.getenv("DATA_DIR", "./data"), "chroma")
    SQLITE_DB_PATH: str = os.path.join(os.getenv("DATA_DIR", "./data"), "sqlite.db")
    MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "100"))

    # Database
    DATABASE_URL: str = f"sqlite:///{os.path.join(os.getenv('DATA_DIR', './data'), 'sqlite.db')}"

    # ── Inference Engine (auto-detected by bootstrapper.py) ──────────────────
    # "vllm"  → Uses vLLM OpenAI-compatible API (preferred, faster)
    # "ollama" → Uses Ollama API (fallback for CPU / low VRAM)
    # Value comes from hardware_config.json written at startup — NO hardcoding.
    INFERENCE_ENGINE: str = os.getenv("INFERENCE_ENGINE", _detected_engine)
    ACTIVE_MODEL:     str = os.getenv("ACTIVE_MODEL",     _detected_model)

    # vLLM API (OpenAI-compatible, port 8001)
    VLLM_URL: str = os.getenv("VLLM_URL", "http://vllm:8001/v1")

    # Ollama API (used as fallback + always used for embeddings)
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")

    # Embedding always uses Ollama (vLLM doesn't do embeddings)
    DEFAULT_EMBEDDING_MODEL: str = os.getenv("DEFAULT_EMBEDDING_MODEL", "nomic-embed-text")
    REASONING_MODEL: str = os.getenv("REASONING_MODEL", "nemotron-mini")
    VISION_MODEL: str = os.getenv("VISION_MODEL", "nemotron-nano-12b-v2")

    # Model context window
    MAX_MODEL_LEN: int = int(os.getenv("MAX_MODEL_LEN", _hw_config.get("max_model_len", 2048)))

    class Config:
        case_sensitive = True


settings = Settings()

# Ensure directories exist
os.makedirs(settings.DATA_DIR, exist_ok=True)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.CHROMA_DIR, exist_ok=True)
