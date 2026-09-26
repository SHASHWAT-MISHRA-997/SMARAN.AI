"""Where a picture is made: this machine, or a hosted model - chosen, not hidden.

Images used to be made on the local GPU only, at minutes a picture on a 6 GB
card. And when the local engine failed, chat quietly sent the prompt to a
free third-party site and showed its picture under the words "Creating your
image on this device". Neither is acceptable.

Now every source is named and ranked:

  cloud  NVIDIA-hosted FLUX (your NVIDIA key; runs on its trial credits) -
         a 1024x1024 photograph in about four seconds
  local  the image models installed on this machine - nothing leaves it

Settings decide which are allowed (Automatic, Local only, Cloud only). Each
result says which source made it, how long it took, and why any source ahead
of it did not. Failures are recorded in app.model_router, so a source out of
credit or refusing the key is passed over for hours rather than retried on
every picture.

Sources that charge per image or per second of video (Gemini image models,
Veo, Replicate) are not used by this router: none are wired to spend money
without an explicit, tested opt-in.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import random
import threading
import time
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

SOURCES = ("auto", "local", "cloud")

#: Hosted image models, best first. `steps` is what each is built for.
CLOUD_IMAGE_MODELS = (
    {"provider": "nvidia", "model": "black-forest-labs/flux.1-dev", "label": "FLUX.1-dev (NVIDIA)",
     "steps": 28, "extra": {"cfg_scale": 3.5, "mode": "base"}},
    {"provider": "nvidia", "model": "black-forest-labs/flux.1-schnell", "label": "FLUX.1-schnell (NVIDIA)",
     "steps": 4, "extra": {}},
)

NVIDIA_URL = "https://ai.api.nvidia.com/v1/genai/"
NVIDIA_STATUS = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/"
CLOUD_TIMEOUT = 150

_prefs_lock = threading.Lock()


class MediaError(RuntimeError):
    """Every source failed; the message says what each one did."""


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------

def _prefs_path() -> str:
    from app.config import settings
    return os.path.join(settings.DATA_DIR, "media_prefs.json")


def load_prefs() -> Dict:
    prefs = {"image_source": "auto"}
    try:
        with open(_prefs_path(), encoding="utf-8") as handle:
            stored = json.load(handle) or {}
        if stored.get("image_source") in SOURCES:
            prefs["image_source"] = stored["image_source"]
    except (OSError, ValueError):
        pass
    return prefs


def save_prefs(changes: Dict) -> Dict:
    with _prefs_lock:
        prefs = load_prefs()
        source = changes.get("image_source")
        if source is not None:
            if source not in SOURCES:
                raise ValueError("image_source must be one of %s" % ", ".join(SOURCES))
            prefs["image_source"] = source
        path = _prefs_path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(prefs, handle)
        os.replace(tmp, path)
    return prefs


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

def _nvidia_key() -> str:
    return (os.getenv("NVIDIA_API_KEY") or "").strip()


def _flux_size(width: int, height: int) -> tuple:
    """FLUX on NVIDIA takes 768-1344 in steps of 64; keep the shape asked for."""
    def fit(value: int) -> int:
        return max(768, min(1344, int(round(value / 64.0)) * 64))
    width, height = int(width or 1024), int(height or 1024)
    scale = 1024.0 / max(width, height) if max(width, height) < 768 else 1.0
    return fit(width * scale), fit(height * scale)


def _nvidia_image(entry: Dict, prompt: str, width: int, height: int, seed: Optional[int],
                  out_path: str, note: Callable[[str], None]) -> Dict:
    import httpx

    key = _nvidia_key()
    if not key:
        raise _SourceFailed(None, "No NVIDIA key is saved.", kind="auth")
    w, h = _flux_size(width, height)
    body = {"prompt": prompt[:1900], "width": w, "height": h, "steps": entry["steps"],
            # No seed asked for means a new picture each time, not seed 0 forever.
            "seed": int(seed) if seed is not None else random.randint(1, 2 ** 31 - 1), **entry["extra"]}
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json",
               "Content-Type": "application/json", "NVCF-POLL-SECONDS": "5"}
    started = time.time()
    response = httpx.post(NVIDIA_URL + entry["model"], headers=headers, json=body, timeout=60)
    # NVIDIA queues busy functions and answers 202 with an id to poll.
    request_id = response.headers.get("nvcf-reqid")
    while response.status_code == 202 and time.time() - started < CLOUD_TIMEOUT:
        note("Waiting for %s…" % entry["label"])
        response = httpx.get(NVIDIA_STATUS + request_id, headers=headers, timeout=60)
    if response.status_code != 200:
        try:
            detail = response.json().get("detail") or response.json().get("title") or ""
        except ValueError:
            detail = response.text[:200]
        raise _SourceFailed(response.status_code, str(detail)[:200] or "HTTP %s" % response.status_code)
    data = response.json()
    artifact = (data.get("artifacts") or [{}])[0]
    encoded = artifact.get("base64") or data.get("image")
    if artifact.get("finishReason") == "CONTENT_FILTERED":
        raise _SourceFailed(200, "NVIDIA's safety filter declined this prompt.", kind="refused")
    if not encoded:
        raise _SourceFailed(200, "The service answered without an image.", kind="empty")
    raw = base64.b64decode(encoded)
    # NVIDIA returns JPEG; keep the file honest about what it is.
    path = os.path.splitext(out_path)[0] + (".jpg" if raw[:3] == b"\xff\xd8\xff" else ".png")
    with open(path, "wb") as handle:
        handle.write(raw)
    return {"path": path, "width": w, "height": h, "seed": body["seed"], "steps": body["steps"]}


class _SourceFailed(Exception):
    def __init__(self, status: Optional[int], message: str, kind: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.kind = kind


def image_sources(local_model: str = "", prefs: Optional[Dict] = None) -> List[Dict]:
    """Where a picture could be made right now, best first, with each one's status."""
    from app import model_router
    from app.imaging.engine import evaluate
    from app.imaging.registry import MODELS, by_id
    from app.video.hardware import probe

    prefs = prefs or load_prefs()
    source = prefs.get("image_source", "auto")
    rows: List[Dict] = []

    if source in ("auto", "cloud"):
        for entry in CLOUD_IMAGE_MODELS:
            usable, why = bool(_nvidia_key()), ""
            if not usable:
                why = "no NVIDIA key saved"
            else:
                blocked = model_router.blocked(entry["provider"], entry["model"])
                if blocked:
                    usable, why = False, model_router.plain_reason(blocked)
            rows.append({"kind": "cloud", **entry, "usable": usable, "why": why})

    if source in ("auto", "local"):
        hw = probe()
        wanted = by_id(local_model) if local_model else None
        ordered = ([wanted] if wanted else []) + [m for m in MODELS if m is not wanted]
        for model in ordered:
            verdict = evaluate(model, hw)
            rows.append({"kind": "local", "provider": "local", "model": model.id,
                         "label": "%s (this computer)" % (getattr(model, "display_name", "") or model.id),
                         "usable": bool(verdict.get("runnable")),
                         "why": "" if verdict.get("runnable") else verdict.get("reason", "")})
            if verdict.get("runnable"):
                break  # the first runnable local model is the local choice
    return rows


def generate_image(prompt: str, out_path: str, *, width: Optional[int] = None,
                   height: Optional[int] = None, steps: Optional[int] = None,
                   guidance_scale: float = 7.0, seed: Optional[int] = None,
                   negative_prompt: Optional[str] = None, local_model: str = "",
                   progress: Callable[[str], None] = lambda _m: None,
                   prefs: Optional[Dict] = None) -> Dict:
    """Make the picture with the best source that answers, and say which it was."""
    from app import model_router

    sources = image_sources(local_model, prefs)
    tried: List[str] = [("%s skipped: %s" % (s["label"], s["why"])) for s in sources
                        if not s["usable"] and s["kind"] == "cloud" and s["why"] != "no NVIDIA key saved"]
    usable = [s for s in sources if s["usable"]]
    if not usable:
        reasons = "; ".join("%s: %s" % (s["label"], s["why"]) for s in sources) or "no source is allowed"
        raise MediaError("No image source can run right now - %s." % reasons)

    for source in usable:
        started = time.time()
        try:
            if source["kind"] == "cloud":
                progress("Making it with %s - the prompt goes to NVIDIA." % source["label"])
                result = _nvidia_image(source, prompt, width or 1024, height or 1024, seed,
                                       out_path, progress)
            else:
                progress("Making it on this computer with %s." % source["label"])
                free_gpu_for_media(progress)
                local_w, local_h = native_size(source["model"], width, height)
                if (local_w, local_h) != (int(width or local_w), int(height or local_h)):
                    progress("%s draws best at %dx%d, so it is made at that size (same shape)."
                             % (source["label"], local_w, local_h))
                from app.imaging.engine import generate
                kwargs = dict(prompt=prompt, output_path=out_path, model_id=source["model"],
                              width=local_w, height=local_h, guidance_scale=guidance_scale,
                              seed=seed, progress=progress)
                if steps:
                    kwargs["steps"] = steps
                if negative_prompt:
                    kwargs["negative_prompt"] = negative_prompt
                result = generate(**kwargs)
                result = result if isinstance(result, dict) else {"path": out_path}
        except _SourceFailed as exc:
            if exc.kind == "refused":
                # About this prompt, not the model: another source may draw
                # it, and the model stays in the running for the next one.
                kind = "refused"
            else:
                kind = model_router.record_failure(source["provider"], source["model"], exc.status,
                                                   str(exc), kind=exc.kind if exc.kind in model_router.COOLDOWN else None)
            tried.append("%s: %s" % (source["label"], exc))
            progress("%s did not make it (%s)." % (source["label"], model_router.plain_reason(kind)))
            continue
        except Exception as exc:  # noqa: BLE001 - the next source may still work
            if source["kind"] == "cloud":
                model_router.record_failure(source["provider"], source["model"], None, str(exc),
                                            kind="timeout" if "timed out" in str(exc).lower() else "server")
            tried.append("%s: %s" % (source["label"], exc))
            progress("%s did not make it: %s" % (source["label"], exc))
            continue

        seconds = round(time.time() - started, 1)
        if source["kind"] == "cloud":
            model_router.record_success(source["provider"], source["model"], latency_ms=seconds * 1000)
        return {**result, "prompt": prompt, "model": source["model"], "made_by": source["label"],
                "where": source["kind"], "seconds": seconds,
                "fallback_reason": "; ".join(tried)[:400]}

    raise MediaError("The picture could not be made. " + "; ".join(tried)[:600])


def video_sources() -> List[Dict]:
    """Where a video could be made, and the truth about each - nothing here spends money."""
    rows: List[Dict] = []
    try:
        from app.video.planner import plan
        ready = plan("text-to-video")
        best = ready.get("recommended")
        reason = (ready.get("candidates") or [{}])[0].get("reason", "no video model can run here")
        rows.append({"kind": "local", "label": "LTX-Video (this computer)", "usable": bool(best),
                     "paid": False, "why": "" if best else reason})
    except Exception as exc:  # noqa: BLE001 - a status line, not a failure
        rows.append({"kind": "local", "label": "LTX-Video (this computer)", "usable": False,
                     "paid": False, "why": str(exc)[:200]})
    from app.video import hosted
    rows.append({"kind": "cloud", "label": "Replicate (%s)" % hosted.model_name(), "usable": hosted.configured(),
                 "paid": True, "why": "" if hosted.configured() else
                 "no Replicate key saved - billed per video when added"})
    if (os.getenv("GEMINI_API_KEY") or "").strip():
        rows.append({"kind": "cloud", "label": "Google Veo (your Gemini key)", "usable": False, "paid": True,
                     "why": "charged per second of video, so it is not used without your say-so"})
    return rows


def free_gpu_for_media(note: Callable[[str], None] = lambda _m: None) -> List[str]:
    """Ask Ollama to let go of the graphics card before a picture or video.

    A chat model left loaded holds 4-5 GB of a 6 GB card, and Stable
    Diffusion then spills into shared memory: 500 seconds for a picture that
    takes 14 with the card free. Chat loads its model again on the next
    message, a few seconds, which is the better trade.
    """
    import httpx
    from app.config import settings

    base = settings.OLLAMA_URL.rstrip("/")
    try:
        loaded = [m.get("name") for m in httpx.get(base + "/api/ps", timeout=3).json().get("models", [])]
    except Exception:  # noqa: BLE001 - no Ollama, nothing to free
        return []
    freed = []
    for name in filter(None, loaded):
        try:
            httpx.post(base + "/api/generate", json={"model": name, "keep_alive": 0}, timeout=20)
            freed.append(name)
        except Exception:  # noqa: BLE001
            continue
    if freed:
        note("Freed the graphics card from %s for this." % ", ".join(freed))
    return freed


def native_size(model_id: str, width: Optional[int], height: Optional[int]) -> tuple:
    """The size a local model draws well at, in the shape that was asked for."""
    from app.imaging.registry import by_id

    model = by_id(model_id)
    native = getattr(model, "default_size", 0) or 0
    width, height = int(width or native or 512), int(height or native or 512)
    if native and max(width, height) > native:
        scale = native / float(max(width, height))
        width = max(256, int(round(width * scale / 64.0)) * 64)
        height = max(256, int(round(height * scale / 64.0)) * 64)
    return width, height
