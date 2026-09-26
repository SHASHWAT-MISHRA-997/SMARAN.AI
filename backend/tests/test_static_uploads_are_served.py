"""A picture saved for chat can be fetched by the page that shows it."""
import os
import uuid

from fastapi.testclient import TestClient


def test_a_generated_picture_is_served():
    from app.config import settings
    from app.main import app

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    name = "gen_test_%s.jpg" % uuid.uuid4().hex[:8]
    path = os.path.join(settings.UPLOAD_DIR, name)
    with open(path, "wb") as handle:
        handle.write(b"\xff\xd8\xff\xe0test")
    try:
        response = TestClient(app, client=("127.0.0.1", 50123)).get("/api/static/" + name)
        assert response.status_code == 200 and response.content.startswith(b"\xff\xd8\xff")
    finally:
        os.remove(path)
