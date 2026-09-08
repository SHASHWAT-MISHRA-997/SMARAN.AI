"""Provider routing: failure, rate limits, timeouts, fallback, cancellation.

No network. Every provider here is a stub that fails in a chosen way, which
is the only way to test a rate limit without waiting for a real one.
"""

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.agent.models import ProviderError                     # noqa: E402
from app.orchestrator.routing import (                         # noqa: E402
    BACKOFF_CAP_SECONDS, Candidate, MAX_ATTEMPTS_PER_TASK, NoProviderAvailable,
    Router, UNHEALTHY_AFTER, backoff_seconds, order_for_role, select_candidates,
)

LOCAL = Candidate(provider="", model="qwen2.5-coder", capabilities=["code"])
PAID = Candidate(provider="openai", model="gpt-4o", capabilities=["code", "reasoning"])
PAID_TWO = Candidate(provider="anthropic", model="claude", capabilities=["code"])


def run(coro):
    return asyncio.run(coro)


class Stub:
    """A provider that behaves however the test needs it to."""

    def __init__(self, **behaviour):
        self.behaviour = behaviour          # label -> reply or exception
        self.calls = []

    async def __call__(self, messages, candidate, timeout):
        self.calls.append(candidate.label)
        outcome = self.behaviour.get(candidate.label, "ok from " + candidate.label)
        if isinstance(outcome, list):
            outcome = outcome.pop(0) if outcome else "ok from " + candidate.label
        if isinstance(outcome, BaseException):
            raise outcome
        if callable(outcome):
            return outcome()
        return outcome


async def no_sleep(_seconds):
    """Backoff without the waiting, so the suite stays fast."""
    return None


def router(candidates, stub, **kw):
    return Router(candidates, call=stub, sleep=no_sleep, **kw)


# ---- nothing paid is chosen for you -----------------------------------------

def test_paid_providers_are_not_used_unless_asked_for():
    assert select_candidates([LOCAL, PAID]) == [LOCAL]


def test_paid_providers_are_used_when_the_run_asks():
    assert select_candidates([LOCAL, PAID], allow_paid=True) == [LOCAL, PAID]


def test_a_run_with_only_paid_models_stops_and_says_so():
    with pytest.raises(NoProviderAvailable, match="metered"):
        select_candidates([PAID, PAID_TWO])


def test_a_run_with_nothing_configured_says_that_instead():
    with pytest.raises(NoProviderAvailable, match="No model is configured"):
        select_candidates([])


def test_free_models_are_preferred_at_equal_suitability():
    ordered = order_for_role([PAID, LOCAL], "feature")
    assert ordered[0] is LOCAL


def test_capability_outranks_cost():
    """A reviewer wants reasoning; only the paid model claims it here."""
    ordered = order_for_role([LOCAL, PAID], "review")
    assert ordered[0] is PAID


# ---- failure, fallback, and the reason --------------------------------------

def test_a_working_provider_answers_without_a_fallback_reason():
    result = run(router([LOCAL], Stub()).complete([{"role": "user", "content": "hi"}]))
    assert result.text == "ok from local/qwen2.5-coder"
    assert result.fallback_reason is None
    assert [a.ok for a in result.attempts] == [True]


def test_a_busy_provider_moves_the_work_and_explains_why():
    stub = Stub(**{"local/qwen2.5-coder": ProviderError("busy", status=503, kind="http")})
    result = run(router([LOCAL, PAID], stub, ).complete([], role="feature"))
    assert result.candidate is PAID
    assert "Moved to openai/gpt-4o" in result.fallback_reason
    assert "busy" in result.fallback_reason
    assert [a.ok for a in result.attempts] == [False, True]


def test_a_bad_key_rules_a_provider_out_instead_of_retrying_it():
    """A 401 fails identically forever; trying it twelve times helps nobody.

    The review role is used throughout these two tests because it is the one
    that ranks the paid model first - otherwise the free model answers and the
    paid one is never reached, which is itself the behaviour asserted above.
    """
    stub = Stub(**{"openai/gpt-4o": ProviderError("bad key", status=401, kind="http")})
    router_ = router([PAID, LOCAL], stub)
    run(router_.complete([], role="review"))
    assert router_.health_report()["openai/gpt-4o"]["ruled_out"]
    assert stub.calls.count("openai/gpt-4o") == 1

    run(router_.complete([], role="review"))
    assert stub.calls.count("openai/gpt-4o") == 1, "a ruled-out provider is not tried again"


def test_a_rate_limit_waits_rather_than_ruling_the_provider_out():
    stub = Stub(**{"openai/gpt-4o": ProviderError("slow down", status=429, kind="http")})
    router_ = router([PAID, LOCAL], stub)
    result = run(router_.complete([], role="review"))
    assert result.candidate is LOCAL
    health = router_.health_report()["openai/gpt-4o"]
    assert health["ruled_out"] is None
    assert health["rate_limited_for"] > 0
    assert not health["usable"]


def test_a_timeout_is_a_failure_that_falls_back():
    stub = Stub(**{"local/qwen2.5-coder": asyncio.TimeoutError()})
    result = run(router([LOCAL, PAID], stub, timeout=5).complete([]))
    assert result.candidate is PAID
    assert result.attempts[0].error == "Timed out after 5s"


def test_an_empty_reply_is_treated_as_a_failure():
    """A task that 'finished' with no output is worse than one that failed."""
    stub = Stub(**{"local/qwen2.5-coder": "   "})
    result = run(router([LOCAL, PAID], stub).complete([]))
    assert result.candidate is PAID
    assert result.attempts[0].error == "Returned an empty reply"


def test_a_provider_that_keeps_failing_is_dropped_for_the_rest_of_the_run():
    stub = Stub(**{"local/qwen2.5-coder": ProviderError("busy", status=503, kind="http")})
    router_ = router([LOCAL, PAID], stub)
    for _ in range(UNHEALTHY_AFTER):
        run(router_.complete([]))
    assert not router_.health_report()["local/qwen2.5-coder"]["usable"]


def test_when_everything_fails_the_error_names_what_happened():
    stub = Stub(**{
        "local/qwen2.5-coder": ProviderError("engine down", kind="unreachable"),
        "openai/gpt-4o": ProviderError("bad key", status=401, kind="http"),
    })
    with pytest.raises(NoProviderAvailable) as caught:
        run(router([LOCAL, PAID], stub).complete([]))
    assert "bad key" in str(caught.value)


def test_retries_are_bounded():
    stub = Stub(**{"local/qwen2.5-coder": ProviderError("busy", status=503, kind="http")})
    with pytest.raises(NoProviderAvailable):
        run(router([LOCAL], stub).complete([]))
    # Stops when the provider is marked unhealthy, never more than the cap.
    assert len(stub.calls) <= MAX_ATTEMPTS_PER_TASK
    assert len(stub.calls) == UNHEALTHY_AFTER


# ---- cancellation -----------------------------------------------------------

def test_cancellation_is_honoured_before_any_provider_is_called():
    stub = Stub()
    with pytest.raises(asyncio.CancelledError):
        run(router([LOCAL], stub).complete([], is_cancelled=lambda: True))
    assert stub.calls == [], "a cancelled run must not spend a request"


def test_cancellation_stops_the_fallback_chain():
    """Cancelled midway: the first provider is tried, the second never is."""
    state = {"cancelled": False}

    class Cancelling(Stub):
        async def __call__(self, messages, candidate, timeout):
            state["cancelled"] = True
            return await super().__call__(messages, candidate, timeout)

    stub = Cancelling(**{"local/qwen2.5-coder": ProviderError("busy", status=503,
                                                             kind="http")})
    with pytest.raises(asyncio.CancelledError):
        run(router([LOCAL, PAID], stub).complete(
            [], is_cancelled=lambda: state["cancelled"]))
    assert stub.calls == ["local/qwen2.5-coder"]


# ---- backoff ----------------------------------------------------------------

def test_backoff_grows_and_is_capped():
    assert backoff_seconds(1, jitter=lambda: 0.5) == 2.0
    assert backoff_seconds(2, jitter=lambda: 0.5) == 4.0
    assert backoff_seconds(99, jitter=lambda: 0.5) == BACKOFF_CAP_SECONDS


def test_backoff_is_jittered_so_waiters_do_not_wake_together():
    assert backoff_seconds(3, jitter=lambda: 0.0) != backoff_seconds(3, jitter=lambda: 1.0)


# ---- what gets written down -------------------------------------------------

def test_a_candidate_never_serialises_its_api_key():
    serialised = Candidate(provider="openai", model="gpt-4o",
                           api_key="sk-secret-value").as_dict()
    assert "sk-secret-value" not in repr(serialised)
    assert "api_key" not in serialised
