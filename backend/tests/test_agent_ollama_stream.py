"""The agent reads Ollama's answer as it is written, with a window big enough for the run."""
import io
import json

from app.agent import models


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def serve(monkeypatch, lines, sent):
    def fake_urlopen(request, timeout):
        sent.update(json.loads(request.data))
        return FakeResponse(b"".join(json.dumps(x).encode() + b"\n" for x in lines))
    monkeypatch.setattr(models.urllib.request, "urlopen", fake_urlopen)


def test_streamed_answer_is_joined_and_context_is_sized(monkeypatch):
    sent = {}
    serve(monkeypatch, [{"message": {"content": "Hello "}}, {"message": {"content": "there"}}, {"done": True}], sent)
    assert models._ollama("m", [{"role": "user", "content": "hi"}]) == "Hello there"
    assert sent["stream"] is True and sent["options"]["num_ctx"] == 16384


def test_a_tool_call_ends_the_turn_and_keeps_its_closing_tag(monkeypatch):
    sent = {}
    serve(monkeypatch, [{"message": {"content": '<tool_call name="read_file">\n<path>a.py</path>\n'}},
                        {"done": True}], sent)
    text = models._ollama("m", [{"role": "user", "content": "go"}])
    assert sent["options"]["stop"] == ["</tool_call>"]
    assert text.endswith("</tool_call>")
    from app.agent.loop import parse_tool_call
    assert parse_tool_call(text)["arguments"]["path"] == "a.py"
