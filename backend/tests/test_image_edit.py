"""Changing a picture by instruction (image-to-image), on this computer."""
import base64
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.test_image_file_route import PNG


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import media_router
    from app.config import settings
    from app.imaging import engine, routes

    monkeypatch.setattr(settings, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(routes, "evaluate", lambda model, hw: {"runnable": True})
    monkeypatch.setattr(routes, "probe", lambda: None)
    monkeypatch.setattr(media_router, "free_gpu_for_media", lambda note=None: [])
    seen = {}

    def fake_edit(prompt, source, out, **kwargs):
        seen.update(prompt=prompt, source=source, source_bytes=open(source, "rb").read(), **kwargs)
        open(out, "wb").write(PNG)
        return {"path": out, "width": 512, "height": 512, "strength": kwargs["strength"], "model": kwargs["model_id"]}
    monkeypatch.setattr(engine, "edit", fake_edit)
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app, raise_server_exceptions=False), seen, tmp_path


def wait(client, job_id):
    for _ in range(100):
        record = client.get("/api/image/job/%s" % job_id).json()
        if record["status"] != "running":
            return record
        time.sleep(0.02)
    raise AssertionError("the job never finished")


def test_a_picture_made_here_can_be_changed(client):
    http, seen, tmp_path = client
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "abcdef123456.png").write_bytes(PNG)
    res = http.post("/api/image/edit", json={"prompt": "make it snow", "source_job": "abcdef123456", "strength": 0.4})
    record = wait(http, res.json()["job_id"])
    assert record["status"] == "completed" and record["result"]["edited_from"] == "abcdef123456"
    assert seen["strength"] == 0.4 and seen["source_bytes"] == PNG
    assert http.get("/api/image/file/%s" % res.json()["job_id"]).status_code == 200


def test_an_uploaded_picture_is_checked_used_and_removed(client):
    http, seen, tmp_path = client
    data = "data:image/png;base64," + base64.b64encode(PNG).decode()
    record = wait(http, http.post("/api/image/edit", json={"prompt": "a hat", "image_base64": data}).json()["job_id"])
    assert record["status"] == "completed" and seen["source_bytes"] == PNG
    assert not [p for p in (tmp_path / "images").iterdir() if p.name.endswith("-source")]


def test_what_is_not_a_picture_is_refused(client):
    http, _seen, _tmp = client
    fake = base64.b64encode(b"MZ\x90\x00 not a picture").decode()
    assert http.post("/api/image/edit", json={"prompt": "x", "image_base64": fake}).status_code == 400
    assert http.post("/api/image/edit", json={"prompt": "x"}).status_code == 400
    assert http.post("/api/image/edit", json={"prompt": "x", "source_job": "../../etc"}).status_code == 422
    assert http.post("/api/image/edit", json={"prompt": "x", "source_job": "abcdef123456"}).status_code == 404
