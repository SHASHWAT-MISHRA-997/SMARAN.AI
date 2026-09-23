""""What's on my screen?" by voice: looked at, never answered from the words.

The endpoint existed and nothing spoken reached it - the question went to the
chat model, which cannot see. And without a local vision model it answered
"install llava" even on a machine with a working Gemini key.
"""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app import screen_vision
from app.main import app, get_current_user, is_screen_question


@pytest.mark.parametrize("said", [
    "what's on my screen",
    "What is on the screen right now?",
    "can you see my screen",
    "look at my screen and tell me what this error means",
    "mere screen par kya hai",
    "screen par kya chal raha hai",
    "screen dekho aur batao",
    "स्क्रीन पर क्या है",
])
def test_screen_questions_are_recognised(said):
    assert is_screen_question(said)


@pytest.mark.parametrize("said", [
    "take a screenshot",
    "what is the weather today",
    "turn off the screen saver",
    "play music",
])
def test_other_things_are_not(said):
    assert not is_screen_question(said)


def test_the_next_question_is_about_the_same_screen():
    assert is_screen_question("and what does this button do", follow_up=True)
    assert is_screen_question("ye error kya hai", follow_up=True)
    assert not is_screen_question("and what does this button do", follow_up=False)
    assert not is_screen_question("play kesariya", follow_up=True)


def test_cloud_models_that_can_see_are_picked_from_what_is_listed():
    listed = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash-lite",
              "text-embedding-004", "gemini-2.5-flash-preview-tts", "imagen-3"]
    picked = screen_vision.pick_cloud_models("gemini", listed)
    assert picked == ["gemini-2.0-flash-lite", "gemini-2.5-flash"]
    assert screen_vision.pick_cloud_models("groq", ["llama-3.3-70b-versatile"]) == []
    assert screen_vision.pick_cloud_models(
        "groq", ["meta-llama/llama-4-scout-17b-16e-instruct"]) == ["meta-llama/llama-4-scout-17b-16e-instruct"]


@pytest.fixture
def client(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, username="owner")
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def test_voice_route_looks_and_answers(client, monkeypatch):
    asked = []

    async def fake_look(question):
        asked.append(question)
        return {"answer": "A YouTube video is playing.", "model": "gemini-2.5-flash", "where": "gemini"}

    monkeypatch.setattr(main_module, "_look_at_screen", fake_look)
    res = client.post("/api/desktop/voice-command",
                      json={"text": "what's on my screen", "language": "en"})
    body = res.json()
    assert body["handled"] is True and body["action"] == "ask_screen"
    assert body["message"] == "A YouTube video is playing."
    assert asked == ["what's on my screen"]

    res = client.post("/api/desktop/voice-command",
                      json={"text": "what does this button do", "language": "en", "screen_followup": True})
    assert res.json()["action"] == "ask_screen"


def test_with_nothing_that_can_see_it_says_what_to_set_up(client, monkeypatch):
    async def fake_look(question):
        return {"error": "I can't see your screen yet: no model that can see is set up."}

    monkeypatch.setattr(main_module, "_look_at_screen", fake_look)
    body = client.post("/api/desktop/voice-command",
                       json={"text": "can you see my screen", "language": "en"}).json()
    assert body["handled"] is True and body["success"] is False
    assert "can't see your screen" in body["message"]


def test_each_provider_is_sent_the_picture_and_read_back(monkeypatch):
    """The request shape each provider needs, and reading its answer."""
    import httpx

    seen = {}

    def handler(request: httpx.Request):
        import json as _json
        body = _json.loads(request.content)
        seen[request.url.host] = body
        if "generativelanguage" in request.url.host:
            part = body["contents"][0]["parts"][0]["inline_data"]
            assert part["mime_type"] in ("image/jpeg", "image/png") and part["data"]
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Seven unread."}]}}]})
        if "anthropic" in request.url.host:
            assert body["messages"][0]["content"][0]["type"] == "image"
            return httpx.Response(200, json={"content": [{"type": "text", "text": "Seven unread."}]})
        block = body["messages"][1]["content"][0]
        assert block["type"] == "image_url" and block["image_url"]["url"].startswith("data:image/")
        return httpx.Response(200, json={"choices": [{"message": {"content": "Seven unread."}}]})

    real_client = httpx.Client
    monkeypatch.setattr(screen_vision.httpx, "Client",
                        lambda *a, **k: real_client(transport=httpx.MockTransport(handler)))
    for provider in ("gemini", "anthropic", "openai", "openrouter", "groq"):
        answer, problem = screen_vision._ask_cloud(provider, "some-model", "k", "How many?", "aGk=", "image/jpeg")
        assert (answer, problem) == ("Seven unread.", ""), provider
