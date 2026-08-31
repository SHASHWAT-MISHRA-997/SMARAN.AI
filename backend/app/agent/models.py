"""Getting one reply, from whichever model the agent has been given.

The agent is only as good as the model behind it. A three billion parameter
model in Ollama will follow the loop and will also, measurably, write one file
and then announce it has written three - so the loop has to work with the
larger models people already have keys for, not only with what happens to be
installed locally.

Three shapes cover everything this app can reach:

    OpenAI-compatible  - OpenAI, Groq, OpenRouter, LM Studio, vLLM, Ollama's
                         own /v1 endpoint. One request shape, many hosts.
    Gemini             - Google's own, different enough to need its own call.
    Anthropic          - likewise, and it puts the system prompt outside the
                         message list.

Kept small on purpose. This asks for one completion and returns the text; the
loop does the thinking about what to do with it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from typing import Dict, List, Optional

logger = logging.getLogger("agent.models")

TIMEOUT = 300

#: Where each provider's OpenAI-compatible endpoint lives.
OPENAI_COMPATIBLE = {
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}


def _post(url: str, payload: dict, headers: Dict[str, str]) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def _openai_style(base: str, model: str, key: str, messages: List[Dict]) -> str:
    data = _post(
        base.rstrip("/") + "/chat/completions",
        {"model": model, "messages": messages, "temperature": 0.2},
        {"Authorization": "Bearer %s" % key} if key else {},
    )
    choices = data.get("choices") or []
    return (choices[0].get("message", {}).get("content", "") if choices else "").strip()


def _gemini(model: str, key: str, messages: List[Dict]) -> str:
    # Gemini keeps the system prompt separately and calls the assistant
    # "model", so the conversation has to be rewritten rather than passed on.
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user",
         "parts": [{"text": m["content"]}]}
        for m in messages if m["role"] != "system"
    ]
    payload: Dict = {"contents": contents,
                     "generationConfig": {"temperature": 0.2}}
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}

    data = _post(
        "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s"
        % (model, key), payload, {})
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts).strip()


def _anthropic(model: str, key: str, messages: List[Dict]) -> str:
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    conversation = [{"role": m["role"], "content": m["content"]}
                    for m in messages if m["role"] != "system"]
    payload: Dict = {"model": model, "messages": conversation, "max_tokens": 4096,
                     "temperature": 0.2}
    if system:
        payload["system"] = system

    data = _post("https://api.anthropic.com/v1/messages", payload,
                 {"x-api-key": key, "anthropic-version": "2023-06-01"})
    blocks = data.get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()


def _ollama(model: str, messages: List[Dict]) -> str:
    from app.config import settings

    data = _post(
        settings.OLLAMA_URL.rstrip("/") + "/api/chat",
        {"model": model, "messages": messages, "stream": False,
         "options": {"temperature": 0.2, "num_predict": 2048}},
        {},
    )
    return (data.get("message") or {}).get("content", "").strip()


async def complete(messages: List[Dict], model: str = "",
                   provider: str = "", api_key: str = "") -> str:
    """One reply. Raises with a readable reason rather than returning nothing."""

    def call() -> str:
        if provider in OPENAI_COMPATIBLE:
            return _openai_style(OPENAI_COMPATIBLE[provider], model, api_key, messages)
        if provider == "gemini":
            return _gemini(model, api_key, messages)
        if provider == "anthropic":
            return _anthropic(model, api_key, messages)
        return _ollama(model, messages)

    # Providers go busy. Gemini answered 503 "experiencing high demand" in the
    # middle of a run here, after the work was already done, and the run ended
    # as a failure over a hiccup that had nothing to do with the task. Busy is
    # worth waiting out once; refused or unauthorised is not, and is reported
    # immediately with whatever the provider said.
    RETRYABLE = {429, 500, 502, 503, 504}

    for attempt in (1, 2):
        try:
            return await asyncio.to_thread(call)

        except urllib.error.HTTPError as exc:
            if attempt == 1 and exc.code in RETRYABLE:
                logger.info("%s answered %s; trying once more",
                            provider or "the local model", exc.code)
                await asyncio.sleep(3)
                continue
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            raise RuntimeError(
                "%s refused the request (HTTP %s). %s"
                % (provider or "The local model", exc.code, detail)) from exc

        except TimeoutError as exc:
            if attempt == 1:
                await asyncio.sleep(3)
                continue
            raise RuntimeError(
                "%s did not answer in time." % (provider or "The local model")) from exc

        except urllib.error.URLError as exc:
            raise RuntimeError(
                "Could not reach %s: %s"
                % (provider or "the local model", exc)) from exc

    # Unreachable: both attempts either return or raise.
    raise RuntimeError("No reply from %s." % (provider or "the local model"))
