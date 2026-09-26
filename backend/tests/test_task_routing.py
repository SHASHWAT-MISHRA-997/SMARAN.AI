"""Auto routing orders cloud models for the task; limits push to the next one (app.model_router)."""
import pytest

from app import model_router as mr


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "_path", lambda: str(tmp_path / "route_health.json"))
    monkeypatch.setattr(mr, "_health", {})
    monkeypatch.setattr(mr, "_loaded", False)


def test_task_kinds():
    assert mr.classify("fix this python function, it throws KeyError") == "code"
    assert mr.classify("prove that the square root of 2 is irrational, step by step") == "reasoning"
    assert mr.classify("hi, kaise ho?") == "chat"


def _c(provider, model):
    return {"provider": provider, "model": model, "api_key": "k"}


def test_code_goes_to_a_coder_first_and_chat_to_a_fast_model():
    routes = [_c("gemini", "gemini-3.1-flash"), _c("groq", "llama-3.1-8b-instant"), _c("openrouter", "qwen/qwen3-coder:free")]
    assert mr.rank(routes, "code")[0][0]["model"] == "qwen/qwen3-coder:free"
    assert mr.rank(routes, "chat")[0][0]["model"] == "gemini-3.1-flash"


def test_reasoning_prefers_a_thinking_model_and_a_limited_one_steps_aside():
    routes = [_c("gemini", "gemini-3.1-flash"), _c("gemini", "gemini-3.1-pro"), _c("openrouter", "deepseek/deepseek-r1:free")]
    assert mr.rank(routes, "reasoning")[0][0]["model"] == "deepseek/deepseek-r1:free"
    # It hit its rate limit a moment ago: the next thinking model answers instead.
    mr.record_failure("openrouter", "deepseek/deepseek-r1:free", 429, "rate limited")
    ranked, skipped = mr.rank(routes, "reasoning")
    assert ranked[0]["model"] == "gemini-3.1-pro" and "rate limited" in skipped[0]
