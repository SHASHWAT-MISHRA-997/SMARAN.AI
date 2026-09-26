"""Which model should answer this, and what to do when it cannot.

Automatic routing used to try providers in one fixed order - Gemini, then
Groq, then Cerebras - whatever was asked, and treated every failure alike: a
model out of quota ("402 Payment required") was parked for ninety seconds and
then tried again on the next message, and the next. Code went to whichever
fast chat model came first; so did a page of HTML.

Here the request is read for what kind of work it is, each available model is
ranked for that kind of work, and what actually happened on this machine -
answered or not, how fast - moves a model up or down. A failure is sorted by
what it means: out of credit or refused a key stays out for hours; rate
limited waits a minute; a busy server a moment.

    task = classify(prompt, section)
    ranked = rank(candidates, task)      # best first, blocked ones dropped
    record_success(provider, model, ...) / record_failure(provider, model, status, message)
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Dict, Iterable, List, Optional, Tuple

TASKS = ("chat", "code", "reasoning", "writing", "design", "vision", "search")

TASK_LABEL = {
    "chat": "conversation", "code": "coding", "reasoning": "reasoning",
    "writing": "long writing", "design": "a designed page", "vision": "reading an image",
    "search": "web research",
}

_CODE = re.compile(
    r"```|\b(code|coding|function|class|bug|debug|error|exception|stack ?trace|compile|refactor|"
    r"python|javascript|typescript|java|c\+\+|c#|rust|golang|sql|regex|api|endpoint|script|"
    r"html|css|react|node|django|flask|fastapi|docker|git|unit test|pytest)\b", re.I)
_REASONING = re.compile(
    r"\b(prove|proof|derive|solve|equation|calculate|compute|probability|integral|"
    r"step by step|reason|logic|puzzle|why does|how does .* work|compare|trade-?offs?|"
    r"analy[sz]e|optimi[sz]e|plan)\b|\d+\s*[\+\-\*/\^]\s*\d+", re.I)
_WRITING = re.compile(
    r"\b(write|draft|essay|article|story|poem|blog|letter|email|report|summar(y|ise|ize)|"
    r"rewrite|translate|script|speech|caption)\b", re.I)
_VISION = re.compile(r"\b(this|the attached|my) (image|photo|picture|screenshot)\b", re.I)


def classify(prompt: str, section: str = "chat", *, web: bool = False) -> str:
    """The kind of work a request is. The screen it came from counts first."""
    section = (section or "chat").lower()
    if section == "design":
        return "design"
    if section == "code":
        return "code"
    text = prompt or ""
    if _VISION.search(text):
        return "vision"
    if _CODE.search(text):
        return "code"
    if _REASONING.search(text):
        return "reasoning"
    if web:
        return "search"
    if _WRITING.search(text) or len(text) > 600:
        return "writing"
    return "chat"


# Model-name shapes that are good at each kind of work, best first. Names
# drift, so these are patterns over each provider's live catalogue rather
# than fixed ids. Anything unmatched still ranks - after these.
PREFERENCES: Dict[str, Tuple[str, ...]] = {
    "code": (r"qwen.*coder", r"deepseek.*(coder|chat|v3)", r"codestral|devstral", r"gpt-oss-120b",
             r"claude.*(sonnet|opus)", r"gpt-(4\.1|5|4o)(?!-mini)", r"gemini-\d.*pro",
             r"llama.*(70b|405b)", r"qwen.*(32b|72b|235b)", r"gemini-\d.*flash", r"gpt-oss"),
    "reasoning": (r"deepseek.*(reasoner|r1)", r"gpt-oss-120b", r"\bo\d", r"claude.*(opus|sonnet)",
                  r"gemini-\d.*pro", r"qwen.*(qwq|235b|thinking)", r"gemini-\d.*flash(?!-lite)",
                  r"llama.*(70b|405b)", r"gpt-oss"),
    "design": (r"claude.*(sonnet|opus)", r"gemini-\d.*pro", r"gpt-(4\.1|5|4o)(?!-mini)",
               r"deepseek.*(chat|v3)", r"qwen.*coder", r"gemini-\d.*flash(?!-lite)", r"gpt-oss-120b",
               r"llama.*(70b|405b)", r"qwen.*(32b|72b|235b)"),
    "writing": (r"claude", r"gemini-\d.*(pro|flash(?!-lite))", r"gpt-(4\.1|5|4o)", r"mistral-(large|medium)",
                r"llama.*(70b|405b)", r"deepseek.*(chat|v3)", r"qwen.*(32b|72b|235b)", r"gpt-oss"),
    "search": (r"gemini-\d.*flash(?!-lite)", r"gemini-\d.*pro", r"llama.*(70b|405b)", r"deepseek.*chat",
               r"gpt-oss", r"claude", r"mistral"),
    "vision": (r"gemini", r"gpt-4o|gpt-4\.1|gpt-5", r"claude", r"llama.*(vision|scout|maverick)",
               r"qwen.*vl", r"pixtral"),
    "chat": (r"gemini-\d.*flash(?!-lite)", r"llama.*70b", r"gpt-oss-120b", r"deepseek.*chat",
             r"claude.*(haiku|sonnet)", r"gpt-(4o|4\.1|5)-mini", r"mistral", r"llama.*8b",
             r"gemini-\d.*flash-lite", r"qwen"),
}

# Never worth sending text work to.
_NOT_CHAT = re.compile(r"(embed|whisper|tts|audio|imagen|image|veo|guard|moderation|rerank|"
                       r"transcri|search-preview|realtime|computer-use|aqa|live|lyria|robotics)", re.I)

# How long each kind of failure keeps a model out.
COOLDOWN = {
    "billing": 6 * 3600,     # out of credit or quota: it will not come back this hour
    "auth": 24 * 3600,       # key refused: until the key changes
    "unsupported": 24 * 3600,  # this model id is not served here
    "rate": 60,              # asked to slow down
    "server": 90,            # provider trouble
    "timeout": 90,
    "empty": 90,
}

_BILLING = re.compile(r"payment|billing|quota|insufficient|credit|balance|exceeded your|plan", re.I)


def failure_kind(status: Optional[int], message: str = "") -> str:
    message = message or ""
    if status == 402 or _BILLING.search(message):
        return "billing"
    if status in (401, 403):
        return "auth"
    if status == 429:
        return "rate"
    if status in (400, 404, 405, 410, 422):
        return "unsupported"
    if status is None and "timed out" in message.lower():
        return "timeout"
    return "server"


def plain_reason(kind: str) -> str:
    return {
        "billing": "out of credit or quota on that account",
        "auth": "the saved key was refused",
        "unsupported": "that model is not available there",
        "rate": "rate limited for a moment",
        "server": "the provider had an error",
        "timeout": "it did not answer in time",
        "empty": "it answered with nothing",
        "refused": "its safety filter declined this prompt",
    }.get(kind, "it failed")


class _Health:
    __slots__ = ("ok", "failed", "blocked_until", "last_kind", "last_error",
                 "latency_ms", "first_token_ms", "tokens_per_sec", "updated")

    def __init__(self, data: Optional[dict] = None):
        data = data or {}
        self.ok = int(data.get("ok", 0))
        self.failed = int(data.get("failed", 0))
        self.blocked_until = float(data.get("blocked_until", 0))
        self.last_kind = data.get("last_kind", "")
        self.last_error = data.get("last_error", "")
        self.latency_ms = data.get("latency_ms")
        self.first_token_ms = data.get("first_token_ms")
        self.tokens_per_sec = data.get("tokens_per_sec")
        self.updated = float(data.get("updated", 0))

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


_lock = threading.Lock()
_health: Dict[str, _Health] = {}
_loaded = False
_last_save = 0.0


def _path() -> str:
    try:
        from app.config import settings
        base = settings.DATA_DIR
    except Exception:  # noqa: BLE001 - tests without settings
        base = os.getcwd()
    return os.path.join(base, "route_health.json")


def _key(provider: str, model: str) -> str:
    return "%s/%s" % ((provider or "local").lower(), model)


def _load() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    try:
        with open(_path(), encoding="utf-8") as handle:
            for key, data in (json.load(handle) or {}).items():
                _health[key] = _Health(data)
    except (OSError, ValueError):
        pass


def _save(force: bool = False) -> None:
    global _last_save
    now = time.time()
    if not force and now - _last_save < 5:
        return
    _last_save = now
    try:
        path = _path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump({k: v.as_dict() for k, v in _health.items()}, handle)
        os.replace(tmp, path)
    except OSError:
        pass


def _get(provider: str, model: str) -> _Health:
    _load()
    key = _key(provider, model)
    if key not in _health:
        _health[key] = _Health()
    return _health[key]


def _blend(old, new, weight: float = 0.3):
    if new is None:
        return old
    return round(new if old is None else old * (1 - weight) + new * weight, 1)


def record_success(provider: str, model: str, *, latency_ms: Optional[float] = None,
                   first_token_ms: Optional[float] = None,
                   tokens_per_sec: Optional[float] = None) -> None:
    with _lock:
        health = _get(provider, model)
        health.ok += 1
        health.blocked_until = 0
        health.last_kind = ""
        health.latency_ms = _blend(health.latency_ms, latency_ms)
        health.first_token_ms = _blend(health.first_token_ms, first_token_ms)
        health.tokens_per_sec = _blend(health.tokens_per_sec, tokens_per_sec)
        health.updated = time.time()
        _save()


def record_failure(provider: str, model: str, status: Optional[int] = None,
                   message: str = "", kind: Optional[str] = None,
                   retry_after: Optional[float] = None) -> str:
    kind = kind or failure_kind(status, message)
    wait = COOLDOWN.get(kind, 90)
    if kind == "rate" and retry_after:
        wait = max(5.0, min(float(retry_after), 600.0))
    with _lock:
        health = _get(provider, model)
        health.failed += 1
        health.last_kind = kind
        health.last_error = (message or "")[:200]
        health.blocked_until = time.time() + wait
        health.updated = time.time()
        _save(force=kind in ("billing", "auth"))
    return kind


def blocked(provider: str, model: str) -> Optional[str]:
    """Why this model is being kept out right now, or None."""
    with _lock:
        health = _get(provider, model)
        if health.blocked_until > time.time():
            return health.last_kind or "server"
    return None


def forget_provider(provider: str) -> None:
    """A new key was saved: what the old one was refused for no longer holds."""
    with _lock:
        _load()
        prefix = (provider or "").lower() + "/"
        for key, health in _health.items():
            if key.startswith(prefix):
                health.blocked_until = 0
        _save(force=True)


def usable_for_text(model: str) -> bool:
    return not _NOT_CHAT.search(model or "")


def _preference(model: str, task: str) -> int:
    for index, pattern in enumerate(PREFERENCES.get(task, ())):
        if re.search(pattern, model or "", re.I):
            return index
    return len(PREFERENCES.get(task, ())) + 1


def score(provider: str, model: str, task: str) -> float:
    """Lower is better: fit for the task first, then how it has actually done here."""
    health = _get(provider, model)
    value = _preference(model, task) * 10.0
    tried = health.ok + health.failed
    if tried:
        value += 15.0 * (health.failed / tried)       # unreliable here
    if health.first_token_ms:
        value += min(health.first_token_ms / 1000.0, 10.0)  # slow to start
    if task == "chat" and health.tokens_per_sec:
        value -= min(health.tokens_per_sec / 50.0, 3.0)     # fast matters most for chat
    return value


def rank(candidates: Iterable[dict], task: str) -> Tuple[List[dict], List[str]]:
    """Candidates best-first for the task, and a note for each one left out."""
    kept, skipped = [], []
    with _lock:
        _load()
    for candidate in candidates:
        provider, model = candidate.get("provider", ""), candidate.get("model", "")
        if not usable_for_text(model):
            continue
        reason = blocked(provider, model)
        if reason:
            skipped.append("%s/%s skipped: %s" % (provider, model, plain_reason(reason)))
            continue
        kept.append(candidate)
    kept.sort(key=lambda c: score(c.get("provider", ""), c.get("model", ""), task))
    return kept, skipped


def report() -> List[dict]:
    """Every model's record here, for Settings and the performance panel."""
    with _lock:
        _load()
        now = time.time()
        rows = []
        for key, health in sorted(_health.items()):
            provider, _, model = key.partition("/")
            rows.append({"provider": provider, "model": model, **health.as_dict(),
                         "blocked_for_s": max(0, round(health.blocked_until - now)),
                         "blocked_reason": plain_reason(health.last_kind) if health.blocked_until > now else ""})
        return rows
