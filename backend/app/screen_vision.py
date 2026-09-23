"""Looking at the screen and answering a question about it.

"What's on my screen?" needs a model that can see. The first choice is a local
one (Ollama with llava, moondream, gemma3 ...): the screenshot never leaves the
machine. Without one, the question used to end in "install llava" even on a
machine with a working Gemini or OpenAI key - so the providers already set up
in Settings are tried next, and the answer says which model looked, because a
screenshot sent to a provider has left the machine.

Only ever run because someone asked about their screen. Nothing here captures
anything on its own.
"""
from __future__ import annotations

import base64
import io
import logging
from typing import Optional

import httpx

from app.config import settings
from app import site_builder

log = logging.getLogger(__name__)

LOCAL_VISION_HINTS = ("llava", "vl", "vision", "moondream", "bakllava", "minicpm-v", "gemma3")

#: For each provider, substrings of model ids that accept images, best first.
#: Matched against what the provider lists for this key, never assumed.
CLOUD_VISION = {
    "anthropic": ("claude-sonnet", "claude-haiku", "claude-opus", "claude-3"),
    "openai": ("gpt-4.1-mini", "gpt-4o-mini", "gpt-5-mini", "gpt-4.1", "gpt-4o", "gpt-5"),
    "gemini": ("flash-lite", "flash"),
    "openrouter": ("google/gemini-2.5-flash", "google/gemini", "openai/gpt-4o-mini",
                   "meta-llama/llama-4", "qwen/qwen2.5-vl"),
    "mistral": ("pixtral", "mistral-small", "mistral-medium"),
    "groq": ("llama-4-scout", "llama-4-maverick"),
    "together": ("Llama-4", "Qwen2.5-VL", "Vision"),
}
#: Listed next to vision models and never able to answer about a picture.
_NOT_FOR_SEEING = ("embed", "tts", "audio", "image-generation", "imagen", "live", "transcribe",
                   "whisper", "moderation", "search", "realtime", "dall-e")

SYSTEM = ("You are looking at a screenshot of the user's computer screen, taken just now. "
          "Answer their question about it directly and briefly - two or three sentences "
          "unless they ask for detail - in the language they asked in. Say what you can "
          "actually see; if something is too small or unclear to read, say so rather than guess.")

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


def shrink(png_b64: str, max_width: int = 1600) -> tuple[str, str]:
    """A smaller JPEG of the screenshot: (base64, mime type).

    A 4K screen as PNG is several megabytes of base64 - slow to send and over
    some providers' limits. Text stays legible at 1600 px wide.
    """
    try:
        from PIL import Image

        image = Image.open(io.BytesIO(base64.b64decode(png_b64)))
        if image.width > max_width:
            image = image.resize((max_width, round(image.height * max_width / image.width)))
        out = io.BytesIO()
        image.convert("RGB").save(out, format="JPEG", quality=82)
        return base64.b64encode(out.getvalue()).decode("ascii"), "image/jpeg"
    except Exception:  # Pillow missing or an unreadable image: send it as it is
        return png_b64, "image/png"


def pick_cloud_models(provider: str, model_ids: list[str], limit: int = 2) -> list[str]:
    """This provider's models that can see, best first."""
    usable = [m for m in model_ids if not any(bad in m.lower() for bad in _NOT_FOR_SEEING)]
    picked: list[str] = []
    for hint in CLOUD_VISION.get(provider, ()):
        for model in sorted(usable, key=lambda m: (-site_builder._version_of(m), m)):
            if hint.lower() in model.lower() and model not in picked:
                picked.append(model)
    return picked[:limit]


def _local_model() -> Optional[str]:
    try:
        with httpx.Client(timeout=3.0) as client:
            tags = client.get(f"{settings.OLLAMA_URL.rstrip('/')}/api/tags").json()
    except Exception:
        return None
    names = [m.get("name", "") for m in (tags.get("models") or [])]
    return next((n for n in names if any(h in n.lower() for h in LOCAL_VISION_HINTS)), None)


def _ask_local(model: str, question: str, png_b64: str) -> tuple[str, str]:
    try:
        with httpx.Client(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
            response = client.post(f"{settings.OLLAMA_URL.rstrip('/')}/api/chat", json={
                "model": model,
                "messages": [{"role": "system", "content": SYSTEM},
                             {"role": "user", "content": question, "images": [png_b64]}],
                "stream": False,
            })
        if response.status_code != 200:
            return "", f"{model} answered HTTP {response.status_code}"
        return ((response.json().get("message") or {}).get("content") or "").strip(), ""
    except Exception as exc:
        return "", f"{model} could not be reached ({str(exc)[:60]})"


def _ask_cloud(provider: str, model: str, key: str, question: str,
               image_b64: str, mime: str) -> tuple[str, str]:
    endpoint = site_builder._ENDPOINTS[provider]
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            if provider == "gemini":
                response = client.post(
                    f"{endpoint}/models/{model}:generateContent",
                    params={"key": key},
                    json={"systemInstruction": {"parts": [{"text": SYSTEM}]},
                          "contents": [{"role": "user", "parts": [
                              {"inline_data": {"mime_type": mime, "data": image_b64}},
                              {"text": question}]}]})
                if response.status_code != 200:
                    return "", f"HTTP {response.status_code}"
                parts = ((response.json().get("candidates") or [{}])[0]
                         .get("content", {}).get("parts") or [])
                return "".join(p.get("text", "") for p in parts).strip(), ""
            if provider == "anthropic":
                response = client.post(
                    f"{endpoint}/messages",
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                    json={"model": model, "max_tokens": 800, "system": SYSTEM,
                          "messages": [{"role": "user", "content": [
                              {"type": "image", "source": {"type": "base64", "media_type": mime,
                                                           "data": image_b64}},
                              {"type": "text", "text": question}]}]})
                if response.status_code != 200:
                    return "", f"HTTP {response.status_code}"
                blocks = response.json().get("content") or []
                return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip(), ""
            headers = {"Authorization": f"Bearer {key}"}
            if provider == "openrouter":
                headers.update({"HTTP-Referer": "http://localhost:3003", "X-Title": "SMARAN.AI"})
            response = client.post(
                f"{endpoint}/chat/completions", headers=headers,
                json={"model": model, "max_tokens": 800,
                      "messages": [{"role": "system", "content": SYSTEM},
                                   {"role": "user", "content": [
                                       {"type": "image_url",
                                        "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                                       {"type": "text", "text": question}]}]})
            if response.status_code != 200:
                return "", f"HTTP {response.status_code}"
            choice = (response.json().get("choices") or [{}])[0]
            return ((choice.get("message") or {}).get("content") or "").strip(), ""
    except Exception as exc:
        return "", f"could not be reached ({str(exc)[:60]})"


def ask(question: str, png_b64: str) -> dict:
    """Answer `question` about the screenshot.

    Returns {"answer", "model", "where"} on success - `where` is "local" or the
    provider - or {"error"} saying what to set up.
    """
    local = _local_model()
    if local:
        answer, problem = _ask_local(local, question, png_b64)
        if answer:
            return {"answer": answer, "model": local, "where": "local"}
        log.info("local vision failed: %s", problem)

    image_b64, mime = shrink(png_b64)
    tried: list[str] = []
    for provider, env_name in site_builder.PROVIDER_ORDER:
        if provider not in CLOUD_VISION:
            continue
        key = site_builder._key_for(env_name)
        if not key:
            continue
        model_ids, problem = site_builder._list_models(provider, key)
        for model in pick_cloud_models(provider, model_ids):
            answer, problem = _ask_cloud(provider, model, key, question, image_b64, mime)
            if answer:
                return {"answer": answer, "model": model, "where": provider}
            tried.append(f"{provider}/{model}: {problem}")
        if not model_ids and problem:
            tried.append(f"{provider}: {problem}")

    if tried:
        return {"error": "No model could look at the screen - " + "; ".join(tried[:4]) + "."}
    return {"error": ("I can't see your screen yet: no model that can see is set up. "
                      "Install one in Model Hub (moondream is 1.7 GB, llava:7b 4.7 GB) to keep "
                      "screenshots on this computer, or add a Gemini or OpenAI key in Settings.")}
