"""Cloud images through Replicate: the text-to-image list, and a PNG on disk."""
import time

from PIL import Image

from app.imaging import routes
from app.video import hosted


def test_images_list_their_own_collection(monkeypatch):
    seen = []
    monkeypatch.setattr(hosted, "_call", lambda m, path, p=None, timeout=60: seen.append(path) or {
        "models": [{"owner": "black-forest-labs", "name": "flux-schnell", "run_count": 5}]})
    assert hosted.list_models("text-to-image")[0]["id"] == "black-forest-labs/flux-schnell"
    assert seen == ["/collections/text-to-image"]


def test_a_webp_from_replicate_is_saved_as_png(tmp_path, monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "r8_x")
    sent = {}

    def fake_generate(prompt, note, model="", options=None, kind="video", should_stop=None):
        sent.update(model=model, options=options, kind=kind)
        return "https://replicate.delivery/x/out.webp"

    def fake_download(url, path):
        Image.new("RGB", (64, 48), "orange").save(path, "WEBP")
    monkeypatch.setattr(hosted, "generate", fake_generate)
    monkeypatch.setattr(hosted, "download", fake_download)
    job = "abcdef123456"
    routes._jobs[job] = {"id": job, "status": "running", "messages": [], "result": None, "error": None,
                         "started": time.time(), "updated": time.time()}
    out = tmp_path / f"{job}.png"
    routes._run_cloud(job, routes.CloudImageRequest(prompt="a kite", model="black-forest-labs/flux-schnell",
                                                    aspect_ratio="1:1"), str(out))
    assert routes._jobs[job]["status"] == "completed", routes._jobs[job]["error"]
    with Image.open(out) as img:
        assert img.format == "PNG" and img.size == (64, 48)
    assert sent["kind"] == "image" and sent["options"]["aspect_ratio"] == "1:1"
