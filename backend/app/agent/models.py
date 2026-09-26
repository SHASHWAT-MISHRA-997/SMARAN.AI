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
import threading
import urllib.error
import urllib.request
from typing import Dict, List, Optional

logger = logging.getLogger("agent.models")

TIMEOUT = 300


class ProviderError(RuntimeError):
    """A provider refusing, timing out, or being unreachable.

    A RuntimeError subclass so that every existing caller keeps catching it
    and every message reads exactly as it did before. The additions are for
    the orchestrator, which has to tell a rate limit apart from a bad key: one
    is worth waiting out, the other will fail identically forever.
    """

    def __init__(self, message: str, *, status: Optional[int] = None,
                 kind: str = "error") -> None:
        super().__init__(message)
        self.status = status
        self.kind = kind          # http | timeout | unreachable

    @property
    def rate_limited(self) -> bool:
        return self.status == 429

    @property
    def worth_retrying(self) -> bool:
        if self.kind in ("timeout", "unreachable"):
            return True
        return self.status in {429, 500, 502, 503, 504}

#: Where each provider's OpenAI-compatible endpoint lives. DeepSeek and NVIDIA
#: are here because the editor extension has always offered keys for them, and
#: a key the agent cannot use is worse than no field at all.
OPENAI_COMPATIBLE = {
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "nvidia": "https://integrate.api.nvidia.com/v1",
    "together": "https://api.together.xyz/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "sambanova": "https://api.sambanova.ai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "huggingface": "https://router.huggingface.co/v1",
}

#: Where each provider's saved key is found. The Model Hub stores keys on the
#: backend and loads them into these at start, so the agent can use the key the
#: owner already saved instead of needing it passed in every request.
KEY_ENV = {
    "openai": "OPENAI_API_KEY", "groq": "GROQ_API_KEY", "openrouter": "OPENROUTER_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY", "nvidia": "NVIDIA_API_KEY", "together": "TOGETHER_API_KEY",
    "cerebras": "CEREBRAS_API_KEY", "sambanova": "SAMBANOVA_API_KEY", "mistral": "MISTRAL_API_KEY",
    "huggingface": "HUGGINGFACE_API_KEY", "gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
}


def _post(url: str, payload: dict, headers: Dict[str, str]) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def _openai_style(base: str, model: str, key: str, messages: List[Dict], quick: bool = False) -> str:
    body: Dict = {"model": model, "messages": messages, "temperature": 0.2}
    if quick and "gpt-oss" in model.lower():
        body["reasoning_effort"] = "low"
    data = _post(
        base.rstrip("/") + "/chat/completions",
        body,
        {"Authorization": "Bearer %s" % key} if key else {},
    )
    choices = data.get("choices") or []
    return (choices[0].get("message", {}).get("content", "") if choices else "").strip()


def _gemini(model: str, key: str, messages: List[Dict], quick: bool = False) -> str:
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
    if quick and "flash" in model.lower():
        # A few lines of JSON do not need Flash to think first (8-14 s).
        from app.model_router import _version
        payload["generationConfig"]["thinkingConfig"] = (
            {"thinkingLevel": "low"} if _version(model) > 3.0 else {"thinkingBudget": 0})
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


# Ollama runs a model with a 4096-token window unless told otherwise, and cuts
# a longer conversation from the front without a word - which is where the
# instructions are. A run a few steps in no longer knew how to call a tool or
# that it must not repeat itself, and a small model went round in circles.
# The same size chat asks for (main.py), because each different size makes
# Ollama reload the model: switching between Chat and Code would pay for it.
AGENT_CONTEXT = 16384


def _ollama(model: str, messages: List[Dict], stop: Optional[threading.Event] = None) -> str:
    from app.config import settings

    # Streamed, so the time limit is "nothing new for TIMEOUT seconds" rather
    # than "the whole answer within TIMEOUT": on a laptop GPU a long answer
    # legitimately takes minutes and was cut off while it was still writing.
    request = urllib.request.Request(
        settings.OLLAMA_URL.rstrip("/") + "/api/chat",
        data=json.dumps({"model": model, "messages": messages, "stream": True,
                         "options": {"temperature": 0.2, "num_predict": 2048,
                                     "num_ctx": AGENT_CONTEXT,
                                     # A tool call ends the turn. Small models
                                     # kept writing after it - once for 2048
                                     # tokens, six minutes on a laptop GPU.
                                     "stop": ["</tool_call>"]}}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    parts: List[str] = []
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        for line in response:
            if stop is not None and stop.is_set():
                break  # closing the connection makes Ollama stop too
            if not line.strip():
                continue
            chunk = json.loads(line.decode("utf-8"))
            if chunk.get("error"):
                raise ProviderError("The local model stopped: %s" % str(chunk["error"])[:300])
            parts.append((chunk.get("message") or {}).get("content", ""))
            if chunk.get("done"):
                break
    text = "".join(parts).strip()
    # Ollama leaves the stop text out; put the closing tag back.
    if "<tool_call" in text and "</tool_call>" not in text:
        text += "\n</tool_call>"
    return text


async def complete(messages: List[Dict], model: str = "",
                   provider: str = "", api_key: str = "",
                   attempts: int = 2, quick: bool = False) -> str:
    """One reply. Raises with a readable reason rather than returning nothing.

    `attempts` is here for the orchestrator, which schedules its own backoff
    across several providers and does not want this function quietly spending
    an extra three seconds first. Everything else leaves it alone and keeps
    the retry described below.
    """

    if provider and not api_key and provider in KEY_ENV:
        import os
        api_key = os.getenv(KEY_ENV[provider], "")
        if not api_key:
            raise ProviderError("No %s key is saved on this computer. Add one in Model Hub -> Cloud Provider Keys."
                                % provider, kind="http")

    # Set when the run is stopped: the request runs on a worker thread that
    # cancelling the run cannot reach, and Ollama kept generating for a run
    # nobody was waiting on - with the next run queued behind it.
    stop = threading.Event()

    def call() -> str:
        if provider in OPENAI_COMPATIBLE:
            if quick:
                return _openai_style(OPENAI_COMPATIBLE[provider], model, api_key, messages, quick=True)
            return _openai_style(OPENAI_COMPATIBLE[provider], model, api_key, messages)
        if provider == "gemini":
            return _gemini(model, api_key, messages, quick=True) if quick else _gemini(model, api_key, messages)
        if provider == "anthropic":
            return _anthropic(model, api_key, messages)
        return _ollama(model, messages, stop)

    # Providers go busy. Gemini answered 503 "experiencing high demand" in the
    # middle of a run here, after the work was already done, and the run ended
    # as a failure over a hiccup that had nothing to do with the task. Busy is
    # worth waiting out once; refused or unauthorised is not, and is reported
    # immediately with whatever the provider said.
    RETRYABLE = {429, 500, 502, 503, 504}

    last = max(1, attempts)
    for attempt in range(1, last + 1):
        try:
            try:
                return await asyncio.to_thread(call)
            except asyncio.CancelledError:
                stop.set()
                raise

        except urllib.error.HTTPError as exc:
            if attempt < last and exc.code in RETRYABLE:
                logger.info("%s answered %s; trying once more",
                            provider or "the local model", exc.code)
                await asyncio.sleep(3)
                continue
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            raise ProviderError(
                "%s refused the request (HTTP %s). %s"
                % (provider or "The local model", exc.code, detail),
                status=exc.code, kind="http") from exc

        except TimeoutError as exc:
            if attempt < last:
                await asyncio.sleep(3)
                continue
            raise ProviderError(
                "%s did not answer in time." % (provider or "The local model"),
                kind="timeout") from exc

        except urllib.error.URLError as exc:
            raise ProviderError(
                "Could not reach %s: %s"
                % (provider or "the local model", exc),
                kind="unreachable") from exc

    # Unreachable: every attempt either returns or raises.
    raise ProviderError("No reply from %s." % (provider or "the local model"))
