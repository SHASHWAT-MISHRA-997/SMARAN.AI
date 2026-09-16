"""A run with no model named must use the one that is already installed.

Found by driving /api/orchestrator against a running backend. Asking it to plan
anything came back:

    No model is configured. Start a local model in Ollama, or add a provider
    key in Settings and allow paid providers for this run.

On a machine with qwen2.5-coder:7b running in Ollama - which
/api/orchestrator/models listed correctly on the same request. The advice was
to go and do the thing the user had already done.

The cause was that candidates were built only from the models the caller named.
The UI names one, so the failure never showed there; anything else calling the
API got a refusal that contradicted the endpoint next to it.

Only local models are picked up this way. Nothing from Ollama is metered, so
the fallback cannot start spending money on the caller's behalf - which is the
property the second half of this file holds down.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.orchestrator import routes  # noqa: E402
from app.orchestrator.routing import PAID_PROVIDERS, Candidate, select_candidates  # noqa: E402

INSTALLED = [
    {"model": "qwen2.5-coder:7b", "size": 4683087561, "parameters": "7.6B"},
    {"model": "llama3.1:8b", "size": 4900000000, "parameters": "8B"},
]


@pytest.fixture
def installed(monkeypatch):
    monkeypatch.setattr(routes, "local_chat_models", lambda: list(INSTALLED))


@pytest.fixture
def nothing_installed(monkeypatch):
    monkeypatch.setattr(routes, "local_chat_models", lambda: [])


def test_naming_no_model_uses_what_is_installed(installed):
    got = routes._candidates([])
    assert [c.model for c in got] == [e["model"] for e in INSTALLED]


def test_the_fallback_only_reaches_for_local_models(installed):
    for candidate in routes._candidates([]):
        assert candidate.provider not in PAID_PROVIDERS, candidate.label
        assert not candidate.paid, (
            "the fallback selected a metered model without the run asking"
        )


def test_the_fallback_survives_being_offered_to_the_filter(installed):
    """select_candidates is what raised the misleading error. With the
    fallback in place it must accept them even with paid providers refused."""
    allowed = select_candidates(routes._candidates([]), allow_paid=False)
    assert allowed, "a machine with local models was told none is configured"


def test_a_named_model_still_wins(installed):
    """The fallback must not override an explicit choice."""
    class Choice:
        provider = "ollama"
        model = "deepseek-r1:1.5b"
        api_key = ""
        capabilities = ()

    got = routes._candidates([Choice()])
    assert [c.model for c in got] == ["deepseek-r1:1.5b"]


def test_blank_model_names_are_not_treated_as_a_choice(installed):
    """A caller sending an empty slot gets the fallback, not an empty run."""
    class Blank:
        provider = "ollama"
        model = "   "
        api_key = ""
        capabilities = ()

    assert [c.model for c in routes._candidates([Blank()])] == [
        e["model"] for e in INSTALLED]


def test_with_nothing_installed_the_message_is_still_correct(nothing_installed):
    """The original advice is right in the one case it was written for."""
    from app.orchestrator.routing import NoProviderAvailable

    with pytest.raises(NoProviderAvailable) as caught:
        select_candidates(routes._candidates([]), allow_paid=False)
    assert "Ollama" in str(caught.value)


def test_a_paid_only_run_is_still_refused_without_permission(nothing_installed):
    """Nothing here may weaken the opt-in on metered providers."""
    from app.orchestrator.routing import NoProviderAvailable

    paid = [Candidate(provider="openai", model="gpt-4o", api_key="x")]
    with pytest.raises(NoProviderAvailable):
        select_candidates(paid, allow_paid=False)

    assert select_candidates(paid, allow_paid=True) == paid
