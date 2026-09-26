"""Cloud video through Replicate: model list, inputs by schema, download, stop."""
import pytest

from app.video import hosted


def _details(fields):
    return {"latest_version": {"openapi_schema": {"components": {"schemas": {"Input": {
        "properties": {f: {} for f in fields}}}}}}}


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "r8_test")
    monkeypatch.setattr(hosted.time, "sleep", lambda s: None)
    calls = []
    state = {"polls": 0}

    def call(method, path, payload=None, timeout=60):
        calls.append((method, path, payload))
        if path == "/collections/text-to-video":
            return {"models": [{"owner": "kwaivgi", "name": "kling-v2.1", "run_count": 10},
                               {"owner": "minimax", "name": "hailuo-02", "run_count": 50}]}
        if path.startswith("/models/") and method == "GET":
            return _details(["prompt", "duration", "aspect_ratio"])
        if path.endswith("/predictions") and method == "POST":
            return {"id": "p1"}
        if path == "/predictions/p1":
            state["polls"] += 1
            return {"status": "succeeded" if state["polls"] > 1 else "processing",
                    "output": "https://replicate.delivery/xyz/out.mp4"}
        return {}
    monkeypatch.setattr(hosted, "_call", call)
    return calls


def test_models_are_listed_most_used_first(fake):
    assert [m["id"] for m in hosted.list_models()] == ["minimax/hailuo-02", "kwaivgi/kling-v2.1"]


def test_only_inputs_the_model_takes_are_sent(fake):
    url = hosted.generate("a cat surfing", model="kwaivgi/kling-v2.1",
                          options={"duration": 5, "aspect_ratio": "16:9", "resolution": "1080p"})
    assert url.startswith("https://replicate.delivery/")
    sent = next(p for m, path, p in fake if path.endswith("/predictions"))
    assert sent == {"input": {"prompt": "a cat surfing", "duration": 5, "aspect_ratio": "16:9"}}


def test_stop_cancels_the_run(fake):
    with pytest.raises(hosted.HostedVideoError, match="Stopped"):
        hosted.generate("x", model="a/b", should_stop=lambda: True)
    assert ("POST", "/predictions/p1/cancel", None) in fake


def test_download_only_from_replicate(tmp_path):
    with pytest.raises(hosted.HostedVideoError, match="unexpected address"):
        hosted.download("https://evil.example.com/x.mp4", str(tmp_path / "v.mp4"))
    with pytest.raises(hosted.HostedVideoError):
        hosted.download("http://replicate.delivery/x.mp4", str(tmp_path / "v.mp4"))
