"""Auto routing orders cloud models for the task; limits push to the next one."""
from app import main


def test_task_kinds():
    assert main._task_kind("fix this python function, it throws KeyError") == "code"
    assert main._task_kind("prove that the square root of 2 is irrational, step by step") == "reasoning"
    assert main._task_kind("hi, kaise ho?") == "quick"
    assert main._task_kind("tell me about the history of the Mughal empire and its art in some depth please") == "general"


def _c(provider, model):
    return {"provider": provider, "model": model, "api_key": "k"}


def test_code_goes_to_a_coder_first(monkeypatch):
    monkeypatch.setattr(main, "_route_in_cooldown", lambda p, m: False)
    routes = [_c("gemini", "gemini-3.1-flash"), _c("groq", "llama-3.1-8b-instant"), _c("openrouter", "qwen/qwen3-coder:free")]
    assert main._order_for_task(routes, "code")[0]["model"] == "qwen/qwen3-coder:free"
    assert main._order_for_task(routes, "quick")[0]["model"] == "llama-3.1-8b-instant"


def test_reasoning_prefers_pro_but_a_limited_one_goes_last(monkeypatch):
    routes = [_c("gemini", "gemini-3.1-flash"), _c("gemini", "gemini-3.1-pro"), _c("openrouter", "deepseek/deepseek-r1:free")]
    monkeypatch.setattr(main, "_route_in_cooldown", lambda p, m: False)
    assert main._order_for_task(routes, "reasoning")[0]["model"] == "gemini-3.1-pro"
    # Pro hit its limit a moment ago (cooldown): the thinking model answers instead.
    monkeypatch.setattr(main, "_route_in_cooldown", lambda p, m: m == "gemini-3.1-pro")
    assert main._order_for_task(routes, "reasoning")[0]["model"] == "deepseek/deepseek-r1:free"


def test_general_keeps_provider_order():
    routes = [_c("gemini", "a"), _c("groq", "b")]
    assert main._order_for_task(routes, "general") == routes
