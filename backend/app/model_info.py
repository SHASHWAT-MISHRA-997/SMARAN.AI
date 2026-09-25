"""What is known about a model, for the details panel under each model.

LM Studio shows, for every model: downloads, likes, when it was updated, the
parameter count, architecture, format, capabilities, the download options with
their sizes (and whether they will fit), and the model card. The catalogue here
showed a name and a line of text. This gathers the real figures from where
they live, and invents none:

  Hugging Face  /api/models/{repo}   - downloads, likes, dates, GGUF files
                                      with sizes, architecture, context
                /{repo}/raw/main/README.md - the model card
  Ollama        /api/show, /api/tags - what an installed model actually is
  models.dev    /api.json            - cloud models: context, prices,
                                      modalities, knowledge cut-off

Only these fixed hosts are ever contacted, and the names that go into the
URLs are checked first, so nothing a caller sends can point a request
somewhere else.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.companion import get_current_user_dep
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/models/info", tags=["model-info"])

_HF_REPO = re.compile(r"^[A-Za-z0-9][\w.-]{0,95}/[A-Za-z0-9][\w.-]{0,95}$")
_OLLAMA_NAME = re.compile(r"^[A-Za-z0-9][\w.:/-]{0,159}$")
_CLOUD_ID = re.compile(r"^[\w.:/@+-]{1,200}$")
_QUANT = re.compile(r"(?i)(?:^|[-_.])((?:I?Q\d(?:_[A-Z0-9]+)*)|F16|BF16|F32)(?=[-_.]|$)")

README_LIMIT = 40_000
_TTL = 6 * 3600
MODELS_DEV_TTL = 24 * 3600

_cache: Dict[str, tuple] = {}

# SMARAN's provider ids where models.dev names them differently.
_MODELS_DEV_PROVIDER = {"gemini": "google", "together": "togetherai"}


def _cached(key: str):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    return None


def _store(key: str, value):
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.time(), value)
    return value


def _memory_gb() -> Dict[str, Optional[float]]:
    try:
        from app.utils import get_system_telemetry

        t = get_system_telemetry(db=None)
        vram = t.get("gpu_vram_total")
        ram = t.get("memory_total_gb")
        return {"vram_gb": float(vram) if vram is not None else None,
                "ram_gb": float(ram) if ram is not None else None}
    except Exception:
        return {"vram_gb": None, "ram_gb": None}


def fit(size_bytes: Optional[int], vram_gb: Optional[float], ram_gb: Optional[float]) -> Dict[str, str]:
    """Will a file of this size run here? Measured memory against the file.

    The weights plus working memory for the context come to roughly 1.2x the
    file. All on the card is fast; spilling into system memory works but is
    slower; more than both is not going to load.
    """
    if not size_bytes:
        return {"status": "unknown", "label": "Size not published"}
    need = size_bytes / 1e9 * 1.2
    if vram_gb and need <= vram_gb:
        return {"status": "fits", "label": "Fits on your GPU"}
    if (vram_gb or 0) + (ram_gb or 0) * 0.6 >= need and (vram_gb or ram_gb):
        return {"status": "partial", "label": "Partly on GPU - runs, slower"}
    if vram_gb is None and ram_gb is None:
        return {"status": "unknown", "label": "Memory not measured"}
    return {"status": "too_large", "label": "Likely too large"}


def quant_of(filename: str) -> str:
    stem = filename.rsplit("/", 1)[-1]
    if stem.lower().endswith(".gguf"):
        stem = stem[:-5]
    found = _QUANT.findall(stem)
    return found[-1].upper() if found else ""


def strip_front_matter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4:]
    return text.strip()


def capabilities_from_hf(data: Dict[str, Any]) -> List[str]:
    tags = {str(t).lower() for t in data.get("tags") or []}
    pipeline = str(data.get("pipeline_tag") or "")
    template = ""
    gguf = data.get("gguf") or {}
    if isinstance(gguf.get("chat_template"), str):
        template = gguf["chat_template"]
    config = data.get("config") or {}
    tok = config.get("tokenizer_config") or {}
    if isinstance(tok.get("chat_template"), str):
        template += tok["chat_template"]
    caps = []
    if pipeline in ("image-text-to-text", "visual-question-answering", "image-to-text") or \
            tags & {"vision", "multimodal", "image-text-to-text", "vlm"}:
        caps.append("Vision")
    if "tools" in template or tags & {"tool-use", "function-calling", "tool_calling"}:
        caps.append("Tool Use")
    if "<think>" in template or "enable_thinking" in template or tags & {"reasoning", "thinking"}:
        caps.append("Reasoning")
    if pipeline in ("automatic-speech-recognition",):
        caps.append("Speech to text")
    if pipeline in ("text-to-speech",):
        caps.append("Speech")
    if pipeline in ("feature-extraction", "sentence-similarity"):
        caps.append("Embeddings")
    return caps


def _param_count(data: Dict[str, Any]) -> Optional[int]:
    safetensors = data.get("safetensors") or {}
    if isinstance(safetensors.get("total"), int):
        return safetensors["total"]
    gguf = data.get("gguf") or {}
    if isinstance(gguf.get("total"), int):
        return gguf["total"]
    return None


def human_params(count: Optional[int]) -> str:
    if not count:
        return ""
    if count >= 1e9:
        return f"{count / 1e9:.1f}B".replace(".0B", "B")
    return f"{count / 1e6:.0f}M"


_WEIGHT_SUFFIX = re.compile(r"(?i)[-_](awq|gptq(?:-int[48])?|int[48]|fp8|bnb-4bit|4bit|8bit|mlx(?:-\w+)?|gguf)$")


def gguf_base_name(repo: str) -> str:
    """The model's own name, without the packaging a repository adds to it."""
    name = repo.split("/", 1)[-1]
    while True:
        stripped = _WEIGHT_SUFFIX.sub("", name)
        if stripped == name:
            return name
        name = stripped


def pick_gguf_repo(repo: str, candidates: List[Dict[str, Any]]) -> Optional[str]:
    """The GGUF build of the same model: the author's own first, then the most used.

    Matched on the exact name, so Qwen3-4B never picks Qwen3.5-4B or a
    fine-tune that happens to share a prefix.
    """
    base = gguf_base_name(repo).lower().replace("_", "-")
    author = repo.split("/", 1)[0].lower()
    matches = []
    for c in candidates:
        cid = str(c.get("id") or "")
        if "/" not in cid:
            continue
        owner, name = cid.split("/", 1)
        name = name.lower().replace("_", "-")
        if name == f"{base}-gguf" or name.endswith(f"-{base}-gguf"):
            matches.append((owner.lower() != author, -(c.get("downloads") or 0), cid))
    return sorted(matches)[0][2] if matches else None


def shape_hf(data: Dict[str, Any], readme: str, memory: Dict[str, Optional[float]],
             gguf_build: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    repo = data.get("id") or data.get("modelId")
    # Download options come from the GGUF build when this repository has none.
    source = gguf_build or data
    source_repo = source.get("id") or repo
    siblings = source.get("siblings") or []
    files = []
    for s in siblings:
        name = s.get("rfilename") or ""
        if not name.lower().endswith(".gguf") or "mmproj" in name.lower():
            continue
        # Split files (-00001-of-00003.gguf) are one download Ollama cannot take by tag.
        if re.search(r"-\d{5}-of-\d{5}\.gguf$", name):
            continue
        quant = quant_of(name)
        size = s.get("size") or (s.get("lfs") or {}).get("size")
        files.append({
            "file": name,
            "quant": quant,
            "size_bytes": size,
            "fit": fit(size, memory["vram_gb"], memory["ram_gb"]),
            # Ollama pulls GGUF straight from Hugging Face by this name.
            "ollama_name": f"hf.co/{source_repo}:{quant}" if quant else None,
        })
    files.sort(key=lambda f: f["size_bytes"] or 0)
    names = [s.get("rfilename", "") for s in (data.get("siblings") or [])]
    formats = []
    if any(n.lower().endswith(".gguf") for n in names):
        formats.append("GGUF")
    if any(n.endswith(".safetensors") for n in names):
        formats.append("Safetensors")
    if "mlx" in {str(t).lower() for t in data.get("tags") or []}:
        formats.append("MLX")
    if any(n.endswith(".onnx") for n in names):
        formats.append("ONNX")
    gguf = data.get("gguf") or {}
    card = data.get("cardData") or {}
    config = data.get("config") or {}
    arch = gguf.get("architecture") or config.get("model_type") or ""
    license_ = card.get("license") or next(
        (t.split(":", 1)[1] for t in data.get("tags") or [] if str(t).startswith("license:")), "")
    return {
        "source": "huggingface",
        "id": repo,
        "author": data.get("author") or (repo or "").split("/")[0],
        "url": f"https://huggingface.co/{repo}",
        "downloads": data.get("downloads"),
        "likes": data.get("likes"),
        "last_modified": data.get("lastModified"),
        "created": data.get("createdAt"),
        "pipeline": data.get("pipeline_tag"),
        "license": license_,
        "gated": bool(data.get("gated")),
        "params": human_params(_param_count(data)),
        "architecture": arch,
        "context_length": gguf.get("context_length"),
        "formats": formats,
        "capabilities": capabilities_from_hf(data),
        "base_model": card.get("base_model") if isinstance(card.get("base_model"), str) else
        (card.get("base_model") or [None])[0] if isinstance(card.get("base_model"), list) else None,
        "downloads_options": files,
        "gguf_repo": source_repo if gguf_build else (repo if files else None),
        "memory": memory,
        "readme": readme[:README_LIMIT],
        "readme_truncated": len(readme) > README_LIMIT,
    }


@router.get("/hf")
async def huggingface(repo: str = Query(...), _user=Depends(get_current_user_dep)):
    repo = repo.strip()
    if not _HF_REPO.match(repo) or ".." in repo:
        raise HTTPException(status_code=400, detail="Give a Hugging Face repository as owner/name.")
    key = f"hf:{repo}"
    cached = _cached(key)
    if cached:
        return cached
    headers = {"User-Agent": "SMARAN.AI"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0), headers=headers,
                                 follow_redirects=True) as client:
        try:
            res = await client.get(f"https://huggingface.co/api/models/{repo}", params={"blobs": "true"})
        except httpx.HTTPError:
            raise HTTPException(status_code=503, detail="Hugging Face could not be reached.")
        if res.status_code == 404 or res.status_code == 401:
            raise HTTPException(status_code=404, detail=f"Hugging Face has no public model called {repo}.")
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Hugging Face answered {res.status_code}.")
        data = res.json()
        gguf = None
        has_gguf = any(str(x.get("rfilename", "")).lower().endswith(".gguf") for x in data.get("siblings") or [])
        if not has_gguf:
            try:
                found = await client.get("https://huggingface.co/api/models", params={
                    "search": gguf_base_name(repo), "filter": "gguf", "sort": "downloads", "limit": "30"})
                other = pick_gguf_repo(repo, found.json() if found.status_code == 200 else [])
                if other and _HF_REPO.match(other):
                    got = await client.get(f"https://huggingface.co/api/models/{other}", params={"blobs": "true"})
                    if got.status_code == 200:
                        gguf = got.json()
            except (httpx.HTTPError, ValueError):
                pass
        readme = ""
        try:
            card = await client.get(f"https://huggingface.co/{repo}/raw/main/README.md")
            if card.status_code == 200 and len(card.content) < 2_000_000:
                readme = strip_front_matter(card.text)
        except httpx.HTTPError:
            pass
    return _store(key, shape_hf(data, readme, _memory_gb(), gguf))


def shape_ollama(show: Dict[str, Any], tag: Optional[Dict[str, Any]], name: str) -> Dict[str, Any]:
    details = show.get("details") or {}
    info = show.get("model_info") or {}
    context = next((v for k, v in info.items() if k.endswith(".context_length")), None)
    params = next((v for k, v in info.items() if k == "general.parameter_count"), None)
    caps_map = {"completion": "Chat", "vision": "Vision", "tools": "Tool Use", "thinking": "Reasoning",
                "embedding": "Embeddings", "insert": "Fill-in-the-middle"}
    license_text = str(show.get("license") or "").strip()
    return {
        "source": "ollama",
        "id": name,
        "params": details.get("parameter_size") or human_params(params),
        "architecture": details.get("family") or "",
        "families": details.get("families") or [],
        "format": (details.get("format") or "").upper(),
        "quantization": details.get("quantization_level") or "",
        "context_length": context,
        "capabilities": [caps_map.get(c, c) for c in show.get("capabilities") or []],
        "license": license_text.splitlines()[0][:120] if license_text else "",
        "size_bytes": (tag or {}).get("size"),
        "modified": (tag or {}).get("modified_at") or show.get("modified_at"),
        "url": f"https://ollama.com/library/{name.split(':')[0]}" if "/" not in name else None,
    }


@router.get("/ollama")
async def ollama(name: str = Query(...), _user=Depends(get_current_user_dep)):
    name = name.strip()
    if not _OLLAMA_NAME.match(name) or ".." in name:
        raise HTTPException(status_code=400, detail="Give an installed model name, for example llama3.2:3b.")
    base = settings.OLLAMA_URL.rstrip("/")
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=3.0)) as client:
        try:
            show = await client.post(f"{base}/api/show", json={"model": name})
            tags = await client.get(f"{base}/api/tags")
        except httpx.HTTPError:
            raise HTTPException(status_code=503, detail="The local model server is not answering. Start Ollama.")
    if show.status_code == 404:
        raise HTTPException(status_code=404, detail=f"{name} is not installed.")
    if show.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Ollama answered {show.status_code}.")
    listed = (tags.json() if tags.status_code == 200 else {}).get("models") or []
    tag = next((m for m in listed if m.get("name") == name or m.get("model") == name), None)
    return shape_ollama(show.json(), tag, name)


def _models_dev_path() -> str:
    return os.path.join(settings.DATA_DIR, "cache", "models_dev.json")


async def models_dev() -> Dict[str, Any]:
    cached = _cache.get("models.dev")
    if cached and time.time() - cached[0] < MODELS_DEV_TTL:
        return cached[1]
    path = _models_dev_path()
    try:
        if time.time() - os.path.getmtime(path) < MODELS_DEV_TTL:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            _cache["models.dev"] = (time.time(), data)
            return data
    except (OSError, ValueError):
        pass
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=6.0)) as client:
            res = await client.get("https://models.dev/api.json")
        res.raise_for_status()
        data = res.json()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, path)
    except Exception as exc:
        logger.info("models.dev not refreshed: %s", exc)
        try:  # an old copy beats nothing
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            raise HTTPException(status_code=503, detail="The cloud model directory (models.dev) could not be reached.")
    _cache["models.dev"] = (time.time(), data)
    return data


def find_cloud(directory: Dict[str, Any], provider: str, model: str) -> Optional[Dict[str, Any]]:
    """The models.dev entry for a provider's model id, tolerating prefixes.

    Providers list the same model as "models/gemini-2.5-pro", "gemini-2.5-pro"
    or "google/gemini-2.5-pro" (OpenRouter). Tried on the provider first, then
    anywhere, so a provider models.dev does not list still gets the model's
    facts from one that does.
    """
    wanted = {model, model.split("/", 1)[-1], model.removeprefix("models/")}
    home = directory.get(_MODELS_DEV_PROVIDER.get(provider, provider))
    order = ([home] if home else []) + [p for p in directory.values() if p is not home]
    for entry in order:
        models = (entry or {}).get("models") or {}
        for candidate in wanted:
            if candidate in models:
                found = dict(models[candidate])
                found["_provider"] = {"id": entry.get("id"), "name": entry.get("name"), "doc": entry.get("doc")}
                return found
    return None


def shape_cloud(entry: Dict[str, Any], provider: str, model: str) -> Dict[str, Any]:
    caps = []
    modalities = entry.get("modalities") or {}
    inputs = modalities.get("input") or []
    if "image" in inputs or entry.get("attachment"):
        caps.append("Vision")
    if entry.get("tool_call"):
        caps.append("Tool Use")
    if entry.get("reasoning"):
        caps.append("Reasoning")
    if "audio" in inputs:
        caps.append("Audio in")
    if "pdf" in inputs:
        caps.append("PDF")
    cost = entry.get("cost") or {}
    limit = entry.get("limit") or {}
    return {
        "source": "cloud",
        "provider": provider,
        "id": model,
        "name": entry.get("name") or model,
        "description": entry.get("description") or "",
        "family": entry.get("family") or "",
        "capabilities": caps,
        "modalities": {"input": inputs, "output": modalities.get("output") or []},
        "open_weights": entry.get("open_weights"),
        "context_length": limit.get("context") or None,
        "max_output": limit.get("output") or None,
        "price_input_per_mtok": cost.get("input"),
        "price_output_per_mtok": cost.get("output"),
        "price_cache_read_per_mtok": cost.get("cache_read"),
        "knowledge": entry.get("knowledge"),
        "release_date": entry.get("release_date"),
        "last_updated": entry.get("last_updated"),
        "listed_by": entry.get("_provider"),
        "source_url": "https://models.dev",
    }


@router.get("/cloud")
async def cloud(provider: str = Query(...), model: str = Query(...), _user=Depends(get_current_user_dep)):
    provider, model = provider.strip().lower(), model.strip()
    if not re.fullmatch(r"[a-z0-9-]{1,40}", provider) or not _CLOUD_ID.match(model):
        raise HTTPException(status_code=400, detail="Unknown provider or model id.")
    entry = find_cloud(await models_dev(), provider, model)
    if not entry:
        raise HTTPException(status_code=404, detail=f"No published details for {model} yet.")
    return shape_cloud(entry, provider, model)
