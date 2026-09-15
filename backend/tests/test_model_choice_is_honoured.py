"""A model the user picked by hand must be the model that answers.

Reported from Design Studio: the picker read ``qwen2.5-coder:7b`` - installed,
served by Ollama, sitting right there - and the result was

    No cloud model could answer. openrouter/z-ai/glm-5.2:free rejected the key
    (wrong, expired, or lacking access); ... Add or fix the provider key in
    Model Catalog & Matrix, or run a local model instead.

advising exactly what had already been asked for.

The cause was a single condition. Cloud routing was entered whenever *any*
saved provider key existed:

    if chat_req.cloud_provider or auto_candidates:

``auto_candidates`` is derived from the keys on file, so one stale OpenRouter
key was enough to overrule a deliberate local choice on every turn. The picker
was decorative in the worst way: it looked like it worked, and the failure
blamed the user's configuration.

An explicit cloud choice still wins. This only stops saved keys from silently
outranking a local model the user selected.
"""

import inspect
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

MAIN = BACKEND / "app" / "main.py"


def _routing_source() -> str:
    source = MAIN.read_text(encoding="utf-8")
    start = source.index("auto_candidates = await _auto_cloud_candidates()")
    return source[start:start + 2000]


def test_saved_keys_alone_no_longer_force_cloud_routing():
    body = _routing_source()
    assert "if chat_req.cloud_provider or auto_candidates:" not in body, (
        "one saved provider key still overrules an explicitly chosen local model"
    )


def test_an_explicitly_chosen_local_model_is_recognised():
    body = _routing_source()
    assert "chose_local_model" in body
    # It is only an explicit choice when the client actually named a model.
    assert 'raw_model != "auto"' in body
    assert "selected_model" in body


def test_an_explicit_cloud_choice_still_wins():
    """Turning the guard into "never use cloud" would be the opposite bug."""
    body = _routing_source()
    assert "chat_req.cloud_provider or (" in body, (
        "a deliberate cloud selection must still route to cloud"
    )


def test_the_guard_requires_the_model_to_be_installed():
    """selected_model is empty when the named model is not installed, so an
    unavailable local pick still falls through to whatever can answer."""
    body = _routing_source()
    guard = body[body.index("chose_local_model"):body.index("if chat_req.cloud_provider or (")]
    assert "bool(" in guard
    assert "selected_model" in guard


def test_auto_routing_is_not_treated_as_a_deliberate_choice():
    """"auto" means the app decides, and cloud is a legitimate answer then."""
    body = _routing_source()
    assert 'raw_model != "auto"' in body
    assert "and raw_model" in body


def test_the_condition_is_still_a_single_branch():
    """Two branches deciding this independently is how it drifted before."""
    source = MAIN.read_text(encoding="utf-8")
    entries = re.findall(r"if chat_req\.cloud_provider or", source)
    assert len(entries) == 1, (
        "cloud routing is entered from more than one place: %d" % len(entries)
    )
