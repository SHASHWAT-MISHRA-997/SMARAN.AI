"""Where a picture is made is chosen by Settings, tried in order, and said."""
import base64
import os

import pytest

from app import media_router, model_router


class FakeResponse:
    def __init__(self, status, data=None, headers=None):
        self.status_code = status
        self._data = data or {}
        self.headers = headers or {}
        self.text = str(self._data)

    def json(self):
        return self._data


JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(model_router, "_path", lambda: str(tmp_path / "route_health.json"))
    monkeypatch.setattr(model_router, "_health", {})
    monkeypatch.setattr(model_router, "_loaded", False)
    monkeypatch.setattr(media_router, "_prefs_path", lambda: str(tmp_path / "media_prefs.json"))
    monkeypatch.setenv("NVIDIA_API_KEY", "test-key")
    # Never unload the real Ollama's models from a test.
    monkeypatch.setattr(media_router, "free_gpu_for_media", lambda note=None: [])
    # A small graphics card, whatever this machine really has.
    monkeypatch.setattr(media_router, "local_first", lambda: False)

    import app.imaging.engine as engine
    monkeypatch.setattr(engine, "evaluate", lambda model, hw: {"runnable": True})

    def local_generate(**kwargs):
        with open(kwargs["output_path"], "wb") as handle:
            handle.write(b"\x89PNG local")
        return {"path": kwargs["output_path"], "width": 512, "height": 512, "seed": 1}
    monkeypatch.setattr(engine, "generate", local_generate)
    yield


def use_http(monkeypatch, response):
    import httpx
    calls = []

    def post(url, headers=None, json=None, timeout=None):
        calls.append((url, json))
        return response
    monkeypatch.setattr(httpx, "post", post)
    return calls


def test_automatic_uses_the_hosted_model_and_says_so(tmp_path, monkeypatch):
    calls = use_http(monkeypatch, FakeResponse(200, {"artifacts": [
        {"base64": base64.b64encode(JPEG).decode(), "finishReason": "SUCCESS"}]}))
    made = media_router.generate_image("a fox", str(tmp_path / "a.png"), width=1280, height=720)
    assert made["where"] == "cloud" and made["made_by"] == "FLUX.1-dev (NVIDIA)"
    assert made["path"].endswith(".jpg") and open(made["path"], "rb").read() == JPEG
    assert (calls[0][1]["width"], calls[0][1]["height"]) == (1280, 768)   # within 768-1344, multiples of 64


def test_a_hosted_model_out_of_credit_falls_back_and_is_passed_over_next_time(tmp_path, monkeypatch):
    use_http(monkeypatch, FakeResponse(402, {"detail": "Payment required"}))
    made = media_router.generate_image("a fox", str(tmp_path / "b.png"))
    assert made["where"] == "local"
    assert "FLUX.1-dev (NVIDIA): Payment required" in made["fallback_reason"]
    sources = media_router.image_sources()
    flux = [s for s in sources if s["model"] == "black-forest-labs/flux.1-dev"][0]
    assert not flux["usable"] and "credit" in flux["why"]


def test_local_only_never_contacts_a_service(tmp_path, monkeypatch):
    calls = use_http(monkeypatch, FakeResponse(200, {}))
    media_router.save_prefs({"image_source": "local"})
    made = media_router.generate_image("a fox", str(tmp_path / "c.png"))
    assert made["where"] == "local" and calls == []


def test_a_safety_refusal_is_about_the_prompt_not_the_model(tmp_path, monkeypatch):
    use_http(monkeypatch, FakeResponse(200, {"artifacts": [{"base64": "", "finishReason": "CONTENT_FILTERED"}]}))
    made = media_router.generate_image("a fox", str(tmp_path / "d.png"))
    assert made["where"] == "local"
    assert model_router.blocked("nvidia", "black-forest-labs/flux.1-dev") is None


def test_without_a_key_the_cloud_is_simply_not_offered(tmp_path, monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY")
    calls = use_http(monkeypatch, FakeResponse(200, {}))
    made = media_router.generate_image("a fox", str(tmp_path / "e.png"))
    assert made["where"] == "local" and calls == [] and made["fallback_reason"] == ""


def test_a_bad_setting_is_refused():
    with pytest.raises(ValueError):
        media_router.save_prefs({"image_source": "everywhere"})


def test_a_local_model_draws_at_its_own_size_in_the_shape_asked_for():
    assert media_router.native_size("sd15", 1024, 1024) == (512, 512)
    assert media_router.native_size("sd15", 1344, 768) == (512, 320)
    assert media_router.native_size("sd15", 512, 512) == (512, 512)


def test_no_seed_means_a_new_picture_each_time(tmp_path, monkeypatch):
    calls = use_http(monkeypatch, FakeResponse(200, {"artifacts": [
        {"base64": base64.b64encode(JPEG).decode(), "finishReason": "SUCCESS"}]}))
    media_router.generate_image("a fox", str(tmp_path / "f.png"))
    media_router.generate_image("a fox", str(tmp_path / "g.png"))
    assert calls[0][1]["seed"] != calls[1][1]["seed"]
    media_router.generate_image("a fox", str(tmp_path / "h.png"), seed=7)
    assert calls[2][1]["seed"] == 7


def test_a_server_error_is_tried_once_more_before_moving_on(tmp_path, monkeypatch):
    import httpx
    monkeypatch.setattr(media_router, "RETRY_PAUSE", 0)
    answers = [FakeResponse(504, {"detail": "errored"}),
               FakeResponse(200, {"artifacts": [{"base64": base64.b64encode(JPEG).decode(), "finishReason": "SUCCESS"}]})]
    monkeypatch.setattr(httpx, "post", lambda *a, **k: answers.pop(0))
    made = media_router.generate_image("a fox", str(tmp_path / "r.png"))
    assert made["where"] == "cloud" and made["made_by"] == "FLUX.1-dev (NVIDIA)"


def test_out_of_credit_is_not_retried(tmp_path, monkeypatch):
    calls = use_http(monkeypatch, FakeResponse(402, {"detail": "Payment required"}))
    media_router.generate_image("a fox", str(tmp_path / "s.png"))
    assert len([c for c in calls if "flux.1-dev" in c[0]]) == 1


def test_a_strong_graphics_card_puts_this_computer_first(tmp_path, monkeypatch):
    calls = use_http(monkeypatch, FakeResponse(200, {}))
    monkeypatch.setattr(media_router, "local_first", lambda: True)
    kinds = [s["kind"] for s in media_router.image_sources()]
    assert kinds[0] == "local" and "cloud" in kinds
    made = media_router.generate_image("a fox", str(tmp_path / "a.png"))
    assert made["where"] == "local" and calls == []


def test_the_reason_for_the_order_is_given(monkeypatch):
    class Card:
        gpu_name, vram_total_gb = "RTX 2060", 6.0
    monkeypatch.setattr("app.video.hardware.probe", lambda *a: Card())
    small = media_router.hardware()
    assert not small["strong"] and small["automatic"].startswith("Cloud first")
    Card.vram_total_gb = 24.0
    big = media_router.hardware()
    assert big["strong"] and big["automatic"].startswith("This computer first")


def test_the_catalogue_says_what_fits_and_invents_nothing():
    from app import media_catalog
    video = media_catalog.catalogue("video", 6.0)
    by_id = {m["id"]: m for m in video["models"]}
    assert by_id["cogvideox-2b"]["fits"] == "yes"
    assert by_id["wan22-a14b"]["fits"] == "no" and "Replicate" in by_id["wan22-a14b"]["why"]
    assert by_id["ltx-video-13b"]["fits"] == "unknown"          # its README gives no figure
    assert all(m["source"] and m["repo"].startswith("https://") for m in video["models"])
    assert {c["name"] for c in video["closed"]} >= {"Kling", "Seedance", "Runway Gen-4.5"}
    assert media_catalog.catalogue("image", 24.0)["tier"] == "strong"


def test_smaran_s_own_check_outranks_a_missing_figure():
    from app import media_catalog
    rows = {m["id"]: m for m in media_catalog.catalogue("video", 6.0, {"ltx-video-2b": True})["models"]}
    assert rows["ltx-video-2b"]["fits"] == "yes"
    busy = media_catalog.fit({"min_vram_gb": 5.0, "where": ["smaran"]}, 6.0, "Needs 5 GB; 2 GB is free.")
    assert busy["fits"] == "not now" and "2 GB is free" in busy["why"]
    assert "video" not in media_catalog.summary("image", 6.0)
