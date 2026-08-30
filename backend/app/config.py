import os
import sys
import json
from dotenv import dotenv_values
from pydantic_settings import BaseSettings

# Dynamic root data directory resolution
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_root_data = os.path.join(_project_root, "data")
_default_data_dir = _root_data if os.path.isdir(_root_data) else os.getenv("DATA_DIR", "./data")


# ── .env ─────────────────────────────────────────────────────────────────────
# This module is imported before anything else reads the environment, so the
# file is read here.
#
# Only keys prefixed SMARAN_ are taken. The .env in this tree was generated for
# the Docker Compose stack and still carries DATABASE_URL pointing at a
# `postgres` host, POSTGRES_* credentials and service ports. Importing those
# wholesale swaps the desktop app's SQLite database for a host that does not
# resolve, and the process dies on the first query. A prefix keeps the file
# usable by both without either one inheriting the other's mistakes.
#
# A variable already in the real environment is never overwritten: the shell
# and the installer outrank a file someone edited months ago.
#
# Frozen builds have no source tree, so the directory beside the .exe and the
# data directory are searched too — those are the only two places a user of the
# installed app can put a file.
_ENV_PREFIX = "SMARAN_"


def _env_candidates():
    yield os.path.join(_project_root, ".env")
    yield os.path.join(_default_data_dir, ".env")
    if getattr(sys, "frozen", False):
        yield os.path.join(os.path.dirname(sys.executable), ".env")


for _env_path in _env_candidates():
    if not os.path.isfile(_env_path):
        continue
    try:
        _values = dotenv_values(_env_path, encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        continue
    for _key, _value in _values.items():
        if _key.startswith(_ENV_PREFIX) and _value is not None:
            os.environ.setdefault(_key, _value)

# ── Read auto-detected hardware config written by bootstrapper.py ─────────────
_hw_config = {}
_hw_config_path = os.path.join(os.getenv("DATA_DIR", _default_data_dir), "hardware_config.json")
try:
    if os.path.exists(_hw_config_path):
        with open(_hw_config_path) as _f:
            _hw_config = json.load(_f)
except Exception:
    pass

# Infer active inference engine from hardware config (vllm | ollama)
_detected_engine  = _hw_config.get("engine", "ollama")
_detected_model   = _hw_config.get("model_id", "")
_detected_api_url = _hw_config.get("api_url", "http://127.0.0.1:11434")


class Settings(BaseSettings):
    PROJECT_NAME: str = "SMARAN.AI Knowledge Management"

    # Storage Directories
    DATA_DIR: str = os.getenv("DATA_DIR", _default_data_dir)
    UPLOAD_DIR: str = os.path.join(os.getenv("DATA_DIR", _default_data_dir), "uploads")
    CHROMA_DIR: str = os.path.join(os.getenv("DATA_DIR", _default_data_dir), "chroma")
    SQLITE_DB_PATH: str = os.path.join(os.getenv("DATA_DIR", _default_data_dir), "sqlite.db")
    MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "100"))

    # Database
    DATABASE_URL: str = f"sqlite:///{os.path.join(os.getenv('DATA_DIR', _default_data_dir), 'sqlite.db')}"

    # ── Inference Engine (auto-detected by bootstrapper.py) ──────────────────
    # "vllm"  → Uses vLLM OpenAI-compatible API (preferred, faster)
    # "ollama" → Uses Ollama API (fallback for CPU / low VRAM)
    # Value comes from hardware_config.json written at startup — NO hardcoding.
    INFERENCE_ENGINE: str = os.getenv("INFERENCE_ENGINE", _detected_engine)
    ACTIVE_MODEL:     str = os.getenv("ACTIVE_MODEL",     _detected_model)

    # vLLM API (OpenAI-compatible, port 8001)
    VLLM_URL: str = os.getenv("VLLM_URL", "http://vllm:8001/v1")

    # LM Studio serves the same OpenAI-compatible API that vLLM does, on 1234
    # by default. That is the whole reason it needed almost no new code: the
    # client that talks to vLLM is not a vLLM client, it is an OpenAI-shaped
    # one, and LM Studio answers it.
    LMSTUDIO_URL: str = os.getenv("LMSTUDIO_URL", "http://127.0.0.1:1234/v1")

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
