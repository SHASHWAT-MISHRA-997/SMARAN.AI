"""When a provider is reported unusable, say what was actually tried.

Found while testing Design Studio output against a real cloud key. The build
reported:

    gemini could not be used: gemini-3.1-pro is over a usage limit

and fell back to the local model. But a direct probe of the same key showed the
third candidate, gemma-4-31b-it, answering perfectly well. Three models were
tried; only the first one's reason survived, because failures were collected
with setdefault.

The first reason is the least informative one available. Candidates are ranked
best-first, so the top of the list is exactly where preview gating, rate limits
and free-tier quotas of zero live. Reporting only that reads as "your provider
is unusable" and sends someone to check a key that is fine.

Still one line per provider - three dead NVIDIA models saying the same thing
three times is what the original comment was rightly avoiding - but the line
now carries the count and the distinct reasons.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import site_builder  # noqa: E402


@pytest.fixture
def three_gemini(monkeypatch):
    """A provider whose first model is rate limited and whose others are not."""
    models = [
        site_builder.Generator("gemini", "gemini-3.1-pro-preview", "k"),
        site_builder.Generator("gemini", "gemini-3.8-flash", "k"),
        site_builder.Generator("gemini", "gemma-4-31b-it", "k"),
    ]
    monkeypatch.setattr(site_builder, "candidates", lambda: (models, []))
    return models


def reasons_for(monkeypatch, answers_impl):
    monkeypatch.setattr(site_builder, "answers", answers_impl)
    document, why = site_builder.build("Shop", "a page")
    assert document is None
    return why


def test_the_reason_is_not_only_the_first_models(three_gemini, monkeypatch):
    def answers_impl(generator):
        return False, {
            "gemini-3.1-pro-preview": "over a usage limit",
            "gemini-3.8-flash": "answered HTTP 503",
            "gemma-4-31b-it": "answered HTTP 500",
        }[generator.model]

    why = reasons_for(monkeypatch, answers_impl)
    assert "over a usage limit" in why
    assert "503" in why, (
        "only the first model's reason survived: %r" % why
    )


def test_it_says_how_many_were_tried(three_gemini, monkeypatch):
    why = reasons_for(monkeypatch, lambda g: (False, "answered HTTP 404"))
    assert "3 models tried" in why, why


def test_identical_reasons_are_not_repeated_three_times(three_gemini, monkeypatch):
    """What the one-line-per-provider rule was protecting against."""
    why = reasons_for(monkeypatch, lambda g: (False, "answered HTTP 404"))
    assert why.count("answered HTTP 404") == 1, why


def test_a_working_later_model_is_used_rather_than_reported(three_gemini, monkeypatch):
    """The case that prompted this: the third candidate answers."""
    monkeypatch.setattr(site_builder, "answers",
                        lambda g: (g.model == "gemma-4-31b-it", "no"))
    monkeypatch.setattr(site_builder, "_complete",
                        lambda g, s, u: ("<html><body>ok</body></html>", ""))
    document, how = site_builder.build("Shop", "a page")
    assert document is not None
    assert "gemma-4-31b-it" in how, how


def test_a_provider_skipped_outright_keeps_its_own_message(monkeypatch):
    """A refused key is not 'n models tried' - none were."""
    monkeypatch.setattr(site_builder, "candidates", lambda: (
        [site_builder.Generator("nvidia", "some/model", "k")],
        ["anthropic was skipped: the saved key was refused"],
    ))
    why = reasons_for(monkeypatch, lambda g: (False, "answered HTTP 404"))
    assert "anthropic was skipped: the saved key was refused" in why
    assert "anthropic could not be used" not in why


def test_more_than_two_distinct_reasons_are_summarised(monkeypatch):
    monkeypatch.setattr(site_builder, "candidates", lambda: (
        [site_builder.Generator("nvidia", "m%d" % n, "k") for n in range(4)], []))
    why = reasons_for(monkeypatch, lambda g: (False, "failed as %s" % g.model))
    assert "and 2 more" in why, why
