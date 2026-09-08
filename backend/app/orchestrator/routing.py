"""Choosing which model does a task, and what to do when it will not.

Three rules shape this, and they are worth stating because each of them came
from a way this can go wrong:

Nothing paid is ever chosen for you. A director that quietly falls back from
the local model to a metered API turns a free run into a bill, and the person
who set it running finds out afterwards. Paid providers are used only when
they have been named in the request, and `allow_paid` says so in as many
words. A run with no local model and no permission stops and explains itself
rather than reaching for a key it can see.

A failure is not a fallback. Falling back on a bad API key means every task
takes the slow path to the same refusal. Only failures that another provider
could plausibly survive - busy, rate limited, unreachable, timed out - move
the work; a 401 or a 400 stops that provider being tried again in this run.

The reason is always carried. When a task ends up on a different model than
was asked for, `fallback_reason` says which provider was tried first and what
it said. A result that arrives without explanation is indistinguishable from
one that was routed correctly, and the UI has to be able to tell the user
which model actually did the work.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

from app.agent.models import OPENAI_COMPATIBLE, ProviderError

logger = logging.getLogger("orchestrator.routing")

#: Providers that bill per token. Ollama is absent because it runs on the
#: machine doing the asking, which is the whole reason it is the default.
PAID_PROVIDERS = frozenset({
    "openai", "anthropic", "gemini", "groq", "openrouter", "deepseek", "nvidia",
})

#: What each role wants from a model. Used to order candidates, never to
#: invent one: a run with a single provider uses it for everything.
ROLE_CAPABILITY = {
    "ui": "long_context",
    "feature": "code",
    "backend": "code",
    "review": "reasoning",
}

#: After this many consecutive failures a provider sits out the rest of the
#: run. Without it, twelve tasks against a dead endpoint means twelve waits
#: for the same timeout.
UNHEALTHY_AFTER = 3

#: Bounded, and small. Retrying a busy provider forever is how a cancelled run
#: keeps running.
MAX_ATTEMPTS_PER_TASK = 3
BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 30.0


class NoProviderAvailable(RuntimeError):
    """Nothing is configured, or everything configured has been ruled out."""


def is_chat_model(entry: dict) -> bool:
    """Can this Ollama model hold a conversation?

    Worth asking, because the answer is often no. A machine with Ollama
    installed for the document search has `nomic-embed-text` and nothing else,
    and offering that as a Director model produces a run that fails on its
    first call with something unhelpful about embeddings.
    """
    capabilities = entry.get("capabilities") or []
    if capabilities:
        return "completion" in capabilities or "chat" in capabilities
    # Older Ollama builds report no capabilities, so the model family is the
    # only signal left. The embedding ones are BERT-shaped.
    family = ((entry.get("details") or {}).get("family") or "").lower()
    name = (entry.get("name") or "").lower()
    return "bert" not in family and "embed" not in name


def local_chat_models(url: str = "", timeout: float = 5.0) -> List[dict]:
    """The local models that could actually run a task."""
    import json
    import urllib.request

    if not url:
        from app.config import settings
        url = settings.OLLAMA_URL

    try:
        with urllib.request.urlopen(
                url.rstrip("/") + "/api/tags", timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:                                   # noqa: BLE001
        logger.info("Could not ask Ollama what it has: %s", exc)
        return []

    return [{"model": entry.get("name", ""),
             "size": entry.get("size"),
             "parameters": (entry.get("details") or {}).get("parameter_size")}
            for entry in (data.get("models") or [])
            if entry.get("name") and is_chat_model(entry)]


@dataclass
class Candidate:
    """One model the director is permitted to use."""

    provider: str                    # "" or "ollama" means the local engine
    model: str
    api_key: str = ""
    capabilities: Sequence[str] = ()
    label: str = ""

    def __post_init__(self) -> None:
        if not self.label:
            self.label = "%s/%s" % (self.provider or "local", self.model)

    @property
    def paid(self) -> bool:
        return self.provider in PAID_PROVIDERS

    def as_dict(self) -> dict:
        # Deliberately no api_key. This is serialised into run events, which
        # are written to disk and shown in the UI.
        return {"provider": self.provider or "local", "model": self.model,
                "label": self.label, "paid": self.paid,
                "capabilities": list(self.capabilities)}


@dataclass
class Health:
    """What this run has learned about a provider so far."""

    failures: int = 0
    rate_limited_until: float = 0.0
    #: Set when a provider fails in a way no retry can fix, such as a bad key.
    ruled_out: Optional[str] = None

    def usable(self, now: float) -> bool:
        return self.ruled_out is None and self.failures < UNHEALTHY_AFTER \
            and now >= self.rate_limited_until


@dataclass
class Attempt:
    """One call to one provider, kept whether it worked or not."""

    provider: str
    model: str
    ok: bool
    error: Optional[str] = None
    status: Optional[int] = None
    seconds: float = 0.0

    def as_dict(self) -> dict:
        return {"provider": self.provider, "model": self.model, "ok": self.ok,
                "error": self.error, "status": self.status,
                "seconds": round(self.seconds, 2)}


@dataclass
class Completion:
    """A reply, and an honest account of how it was obtained."""

    text: str
    candidate: Candidate
    attempts: List[Attempt] = field(default_factory=list)
    fallback_reason: Optional[str] = None
    simulated: bool = False

    def as_dict(self) -> dict:
        return {"owner": self.candidate.label,
                "provider": self.candidate.provider or "local",
                "model": self.candidate.model,
                "attempts": [a.as_dict() for a in self.attempts],
                "fallback_reason": self.fallback_reason,
                "simulated": self.simulated}


def select_candidates(configured: Sequence[Candidate], *,
                      allow_paid: bool = False) -> List[Candidate]:
    """The models this run may use, in no particular order yet.

    Filtering happens here rather than at call time so that a run which is
    about to refuse everything says so before it starts, instead of failing
    task by task.
    """
    allowed = [c for c in configured if allow_paid or not c.paid]
    if not allowed:
        paid_names = sorted({c.label for c in configured if c.paid})
        if paid_names:
            raise NoProviderAvailable(
                "The only models configured are metered ones (%s). Nothing "
                "paid is used unless the run asks for it, so either start a "
                "local model in Ollama or re-run with paid providers allowed."
                % ", ".join(paid_names))
        raise NoProviderAvailable(
            "No model is configured. Start a local model in Ollama, or add a "
            "provider key in Settings and allow paid providers for this run.")
    return allowed


def order_for_role(candidates: Sequence[Candidate], role: str) -> List[Candidate]:
    """Best-suited first, local before metered at equal suitability."""
    wanted = ROLE_CAPABILITY.get(role, "code")

    def rank(candidate: Candidate) -> tuple:
        return (
            0 if wanted in candidate.capabilities else 1,
            1 if candidate.paid else 0,       # free first, always
            candidate.label,
        )

    return sorted(candidates, key=rank)


def backoff_seconds(attempt: int, *, jitter: Callable[[], float] = random.random) -> float:
    """Exponential, capped, with jitter.

    The jitter matters more than it looks: several tasks rate-limited by one
    provider at the same moment would otherwise all wake at the same moment
    and rate-limit it again.
    """
    raw = BACKOFF_BASE_SECONDS * (2 ** max(0, attempt - 1))
    return round(min(BACKOFF_CAP_SECONDS, raw) * (0.5 + jitter()), 2)


class Router:
    """Runs one task's prompt against the candidates until one answers."""

    def __init__(self, candidates: Sequence[Candidate], *,
                 call: Optional[Callable] = None,
                 sleep: Optional[Callable] = None,
                 timeout: float = 180.0) -> None:
        if not candidates:
            raise NoProviderAvailable("The router was given no candidates.")
        self.candidates = list(candidates)
        self.timeout = timeout
        self._health: Dict[str, Health] = {c.label: Health() for c in self.candidates}
        # Injected so the tests can drive failures without a network, and so
        # the deterministic offline mode can stand in for a provider.
        self._call = call or self._real_call
        self._sleep = sleep or asyncio.sleep

    @staticmethod
    async def _real_call(messages: List[Dict], candidate: Candidate,
                         timeout: float) -> str:
        from app.agent.models import complete

        # attempts=1: the retry policy lives here, where it can also decide to
        # change provider rather than merely wait.
        return await asyncio.wait_for(
            complete(messages, model=candidate.model,
                     provider=candidate.provider, api_key=candidate.api_key,
                     attempts=1),
            timeout=timeout)

    def health_report(self) -> dict:
        now = time.time()
        return {label: {"failures": h.failures,
                        "ruled_out": h.ruled_out,
                        "usable": h.usable(now),
                        "rate_limited_for": max(0, round(h.rate_limited_until - now, 1))}
                for label, h in self._health.items()}

    def usable(self, role: str) -> List[Candidate]:
        now = time.time()
        return [c for c in order_for_role(self.candidates, role)
                if self._health[c.label].usable(now)]

    async def complete(self, messages: List[Dict], *, role: str = "feature",
                       is_cancelled: Optional[Callable[[], bool]] = None) -> Completion:
        """One reply, from the first candidate that manages to give one."""
        cancelled = is_cancelled or (lambda: False)
        attempts: List[Attempt] = []
        first_failure: Optional[str] = None

        for round_index in range(1, MAX_ATTEMPTS_PER_TASK + 1):
            if cancelled():
                raise asyncio.CancelledError()

            available = self.usable(role)
            if not available:
                break

            for candidate in available:
                if cancelled():
                    raise asyncio.CancelledError()

                health = self._health[candidate.label]
                started = time.time()
                try:
                    text = await self._call(messages, candidate, self.timeout)
                except asyncio.CancelledError:
                    raise
                except asyncio.TimeoutError:
                    health.failures += 1
                    attempts.append(Attempt(candidate.provider, candidate.model,
                                            False, "Timed out after %gs" % self.timeout,
                                            seconds=time.time() - started))
                    first_failure = first_failure or "%s timed out" % candidate.label
                    continue
                except ProviderError as exc:
                    seconds = time.time() - started
                    attempts.append(Attempt(candidate.provider, candidate.model,
                                            False, str(exc)[:400], exc.status, seconds))
                    first_failure = first_failure or "%s: %s" % (candidate.label, exc)
                    if exc.rate_limited:
                        # Not a failure of the provider, a request to wait.
                        health.rate_limited_until = time.time() + backoff_seconds(round_index)
                    elif not exc.worth_retrying:
                        # A key or a request that is wrong stays wrong.
                        health.ruled_out = str(exc)[:200]
                    else:
                        health.failures += 1
                    continue
                except Exception as exc:                    # noqa: BLE001
                    seconds = time.time() - started
                    health.failures += 1
                    attempts.append(Attempt(candidate.provider, candidate.model,
                                            False, str(exc)[:400], seconds=seconds))
                    first_failure = first_failure or "%s: %s" % (candidate.label, exc)
                    continue

                if not (text or "").strip():
                    # An empty reply is a failure that looks like a success,
                    # and downstream it becomes a task that "finished" having
                    # produced no files.
                    health.failures += 1
                    attempts.append(Attempt(candidate.provider, candidate.model,
                                            False, "Returned an empty reply",
                                            seconds=time.time() - started))
                    first_failure = first_failure or "%s returned nothing" % candidate.label
                    continue

                attempts.append(Attempt(candidate.provider, candidate.model, True,
                                        seconds=time.time() - started))
                health.failures = 0
                reason = None
                if len(attempts) > 1:
                    reason = "Moved to %s after %s" % (candidate.label, first_failure)
                return Completion(text=text.strip(), candidate=candidate,
                                  attempts=attempts, fallback_reason=reason)

            # Every candidate refused this round. Wait before going again, but
            # only if going again could help.
            if round_index < MAX_ATTEMPTS_PER_TASK and self.usable(role):
                await self._sleep(backoff_seconds(round_index))

        ruled = [f"{label}: {h.ruled_out}" for label, h in self._health.items()
                 if h.ruled_out]
        detail = "; ".join(ruled) if ruled else (first_failure or "no provider answered")
        raise NoProviderAvailable(
            "No model completed this task after %d attempts. %s"
            % (len(attempts), detail))
