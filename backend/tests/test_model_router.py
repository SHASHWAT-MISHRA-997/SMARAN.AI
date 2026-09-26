"""The right model for the work, and an honest record of what each one did."""
import pytest

from app import model_router as mr


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "_path", lambda: str(tmp_path / "route_health.json"))
    monkeypatch.setattr(mr, "_health", {})
    monkeypatch.setattr(mr, "_loaded", False)
    yield


@pytest.mark.parametrize("prompt,section,web,task", [
    ("hi, how are you?", "chat", False, "chat"),
    ("Fix this Python function that throws a KeyError", "chat", False, "code"),
    ("Prove that the square root of 2 is irrational", "chat", False, "reasoning"),
    ("Write a 600 word blog post about monsoon travel", "chat", False, "writing"),
    ("Latest news on Mars rovers", "chat", True, "search"),
    ("A landing page for a chai cafe", "design", False, "design"),
    ("say hello", "code", False, "code"),
    ("what is in this image?", "chat", False, "vision"),
])
def test_the_kind_of_work_is_read_from_the_request(prompt, section, web, task):
    assert mr.classify(prompt, section, web=web) == task


def candidates(*names):
    return [{"provider": p, "model": m} for p, m in (n.split("/", 1) for n in names)]


def test_code_goes_to_a_coder_and_chat_to_a_fast_model():
    pool = candidates("groq/llama-3.1-8b-instant", "gemini/gemini-3.5-flash",
                      "deepseek/deepseek-coder", "cerebras/gpt-oss-120b")
    code, _ = mr.rank(pool, "code")
    assert code[0]["model"] == "deepseek-coder"
    chat, _ = mr.rank(pool, "chat")
    assert chat[0]["model"] == "gemini-3.5-flash"
    reasoning, _ = mr.rank(pool, "reasoning")
    assert reasoning[0]["model"] == "gpt-oss-120b"


def test_models_that_cannot_write_text_are_never_offered():
    ranked, _ = mr.rank(candidates("gemini/text-embedding-004", "groq/whisper-large-v3",
                                   "gemini/gemini-3.5-flash"), "chat")
    assert [c["model"] for c in ranked] == ["gemini-3.5-flash"]


@pytest.mark.parametrize("status,message,kind", [
    (402, "Payment required", "billing"),
    (400, "You exceeded your current quota", "billing"),
    (401, "invalid key", "auth"),
    (429, "slow down", "rate"),
    (404, "model not found", "unsupported"),
    (503, "overloaded", "server"),
])
def test_failures_are_sorted_by_what_they_mean(status, message, kind):
    assert mr.failure_kind(status, message) == kind


def test_out_of_credit_stays_out_for_hours_and_is_explained():
    mr.record_failure("cerebras", "gpt-oss-120b", 402, "Payment required")
    ranked, skipped = mr.rank(candidates("cerebras/gpt-oss-120b", "gemini/gemini-3.5-flash"), "code")
    assert [c["model"] for c in ranked] == ["gemini-3.5-flash"]
    assert skipped == ["cerebras/gpt-oss-120b skipped: out of credit or quota on that account"]
    assert mr.COOLDOWN["billing"] >= 3600


def test_a_new_key_clears_what_the_old_one_was_refused_for():
    mr.record_failure("cerebras", "gpt-oss-120b", 401, "bad key")
    assert mr.blocked("cerebras", "gpt-oss-120b") == "auth"
    mr.forget_provider("cerebras")
    assert mr.blocked("cerebras", "gpt-oss-120b") is None


def test_what_happened_here_moves_a_model_down():
    pool = candidates("groq/llama-3.3-70b-versatile", "nvidia/meta/llama-3.3-70b-instruct")
    for _ in range(4):
        mr.record_success("groq", "llama-3.3-70b-versatile", first_token_ms=300, tokens_per_sec=300)
        mr.record_failure("nvidia", "meta/llama-3.3-70b-instruct", 503, "busy")
    mr._health[mr._key("nvidia", "meta/llama-3.3-70b-instruct")].blocked_until = 0
    ranked, _ = mr.rank(pool, "chat")
    assert ranked[0]["provider"] == "groq"


def test_the_record_survives_a_restart(tmp_path, monkeypatch):
    mr.record_failure("cerebras", "gpt-oss-120b", 402, "Payment required")
    mr._save(force=True)
    monkeypatch.setattr(mr, "_health", {})
    monkeypatch.setattr(mr, "_loaded", False)
    assert mr.blocked("cerebras", "gpt-oss-120b") == "billing"


def test_speech_autocomplete_and_agent_models_never_answer_text():
    for model in ("canopylabs/orpheus-v1-english", "mistral-code-fim-latest", "deep-research-pro-preview-12-2025",
                  "antigravity-preview-latest", "nvidia/nemotron-3.5-content-safety"):
        assert not mr.usable_for_text(model), model
    assert mr.usable_for_text("fimbria-7b") and mr.usable_for_text("gpt-oss-120b")


def test_a_code_model_is_the_last_choice_for_a_question_and_newer_wins_a_tie():
    assert mr.score("m", "codestral-2508", "search") > mr.score("g", "openai/gpt-oss-120b", "search")
    assert mr.score("m", "codestral-2508", "code") < mr.score("m", "mistral-medium", "code")
    assert mr.score("g", "gemini-3.8-pro", "code") < mr.score("g", "gemini-3-pro-preview", "code")
    assert mr.score("g", "gemini-3.8-flash", "chat") == mr.score("g", "gemini-3-flash-preview", "chat")


def test_naming_a_language_is_not_a_coding_request():
    assert mr.classify("What changed in Python 3.14 and when is 3.15 due?", web=True) == "search"
    assert mr.classify("What changed in Python 3.14?") == "chat"
    assert mr.classify("write a python function to sort a list") == "code"
    assert mr.classify("fix this exception in my react app") == "code"
    assert mr.classify("here is the traceback, what now?") == "code"
