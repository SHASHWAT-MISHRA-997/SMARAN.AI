"""SMARAN.AI local-runtime bootstrapper.

At container startup this module records source-labelled hardware facts, chooses
a capacity-compatible local model recommendation, and writes
``hardware_config.json``.  A recommendation is not reported as installed or
active; the API verifies Ollama/vLLM readiness separately.  User-installed
models are preserved.
"""

import os
import sys
import json
import logging
import subprocess
import socket
import time
import urllib.request
import urllib.error

import psutil

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("bootstrapper")

DATA_DIR    = os.getenv("DATA_DIR", "./data")
CONFIG_PATH = os.path.join(DATA_DIR, "hardware_config.json")
HOST_STATS_PATH = os.getenv("HOST_STATS_PATH", os.path.join(DATA_DIR, "host_stats.json"))
HF_HOME = os.getenv("HF_HOME", os.path.join(DATA_DIR, "models"))
os.environ.setdefault("HF_HOME", HF_HOME)
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(HF_HOME, "hub"))

# Legacy Nemotron GGUF support is optional and must be explicitly configured.
# Defining these values prevents the background pull worker from crashing even
# when the current preferred model is not Nemotron.
NEMOTRON_OLLAMA_TAG = os.getenv("NEMOTRON_OLLAMA_TAG", "nemotron-nano-12b-v2")
NEMOTRON_GGUF_URL = os.getenv("NEMOTRON_GGUF_URL", "").strip()
NEMOTRON_GGUF_PATH = os.getenv(
    "NEMOTRON_GGUF_PATH",
    os.path.join(DATA_DIR, "models", "nemotron-nano-12b-v2.Q4_K_M.gguf"),
)


def _read_fresh_host_stats(max_age_seconds: float = 15.0) -> dict:
    """Read the optional host bridge only when its source and timestamp are fresh."""
    try:
        with open(HOST_STATS_PATH, encoding="utf-8") as stats_file:
            payload = json.load(stats_file)
        source = str(payload.get("telemetry_source", ""))
        timestamp = float(payload.get("timestamp", 0) or 0)
        age = time.time() - timestamp
        if not source.endswith("_host_bridge") or timestamp <= 0 or age < -5 or age > max_age_seconds:
            return {}
        return payload
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}


# ═════════════════════════════════════════════════════════════════════════════
# Local model recommendations — sorted by VRAM requirement (highest first).
# First match (fits in VRAM) wins.
#
# These entries guide automatic setup only. Existing user-installed Ollama
# models are never removed by the bootstrapper.
#
# Columns:
#   min_vram_gb  : Minimum capacity used for selection (not a speed guarantee)
#   min_ram_gb   : Minimum system RAM (for CPU-only fallback)
#   ollama_tag   : Exact Ollama pull tag
#   display_name : Human-readable name for UI
#   ctx_window   : Context window in tokens
#   reasoning    : True = model has strong reasoning / thinking capabilities
#   description  : Why this model was chosen
# The universal installer provisions this small text model through the official
# Ollama image. It is a starter, not a benchmark result or a promise that every
# device will run it quickly.
ACTIVE_LOCAL_MODEL = "qwen2.5:1.5b"
ACTIVE_VLLM_MODEL = ACTIVE_LOCAL_MODEL  # Backward-compatible import alias.

PREFERRED_MODELS = [
    {
        "min_vram_gb":  0.0,
        "min_ram_gb":   4.0,
        "model_id":     ACTIVE_LOCAL_MODEL,
        "ollama_tag":   ACTIVE_LOCAL_MODEL,
        "display_name": "Qwen 2.5 1.5B (local starter)",
        "ctx_window":   4096,
        "reasoning":    False,
        "description":  "Apache-2.0 text model used by the universal installer. Availability and latency are verified only after Ollama serves it."
    },
]


# Embedding model used by local RAG setup.
KEEP_MODELS = {"nomic-embed-text"}

# Legacy cleanup inventory retained for import compatibility. Both cleanup
# functions below are disabled and never delete user-installed models.
EXPLICIT_DELETE = [
    # Explicitly removed Qwen VL models
    "qwen2.5vl", "qwen2.5vl:latest",
    # Deprecated Qwen variants
    "qwen2.5:14b", "qwen2.5:7b", "qwen2.5:3b", "qwen2.5:1.5b", "qwen2.5:0.5b",
    "qwen2.5-coder:32b", "qwen2.5-coder:14b", "qwen2.5-coder:7b",
    "qwen2.5-coder:1.5b", "qwen:72b", "qwen:32b", "qwen:14b", "qwen:7b",
    "qwen:4b", "qwen:1.8b", "qwen:0.5b",
    # Deprecated Qwen3 variants (not in preferred list)
    "qwen3:30b-a3b", "qwen3:14b", "qwen3:8b", "qwen3:4b",
    # DeepSeek variants (not in preferred list)
    "deepseek-r1:32b", "deepseek-r1:14b", "deepseek-r1:7b",
    "deepseek-r1:1.5b", "deepseek-v2:16b", "deepseek-v2:7b", "deepseek-coder:33b",
    "deepseek-coder:6.7b", "deepseek-coder:1.3b",
    "deepseek-coder-v2:16b", "deepseek-llm:67b", "deepseek-llm:7b",
    # Old Llama variants (llama3.2:3b is now preferred — won't be deleted if present)
    "llama3.1:8b", "llama3.2:latest", "llama3.2:1b",
    "llama3.1:70b", "llama3.1:405b", "llama3:8b", "llama3:70b",
    "llama2:7b", "llama2:13b", "llama2:70b",
    # Old DeepSeek (replaced by nemotron-mini)
    "deepseek-r1:8b",
    "llama2-uncensored:7b", "llama-pro:8b", "llama-guard3:8b",
    # Mistral variants (not the specific preferred one)
    "mistral:latest", "mistral:7b", "mistral-nemo:latest", "mistral-large:latest",
    "mixtral:8x7b", "mixtral:8x22b", "codestral:latest", "codestral:22b",
    # Phi variants
    "phi4:latest", "phi4-mini:latest", "phi3:latest", "phi3:14b", "phi3:mini",
    "phi:latest", "phi-2:latest",
    # Gemma variants
    "gemma2:9b", "gemma2:2b", "gemma:7b", "gemma:2b",
    # Google Gemma 4 (but gemma4:12b is in preferred list so this will be skipped)
    "gemma4:latest", "gemma4:27b", "gemma4:9b", "gemma4:4b",
    # Vision models (only llama3.2-vision:11b is preferred)
    "moondream:latest", "moondream:1.8b", "moondream:0.5b",
    "minicpm-v:latest", "minicpm-v:8b",
    "llava:latest", "llava:7b", "llava:13b", "llava:34b",
    "llava-llama3:latest", "bakllava:latest",
    # Other deprecated
    "nomic-embed-text:latest",  # This will be SKIPPED because in KEEP_MODELS
    "codellama:latest", "codellama:7b", "codellama:13b", "codellama:34b",
    "starcoder:latest", "starcoder2:15b", "starcoder2:7b", "starcoder2:3b",
    "dolphin-mixtral:latest", "dolphin-mistral:latest",
    "dolphin-llama3:latest", "dolphin-phi:latest",
    "solar:latest", "solar:10.7b",
    "command-r:latest", "command-r-plus:latest",
    "aya:latest", "aya:23b", "aya:8b", "aya:35b",
    "falcon:latest", "falcon:7b", "falcon:40b", "falcon:180b",
    "gpt4all:latest",
    "orca-mini:latest", "orca2:latest",
    "zephyr:latest", "zephyr:7b",
    "tinyllama:latest", "tinydolphin:latest",
    "neural-chat:latest", "neural-chat:7b",
    "starling-lm:latest",
    "openchat:latest", "openchat:7b",
    "nous-hermes:latest", "nous-hermes2:34b", "nous-hermes2:10.7b",
    "vicuna:latest", "vicuna:7b", "vicuna:13b", "vicuna:33b",
    "wizardcoder:latest",
    "wizardlm:latest", "wizardlm:13b", "wizardlm:30b", "wizardlm:70b",
    "yarn-llama2:latest", "yarn-mistral:latest",
    "everythinglm:latest",
    "meditron:latest",
    "medllama2:latest",
    "magicoder:latest",
    "dolly:latest",
    "oasst:12b",
    "falcon2:11b",
]

# Build OLLAMA_DEPRECATED list: everything in EXPLICIT_DELETE that is NOT
# a preferred model tag and NOT in KEEP_MODELS.
PREFERRED_TAGS = {
    value
    for model in PREFERRED_MODELS
    for value in (model.get("model_id"), model.get("ollama_tag"))
    if value
}
OLLAMA_DEPRECATED = [
    m for m in EXPLICIT_DELETE
    if m not in PREFERRED_TAGS and m not in KEEP_MODELS
]


# ─────────────────────────────────────────────────────────────────────────────
# Hardware Detection
# ─────────────────────────────────────────────────────────────────────────────
def detect_cpu():
    host_stats = _read_fresh_host_stats()
    if host_stats:
        logical = int(host_stats.get("cpu_threads") or 0)
        physical = int(host_stats.get("cpu_cores") or 0)
        name = str(host_stats.get("cpu_name") or "Unavailable")
        if logical > 0:
            logger.info(
                "CPU (fresh host bridge): %s | Physical cores: %s | Logical processors: %s",
                name,
                physical or "unavailable",
                logical,
            )
            return {
                "cpu_name": name,
                "cpu_cores_logical": logical,
                "cpu_cores_physical": physical or None,
                "cpu_max_ghz": None,
                "source": host_stats.get("telemetry_source"),
            }

    logical  = psutil.cpu_count(logical=True)  or 1
    physical = psutil.cpu_count(logical=False) or 1
    name = "Unknown CPU"
    try:
        if os.path.exists("/proc/cpuinfo"):
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if line.startswith("model name"):
                        name = line.split(":", 1)[1].strip()
                        break
        else:
            res = subprocess.run(["wmic", "cpu", "get", "Name", "/format:value"],
                                 capture_output=True, text=True, timeout=5)
            for line in res.stdout.splitlines():
                if line.startswith("Name="):
                    name = line.split("=", 1)[1].strip()
    except Exception:
        pass
    freq = psutil.cpu_freq()
    max_ghz = round(freq.max / 1000.0, 2) if freq else 0.0
    logger.info(f"CPU: {name} | Logical cores: {logical} | Max: {max_ghz} GHz")
    return {"cpu_name": name, "cpu_cores_logical": logical,
            "cpu_cores_physical": physical, "cpu_max_ghz": max_ghz}


def detect_ram():
    host_stats = _read_fresh_host_stats()
    if host_stats:
        try:
            gb = float(host_stats.get("ram_total_gb") or 0)
        except (TypeError, ValueError):
            gb = 0.0
        if gb > 0:
            logger.info("RAM (fresh host bridge): %.2f GB total", gb)
            return {
                "ram_total_gb": round(gb, 2),
                "source": host_stats.get("telemetry_source"),
            }

    # On Windows host directly, try wmic first!
    try:
        res = subprocess.run(["wmic", "computersystem", "get", "TotalPhysicalMemory", "/format:value"],
                             capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines():
            if line.startswith("TotalPhysicalMemory="):
                bytes_val = int(line.split("=", 1)[1].strip())
                gb = round(bytes_val / (1024 ** 3), 2)
                logger.info(f"RAM (wmic): {gb} GB total")
                return {"ram_total_gb": gb}
    except Exception:
        pass

    # /host/proc/meminfo is most accurate (real host RAM, not Docker limit)
    try:
        for meminfo_path in ["/host/proc/meminfo", "/proc/meminfo"]:
            if os.path.exists(meminfo_path):
                info = {}
                with open(meminfo_path) as f:
                    for line in f:
                        parts = line.split()
                        if len(parts) >= 2:
                            info[parts[0].rstrip(":")] = int(parts[1])
                total_kb = info.get("MemTotal", 0)
                if total_kb > 0:
                    gb = round(total_kb / (1024 ** 2), 2)
                    logger.info(f"RAM ({meminfo_path}): {gb} GB total")
                    return {"ram_total_gb": gb}
    except Exception:
        pass
    mem = psutil.virtual_memory()
    gb  = round(mem.total / (1024 ** 3), 2)
    logger.info(f"RAM (psutil): {gb} GB total")
    return {"ram_total_gb": gb}


def detect_gpu():
    gpus = []
    driver = "N/A"

    host_stats = _read_fresh_host_stats()
    if host_stats:
        for index, item in enumerate(host_stats.get("gpus") or []):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            raw_vram = item.get("vram_total_gb")
            try:
                vram_gb = round(float(raw_vram), 2) if raw_vram is not None else 0.0
            except (TypeError, ValueError):
                vram_gb = 0.0
            gpus.append({
                "name": name,
                "vram_gb": vram_gb,
                "index": int(item.get("index", index) or index),
                "vendor": str(item.get("vendor") or "unknown"),
                "source": host_stats.get("telemetry_source"),
                "vram_measured": raw_vram is not None,
            })
        if gpus:
            logger.info("GPU (fresh host bridge): detected %d adapter(s)", len(gpus))
            return gpus, str(host_stats.get("driver_version") or "N/A")

    # NVML — fastest, most accurate for NVIDIA
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        for i in range(count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            raw = pynvml.nvmlDeviceGetName(handle)
            name = raw.decode() if isinstance(raw, bytes) else str(raw)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_gb = round(mem.total / (1024 ** 3), 2)
            gpus.append({"name": name, "vram_gb": vram_gb, "index": i, "vendor": "nvidia"})
        try:
            d = pynvml.nvmlSystemGetDriverVersion()
            driver = d.decode() if isinstance(d, bytes) else str(d)
        except Exception:
            pass
        pynvml.nvmlShutdown()
        logger.info(f"GPU (NVML): detected {len(gpus)} NVIDIA GPU(s)")
        return gpus, driver
    except Exception as e:
        logger.warning(f"NVML failed: {e}. Trying nvidia-smi...")

    # nvidia-smi fallback for NVIDIA
    for smi in ["nvidia-smi", "/usr/bin/nvidia-smi", r"C:\Windows\System32\nvidia-smi.exe"]:
        try:
            res = subprocess.run(
                [smi, "--query-gpu=index,name,memory.total,driver_version",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5)
            if res.returncode == 0 and res.stdout.strip():
                lines = res.stdout.strip().split("\n")
                for line in lines:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 3:
                        gpus.append({
                            "index": int(parts[0]) if len(parts) > 3 else len(gpus),
                            "name": parts[0] if len(parts) <= 3 else parts[1],
                            "vram_gb": round(float(parts[1] if len(parts) <= 3 else parts[2]) / 1024.0, 2),
                            "vendor": "nvidia"
                        })
                        if len(parts) > 3 and driver == "N/A":
                            driver = parts[3]
                if gpus:
                    logger.info(f"GPU (nvidia-smi): detected {len(gpus)} NVIDIA GPU(s)")
                    return gpus, driver
        except Exception:
            continue

    # WMI / CIM fallback for AMD and other GPUs
    try:
        import platform
        if platform.system() == "Windows":
            try:
                ps_script = """
                Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Json -Compress
                """
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True, text=True, timeout=10
                )
                if res.returncode == 0 and res.stdout.strip():
                    import json
                    controllers = json.loads(res.stdout.strip())
                    if isinstance(controllers, dict):
                        controllers = [controllers]
                    for idx, ctrl in enumerate(controllers):
                        name = ctrl.get("Name", "Unknown GPU")
                        adapter_ram_bytes = int(ctrl.get("AdapterRAM", 0) or 0)
                        vram_gb = round(adapter_ram_bytes / (1024 ** 3), 2)
                        if vram_gb < 0.1:
                            vram_gb = 0.5  # fallback for iGPUs with shared memory
                        vendor = "amd" if "amd" in name.lower() or "radeon" in name.lower() else "other"
                        gpus.append({
                            "index": idx,
                            "name": name,
                            "vram_gb": vram_gb,
                            "vendor": vendor
                        })
                        if driver == "N/A":
                            driver = ctrl.get("DriverVersion", "N/A")
                    if gpus:
                        logger.info(f"GPU (WMI): detected {len(gpus)} GPU(s): {[g['name'] for g in gpus]}")
                        return gpus, driver
            except Exception as e:
                logger.warning(f"WMI GPU detection failed: {e}")
    except Exception:
        pass

    logger.warning("No GPU detected — CPU-only mode.")
    return gpus, driver


# ─────────────────────────────────────────────────────────────────────────────
def resolve_ollama_base() -> str:
    candidates = [
        os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip('/'),
        'http://127.0.0.1:11434',
        'http://localhost:11434',
        'http://ollama:11434',
    ]
    for c in candidates:
        try:
            req = urllib.request.Request(c + '/api/tags', method="GET")
            with urllib.request.urlopen(req, timeout=2):
                return c
        except Exception:
            continue
    return candidates[0]


# Capacity-aware local model selection
# ─────────────────────────────────────────────────────────────────────────────
def select_best_model(vram_gb: float, ram_gb: float, cpu_cores: int) -> dict:
    """
    Select a configured local model whose declared memory requirement fits.

    This is a capacity check, not a benchmark or proof that the runtime is
    installed. Runtime readiness is verified independently by the API.
    """
    logger.info(f"Selecting best model for VRAM={vram_gb}GB, RAM={ram_gb}GB, CPU={cpu_cores} cores")

    # ── Ollama path (all preferred models) ──────────────────────────────────
    for tier in PREFERRED_MODELS:
        # A missing GPU can never satisfy a positive VRAM tier.
        if tier["min_vram_gb"] > 0:
            if vram_gb <= 0:
                continue
            effective = vram_gb - 0.5
            if effective < tier["min_vram_gb"]:
                continue
        # For CPU tier: check system RAM
        if tier["min_vram_gb"] == 0 and ram_gb < tier["min_ram_gb"]:
            continue

        model_name = tier.get("ollama_tag") or tier.get("model_id") or ACTIVE_VLLM_MODEL
        logger.info(
            f"Engine: Ollama | "
            f"Model: {model_name} | "
            f"Context: {tier['ctx_window']} tokens | "
            f"Reasoning: {tier['reasoning']} | "
            f"Reason: {tier['description']}"
        )
        return {
            "engine":       "ollama",
            "model_id":     model_name,
            "display_name": tier["display_name"],
            "ctx_window":   tier["ctx_window"],
            "reasoning":    tier["reasoning"],
            "quantization": "Q4_K_M",
            "api_url":      resolve_ollama_base(),
            "max_model_len": min(tier["ctx_window"], 32768),
        }

    # Do not label an incompatible, uninstalled fallback model as active.
    return {
        "engine":       "ollama",
        "model_id":     "",
        "display_name": "No compatible local model selected",
        "ctx_window":   0,
        "reasoning":    False,
        "quantization": "N/A",
        "api_url":      resolve_ollama_base(),
        "max_model_len": 0,
        "unavailable_reason": "No preferred local model fits the measured GPU VRAM and system RAM.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Ollama helpers
# ─────────────────────────────────────────────────────────────────────────────
def _ollama_reachable(base=None, timeout=5) -> bool:
    if base is None:
        base = resolve_ollama_base()
    try:
        urllib.request.urlopen(f"{base}/api/tags", timeout=timeout)
        return True
    except Exception:
        return False


def delete_models_not_in_preferred_list():
    """Deprecated compatibility hook; automatic deletion is intentionally disabled."""
    logger.info("Automatic Ollama cleanup is disabled; preserving user-installed models.")
    return

    # Kept below for source compatibility with older deployments. It is
    # unreachable by design and can only be restored through an explicit,
    # user-approved maintenance workflow.
    base = resolve_ollama_base()
    if not _ollama_reachable(base):
        logger.info("Ollama not reachable — skipping model cleanup.")
        return

    # Fetch currently installed models
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=10) as r:
            data = json.loads(r.read())
            installed = [m["name"] for m in data.get("models", [])]
    except Exception as e:
        logger.warning(f"Could not fetch installed models: {e}")
        return

    if not installed:
        logger.info("No models currently installed in Ollama.")
        return

    # Determine which models to delete
    to_delete = []
    for installed_model in installed:
        # Strip :latest suffix for comparison
        clean_name = installed_model.replace(":latest", "")

        # Never delete keep models
        if clean_name in KEEP_MODELS or installed_model in KEEP_MODELS:
            logger.info(f"Keeping essential model: {installed_model}")
            continue

        # Check if it's one of the 8 preferred models
        is_preferred = False
        for tier in PREFERRED_MODELS:
            preferred_tag = tier["ollama_tag"]
            # Match with or without :latest
            if (installed_model == preferred_tag or
                installed_model == preferred_tag + ":latest" or
                clean_name == preferred_tag):
                is_preferred = True
                break

        if not is_preferred:
            to_delete.append(installed_model)

    if not to_delete:
        logger.info("No non-preferred models found — nothing to delete.")
        return

    logger.info(f"Deleting {len(to_delete)} non-preferred model(s): {to_delete}")
    for model in to_delete:
        try:
            req = urllib.request.Request(
                f"{base}/api/delete",
                data=json.dumps({"name": model}).encode(),
                method="DELETE",
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=30):
                logger.info(f"✓ Deleted: {model}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                logger.debug(f"Model '{model}' not installed — skip.")
            else:
                logger.warning(f"Could not delete '{model}': HTTP {e.code}")
        except Exception as e:
            logger.warning(f"Could not delete '{model}': {e}")


def delete_deprecated_ollama_models():
    """Deprecated compatibility hook; automatic deletion is intentionally disabled."""
    logger.info("Deprecated-model cleanup is disabled; preserving user-installed models.")
    return

    # Legacy implementation retained below only to avoid breaking imports in
    # third-party deployments. It is intentionally unreachable.
    base = resolve_ollama_base()
    if not _ollama_reachable(base):
        logger.info("Ollama not reachable — skipping deprecated model cleanup.")
        return
    for model in OLLAMA_DEPRECATED:
        # Skip keep models
        clean_name = model.replace(":latest", "")
        if clean_name in KEEP_MODELS:
            continue
        try:
            req = urllib.request.Request(
                f"{base}/api/delete",
                data=json.dumps({"name": model}).encode(),
                method="DELETE",
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=10):
                logger.info(f"Deleted deprecated model: {model}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                logger.debug(f"Model '{model}' not installed — skip.")
            else:
                logger.warning(f"Could not delete '{model}': HTTP {e.code}")
        except Exception as e:
            logger.warning(f"Could not delete '{model}': {e}")


def pull_ollama_model(model_tag: str):
    """Pull a standard Ollama model. Skips Nemotron (handled separately via GGUF)."""
    if model_tag == NEMOTRON_OLLAMA_TAG:
        pull_nemotron_via_gguf()
        return

    base = resolve_ollama_base()
    # Wait for Ollama to be up (up to 60s)
    for _ in range(12):
        if _ollama_reachable(base):
            break
        logger.info("Waiting for Ollama to start...")
        time.sleep(5)
    else:
        logger.error("Ollama did not start in time.")
        return

    # Check if already present
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=5) as r:
            data = json.loads(r.read())
            existing = [m["name"] for m in data.get("models", [])]
            if any(model_tag in e or e in model_tag for e in existing):
                logger.info(f"Model '{model_tag}' already in Ollama — skipping pull.")
                return
    except Exception:
        pass

    logger.info(f"Pulling Ollama model: {model_tag} (this may take a while...)")
    try:
        req = urllib.request.Request(
            f"{base}/api/pull",
            data=json.dumps({"name": model_tag, "stream": False}).encode(),
            method="POST",
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=1800) as r:
            logger.info(f"Successfully pulled: {model_tag}")
    except Exception as e:
        logger.error(f"Failed to pull '{model_tag}': {e}")


def pull_nemotron_via_gguf():
    """
    Downloads Nemotron Nano 12B V2 GGUF from HuggingFace (bartowski) and
    imports it into Ollama via a custom Modelfile.
    Only runs when 14GB+ VRAM is detected (RTX 5060 Ti, RTX 4080, etc.).
    GGUF is saved to /data/ (Docker volume) so it survives container restarts.
    """
    if not NEMOTRON_GGUF_URL:
        logger.error(
            "Nemotron GGUF download was requested, but NEMOTRON_GGUF_URL is not configured."
        )
        return

    base = resolve_ollama_base()

    # Skip if already registered in Ollama
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=5) as r:
            data = json.loads(r.read())
            existing = [m["name"] for m in data.get("models", [])]
            if any(NEMOTRON_OLLAMA_TAG in e for e in existing):
                logger.info(f"Nemotron already in Ollama — skipping GGUF setup.")
                return
    except Exception:
        pass

    # Download GGUF if not already present and complete on disk
    file_exists_and_complete = False
    if os.path.exists(NEMOTRON_GGUF_PATH):
        try:
            current_size = os.path.getsize(NEMOTRON_GGUF_PATH)
            if current_size >= 11540000000:
                file_exists_and_complete = True
            else:
                logger.warning(f"Nemotron GGUF on disk is incomplete ({current_size} bytes). Deleting and redownloading...")
                os.remove(NEMOTRON_GGUF_PATH)
        except Exception as e:
            logger.error(f"Error checking GGUF file: {e}")

    if not file_exists_and_complete:
        logger.info(f"Downloading Nemotron Nano 12B V2 GGUF (~10.8 GB) from HuggingFace...")
        logger.info(f"URL: {NEMOTRON_GGUF_URL}")
        logger.info(f"Saving to: {NEMOTRON_GGUF_PATH}")
        try:
            os.makedirs(os.path.dirname(NEMOTRON_GGUF_PATH), exist_ok=True)
            def progress_hook(count, block_size, total_size):
                if total_size > 0:
                    pct = count * block_size * 100 / total_size
                    downloaded_gb = count * block_size / (1024**3)
                    total_gb = total_size / (1024**3)
                    if count % 500 == 0:
                        logger.info(f"  Nemotron GGUF download: {pct:.1f}% ({downloaded_gb:.2f} / {total_gb:.2f} GB)")
            urllib.request.urlretrieve(NEMOTRON_GGUF_URL, NEMOTRON_GGUF_PATH, reporthook=progress_hook)
            logger.info(f"✓ Nemotron GGUF downloaded successfully: {NEMOTRON_GGUF_PATH}")
        except Exception as e:
            logger.error(f"Failed to download Nemotron GGUF: {e}")
            return
    else:
        logger.info(f"Nemotron GGUF already on disk and complete: {NEMOTRON_GGUF_PATH} — skipping download.")

    # Create Ollama Modelfile
    modelfile_path = os.path.join(DATA_DIR, "nemotron-nano-12b-v2.Modelfile")
    modelfile_content = f"""FROM {NEMOTRON_GGUF_PATH}
PARAMETER temperature 0.7
PARAMETER num_ctx 32768
PARAMETER stop "<|end_of_text|>"
PARAMETER stop "<|eot_id|>"
SYSTEM "You are SMARAN AI, a helpful and intelligent assistant for Smaran Robotics Pvt. Ltd. You are accurate, factual, and excellent at analyzing business data."
"""
    try:
        with open(modelfile_path, "w") as f:
            f.write(modelfile_content)
        logger.info(f"Modelfile written: {modelfile_path}")
    except Exception as e:
        logger.error(f"Failed to write Modelfile: {e}")
        return

    # Register model in Ollama via `ollama create`
    logger.info(f"Registering Nemotron in Ollama as '{NEMOTRON_OLLAMA_TAG}'...")
    try:
        result = subprocess.run(
            ["ollama", "create", NEMOTRON_OLLAMA_TAG, "-f", modelfile_path],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            logger.info(f"✓ Nemotron Nano 12B V2 registered in Ollama as '{NEMOTRON_OLLAMA_TAG}'")
        else:
            logger.error(f"ollama create failed: {result.stderr}")
    except Exception as e:
        logger.error(f"Failed to register Nemotron in Ollama: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Main Entry
# ─────────────────────────────────────────────────────────────────────────────
def main():
    import sys
    import subprocess

    # If --pull-only is passed, pull only the selected recommendation.
    if len(sys.argv) > 1 and sys.argv[1] == "--pull-only":
        # Wait a few seconds to let the FastAPI server start up first
        time.sleep(3)
        logger.info("Background pull process started.")
        logger.info("Phase 1 — Preserving user-installed models.")

        logger.info("Phase 2 — Pulling only the compatible selected model...")
        selected_model = ""
        try:
            with open(CONFIG_PATH, encoding="utf-8") as config_file:
                selected_model = str(json.load(config_file).get("model_id", "")).strip()
        except Exception as exc:
            logger.warning(f"Could not read selected model configuration: {exc}")
        if selected_model:
            pull_ollama_model(selected_model)
        else:
            logger.warning("No compatible local model was selected; automatic model pull skipped.")

        logger.info("Phase 3 — Ensuring embedding model is present...")
        pull_ollama_model("nomic-embed-text")
        logger.info("Background model pulling complete!")
        return

    logger.info("=" * 70)
    logger.info("SMARAN.AI — Intelligent Model Selection Bootstrapper v3.0")
    logger.info("Capacity-aware recommendation | Runtime readiness verified separately")
    logger.info(f"Runtime ID: {socket.gethostname()}")
    logger.info("=" * 70)

    # 1. Full hardware detection
    cpu = detect_cpu()
    ram = detect_ram()
    gpus, driver = detect_gpu()
    best_gpu = max(gpus, key=lambda g: g.get("vram_gb", 0)) if gpus else {"name": "No GPU", "vram_gb": 0.0, "index": 0, "vendor": "none"}

    # 2. Select a capacity-compatible recommendation. An explicitly configured
    # runtime always wins so the bootstrapper cannot replace the installer's
    # verified starter (or a model selected by the user) with another download.
    profile = select_best_model(
        vram_gb   = best_gpu.get("vram_gb", 0.0),
        ram_gb    = ram["ram_total_gb"],
        cpu_cores = cpu["cpu_cores_logical"]
    )
    configured_model = os.getenv("ACTIVE_MODEL", "").strip()
    configured_engine = os.getenv("INFERENCE_ENGINE", "").strip().lower()
    if configured_model:
        if configured_engine not in {"ollama", "vllm"}:
            configured_engine = "ollama" if os.getenv("OLLAMA_URL", "").strip() else profile.get("engine", "ollama")
        configured_url = (
            os.getenv("VLLM_URL", "http://127.0.0.1:8000/v1").strip()
            if configured_engine == "vllm"
            else os.getenv("OLLAMA_URL", resolve_ollama_base()).strip()
        )
        configured_context = int(os.getenv("MAX_MODEL_LEN", str(profile.get("max_model_len") or 4096)))
        profile = {
            **profile,
            "engine": configured_engine,
            "model_id": configured_model,
            "display_name": configured_model,
            "api_url": configured_url,
            "ctx_window": configured_context,
            "max_model_len": configured_context,
            "reasoning": False,
            "configured_source": "environment",
        }

    # 3. Write config — backend + utils.py will both read this at runtime
    os.makedirs(DATA_DIR, exist_ok=True)
    config = {
        # Hardware facts
        "cpu":               cpu,
        "ram":               ram,
        "gpus":              gpus,
        "gpu":               best_gpu,
        "driver_version":    driver,
        # Selected inference profile
        "inference":         profile,
        # Flat shortcuts for telemetry (utils.py Task Manager)
        "host_cpu_cores":    cpu["cpu_cores_logical"],
        "host_cpu_name":     cpu["cpu_name"],
        "host_ram_total_gb": ram["ram_total_gb"],
        "host_gpu_name":     best_gpu.get("name", ""),
        "host_gpu_vram_gb":  best_gpu.get("vram_gb", 0.0),
        "host_gpu_count":    len(gpus),
        "host_gpus":         gpus,
        # Engine routing (backend/config.py + main.py reads these)
        "engine":            profile["engine"],
        "model_id":          profile["model_id"],
        "display_name":      profile["display_name"],
        "api_url":           profile["api_url"],
        "max_model_len":     profile["max_model_len"],
        "ctx_window":        profile["ctx_window"],
        "reasoning_model":   profile["reasoning"],
    }
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

    # 4. Print summary
    logger.info("")
    logger.info("┌─ SOURCE-LABELLED HARDWARE DETECTED ─────────────────────────┐")
    logger.info(f"│  CPU   : {cpu['cpu_name']} ({cpu['cpu_cores_logical']} cores)")
    logger.info(f"│  RAM   : {ram['ram_total_gb']} GB system memory")
    for g in gpus:
        logger.info(f"│  GPU {g.get('index', 0)} : {g.get('name', 'Unknown')} | VRAM: {g.get('vram_gb', 0)} GB | Vendor: {g.get('vendor', 'unknown')}")
    logger.info("├─ RECOMMENDED LOCAL MODEL (NOT ACTIVE UNTIL SERVED) ─────────┤")
    logger.info(f"│  Engine: {profile['engine'].upper()}")
    logger.info(f"│  Model : {profile['model_id']}")
    logger.info(f"│  Name  : {profile['display_name']}")
    logger.info(f"│  CTX   : {profile['ctx_window']:,} tokens")
    logger.info(f"│  Think : {'✓ YES — Strong Reasoning' if profile['reasoning'] else '✗ Standard Instruct'}")
    logger.info("├─ COMPATIBILITY ─────────────────────────────────────────────┤")
    if profile["model_id"]:
        execution_mode = "GPU VRAM" if best_gpu.get("vram_gb", 0) > 0 else "CPU/system RAM"
        logger.info(f"│  Compatible by measured capacity via {execution_mode}; runtime readiness is checked separately.")
    else:
        logger.info("│  No compatible preferred local model was selected.          │")
    logger.info("└─────────────────────────────────────────────────────────────┘")
    logger.info("")

    # 5. Downloads are opt-in here. The interactive installers already pull and
    # verify their starter model with visible progress. Silently downloading a
    # second model at every container start is both surprising and expensive.
    auto_pull = os.getenv("SMARAN_AUTO_PULL_MODEL", "").strip().lower() in {"1", "true", "yes"}
    if not auto_pull:
        logger.info("Automatic background model download is disabled. Set SMARAN_AUTO_PULL_MODEL=1 to opt in.")
        logger.info("Bootstrap configuration complete. Handing over control to FastAPI server...")
        return

    logger.info("Preparing opt-in background model downloader...")
    if not profile["model_id"]:
        logger.warning("Downloader not started because no compatible local model was selected.")
        return
    try:
        log_file_path = os.path.join(DATA_DIR, "downloader.log")
        # Open in append mode with buffering disabled (unbuffered) so lines write immediately
        log_file = open(log_file_path, "a", encoding="utf-8", buffering=1)
        subprocess.Popen(
            [sys.executable, __file__, "--pull-only"],
            stdout=log_file,
            stderr=log_file,
            start_new_session=True
        )
        logger.info(f"Background model downloader successfully spawned. Logs at {log_file_path}")
    except Exception as e:
        logger.error(f"Failed to spawn background model downloader: {e}")

    logger.info("Bootstrap configuration complete. Handing over control to FastAPI server...")


if __name__ == "__main__":
    main()
