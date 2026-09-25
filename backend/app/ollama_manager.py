"""Ollama, managed from the app: what is installed, what exists, and removing it.

Everything `ollama list`, `ollama ps`, `ollama rm` and browsing ollama.com
would give, without a terminal. Installing and updating go through the
existing /api/models/pull (an update is a pull of the same name: Ollama
fetches only the layers that changed).

  GET    /api/ollama/installed            every installed model, with sizes
                                          and which are loaded right now
  DELETE /api/ollama/installed?name=      remove one permanently
  GET    /api/ollama/library?q=&sort=     the models ollama.com publishes
  GET    /api/ollama/library/{name}/tags  each size's exact download, and
                                          whether it fits this machine

The library comes from ollama.com's own pages (it publishes no JSON list);
the sizes from its registry's manifests, which are the bytes a pull fetches.
Only those two hosts and the local Ollama are ever contacted.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.companion import get_current_user_dep
from app.config import settings
from app.model_info import _memory_gb, fit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ollama", tags=["ollama"])

_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
_INSTALLED = re.compile(r"^[A-Za-z0-9][\w.:/-]{0,159}$")
_SIZE_TAG = re.compile(r"^(?:e?\d+(?:\.\d+)?[bm]|[a-z0-9]+(?:x\d+b)?)$")
_TTL = 6 * 3600
_cache: Dict[str, tuple] = {}


def _base() -> str:
    return settings.OLLAMA_URL.rstrip("/")


async def _ollama(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=3.0)) as client:
            return await client.request(method, f"{_base()}{path}", **kwargs)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="The local model server is not answering. Start Ollama and try again.")


@router.get("/installed")
async def installed(_user=Depends(get_current_user_dep)):
    tags = await _ollama("GET", "/api/tags")
    if tags.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Ollama answered {tags.status_code}.")
    running = {}
    try:
        ps = await _ollama("GET", "/api/ps")
        if ps.status_code == 200:
            running = {m.get("name"): m for m in ps.json().get("models") or []}
    except HTTPException:
        pass
    models = []
    for m in tags.json().get("models") or []:
        details = m.get("details") or {}
        name = m.get("name") or m.get("model")
        live = running.get(name)
        models.append({
            "name": name,
            "size_bytes": m.get("size"),
            "modified": m.get("modified_at"),
            "digest": (m.get("digest") or "")[:12],
            "params": details.get("parameter_size") or "",
            "family": details.get("family") or "",
            "quantization": details.get("quantization_level") or "",
            "format": (details.get("format") or "").upper(),
            # Cloud models (name:cloud) run on ollama.com, not on this disk.
            "remote": bool(m.get("remote_host")) or str(name).endswith(":cloud") or "-cloud" in str(name),
            "loaded": bool(live),
            "vram_bytes": (live or {}).get("size_vram"),
        })
    models.sort(key=lambda x: x["name"])
    return {"models": models, "memory": _memory_gb(),
            "total_bytes": sum(m["size_bytes"] or 0 for m in models if not m["remote"])}


@router.delete("/installed")
async def remove(name: str = Query(...), _user=Depends(get_current_user_dep)):
    """Delete a model for good, the way `ollama rm` does, and say what it freed."""
    name = name.strip()
    if not _INSTALLED.match(name) or ".." in name:
        raise HTTPException(status_code=400, detail="Give an installed model name.")
    before = await _ollama("GET", "/api/tags")
    listed = (before.json().get("models") or []) if before.status_code == 200 else []
    entry = next((m for m in listed if m.get("name") == name or m.get("model") == name), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"{name} is not installed.")
    # Unload it first; Windows will not delete a file a running model holds.
    try:
        await _ollama("POST", "/api/generate", json={"model": name, "keep_alive": 0})
    except HTTPException:
        pass
    res = await _ollama("DELETE", "/api/delete", json={"model": name})
    if res.status_code not in (200, 204):
        detail = ""
        try:
            detail = res.json().get("error", "")
        except ValueError:
            pass
        raise HTTPException(status_code=502, detail=f"Ollama did not delete {name}: {detail or res.status_code}")
    return {"deleted": name, "freed_bytes": entry.get("size") or 0}


def _spans(block: str, pattern: str) -> List[str]:
    return [html.unescape(x).strip() for x in re.findall(pattern, block)]


def parse_library(page: str) -> List[Dict[str, Any]]:
    """Each model on an ollama.com listing page (library or search)."""
    models = []
    for item in re.findall(r'<li[^>]*>\s*<a href="/library/([a-z0-9._-]+)"(.*?)</li>', page, re.S):
        name, block = item
        desc = re.search(r'<p class="max-w-lg[^"]*"[^>]*>(.*?)</p>', block, re.S)
        caps = _spans(block, r'<span[^>]*bg-indigo-50[^>]*>([^<]+)</span>')
        cloud = _spans(block, r'<span[^>]*bg-cyan-50[^>]*>([^<]+)</span>')
        sizes = _spans(block, r'<span[^>]*bg-\[#ddf4ff\][^>]*>([^<]+)</span>')
        pulls = re.search(r'<span[^>]*>([\d.,]+[KMB]?)</span>\s*<span[^>]*>(?:&nbsp;|\s)*Pulls', block)
        tags = re.search(r'<span[^>]*>(\d+)</span>\s*<span[^>]*>(?:&nbsp;|\s)*Tags', block)
        updated = re.findall(r'<span[^>]*>([^<]*ago)</span>', block)
        models.append({
            "name": name,
            "description": html.unescape(re.sub(r"<[^>]+>", "", desc.group(1))).strip() if desc else "",
            "capabilities": caps + [c for c in cloud if c not in caps],
            "sizes": sizes,
            "pulls": pulls.group(1) if pulls else "",
            "tags": int(tags.group(1)) if tags else None,
            "updated": updated[-1].strip() if updated else "",
        })
    return models


def approx_q4_gb(size_tag: str) -> Optional[float]:
    """About what the default (Q4) download of an `8b`-style size weighs.

    Measured against the registry: qwen3:8b is 5.2 GB, llama3.2:3b 2.0 GB,
    gemma3:12b 8.1 GB - roughly 0.6 GB per billion parameters plus a little.
    Only for sorting and filtering the list; the exact figure comes from the
    manifest once a model is opened.
    """
    m = re.fullmatch(r"e?(\d+(?:\.\d+)?)([bm])", size_tag.lower())
    if not m:
        m2 = re.fullmatch(r"(\d+)x(\d+(?:\.\d+)?)b", size_tag.lower())
        if not m2:
            return None
        return round(int(m2.group(1)) * float(m2.group(2)) * 0.6 + 0.4, 1)
    billions = float(m.group(1)) / (1000 if m.group(2) == "m" else 1)
    return round(billions * 0.6 + 0.4, 1)


async def _listing(url: str, params: Dict[str, str], key: str) -> List[Dict[str, Any]]:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=6.0), follow_redirects=True,
                                     headers={"User-Agent": "SMARAN.AI"}) as client:
            res = await client.get(url, params=params)
    except httpx.HTTPError:
        if hit:
            return hit[1]
        raise HTTPException(status_code=503, detail="ollama.com could not be reached.")
    if res.status_code != 200 or not str(res.url).startswith("https://ollama.com/"):
        if hit:
            return hit[1]
        raise HTTPException(status_code=502, detail=f"ollama.com answered {res.status_code}.")
    models = parse_library(res.text)
    _cache[key] = (time.time(), models)
    return models


@router.get("/library")
async def library(q: str = Query("", max_length=80), sort: str = Query("popular"),
                  _user=Depends(get_current_user_dep)):
    q = q.strip()
    if sort not in ("popular", "newest"):
        sort = "popular"
    if q and not re.fullmatch(r"[\w .:+-]{1,80}", q):
        raise HTTPException(status_code=400, detail="Search with letters, numbers and dashes.")
    models = await _listing("https://ollama.com/library", {"sort": sort}, f"lib:{sort}")
    if q:
        words = q.lower().split()
        local = [m for m in models if all(w in (m["name"] + " " + m["description"]).lower() for w in words)]
        # ollama.com's own search finds models its front page does not list.
        try:
            extra = await _listing("https://ollama.com/search", {"q": q}, f"search:{q.lower()}")
        except HTTPException:
            extra = []
        seen = {m["name"] for m in local}
        models = local + [m for m in extra if m["name"] not in seen]
    models = [dict(m) for m in models]
    memory = _memory_gb()
    for m in models:
        m["approx"] = [{"size": s, "gb": approx_q4_gb(s),
                        "fit": fit(int(approx_q4_gb(s) * 1e9) if approx_q4_gb(s) else None,
                                   memory["vram_gb"], memory["ram_gb"])["status"]}
                       for s in m["sizes"]]
    return {"models": models, "memory": memory, "source": "https://ollama.com/library"}


async def _manifest_size(client: httpx.AsyncClient, name: str, tag: str) -> Optional[int]:
    res = await client.get(f"https://registry.ollama.ai/v2/library/{name}/manifests/{tag}",
                           headers={"Accept": "application/vnd.docker.distribution.manifest.v2+json"})
    if res.status_code != 200:
        return None
    layers = res.json().get("layers") or []
    return sum(int(layer.get("size") or 0) for layer in layers) or None


@router.get("/library/{name}/tags")
async def library_tags(name: str, _user=Depends(get_current_user_dep)):
    """The download each published size really is, and whether it fits here."""
    name = name.strip().lower()
    if not _NAME.match(name):
        raise HTTPException(status_code=400, detail="Unknown model name.")
    key = f"tags:{name}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        sized = hit[1]
    else:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0),
                                     headers={"User-Agent": "SMARAN.AI"}) as client:
            try:
                page = await client.get(f"https://ollama.com/library/{name}")
            except httpx.HTTPError:
                raise HTTPException(status_code=503, detail="ollama.com could not be reached.")
            if page.status_code == 404:
                raise HTTPException(status_code=404, detail=f"ollama.com has no model called {name}.")
            listed = parse_library(f'<li><a href="/library/{name}"' + page.text + "</li>")
            sizes = [s for s in (listed[0]["sizes"] if listed else []) if _SIZE_TAG.match(s)] or ["latest"]
            sizes = sizes[:16]
            results = await asyncio.gather(*[_manifest_size(client, name, s) for s in sizes],
                                           return_exceptions=True)
        sized = [{"tag": f"{name}:{s}", "size": s,
                  "size_bytes": r if isinstance(r, int) else None} for s, r in zip(sizes, results)]
        _cache[key] = (time.time(), sized)
    memory = _memory_gb()
    return {"name": name, "memory": memory,
            "tags": [dict(t, fit=fit(t["size_bytes"], memory["vram_gb"], memory["ram_gb"])) for t in sized]}
