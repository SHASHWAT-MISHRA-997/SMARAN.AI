"""The Director's HTTP surface, exercised through real requests.

Routed through the whole app rather than the router alone, because FastAPI
0.139 includes routers lazily: `app.routes` does not list them until a request
resolves one, and a test that counted them would pass while the endpoint 404s.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from fastapi import FastAPI                                  # noqa: E402
from fastapi.testclient import TestClient                    # noqa: E402

from app.orchestrator.routes import router                   # noqa: E402


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_roles_describe_how_work_is_split(client):
    body = client.get("/api/orchestrator/roles").json()
    assert {r["name"] for r in body["roles"]} == {"ui", "feature", "backend", "review"}
    assert "claims the files" in body["note"]


def test_a_run_without_a_folder_is_refused(client):
    response = client.post("/api/orchestrator/runs",
                           json={"request": "build something", "root": ""})
    assert response.status_code == 400
    assert "project folder" in response.json()["detail"]


def test_a_paid_provider_is_not_used_without_permission(client):
    """The rule that stops a free run quietly becoming a metered one."""
    response = client.post("/api/orchestrator/runs", json={
        "request": "build something", "root": ".",
        "models": [{"provider": "openai", "model": "gpt-4o", "api_key": "sk-test"}],
    })
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "metered" in detail
    assert "sk-test" not in detail, "the key must not come back in an error"


def test_a_run_with_no_models_and_none_installed_says_so(client, monkeypatch):
    """Naming no model is only an error when there is nothing installed.

    This used to assert the refusal unconditionally, because naming no model
    always meant having none. It does not any more: an unnamed run falls back
    to whatever Ollama already has, so the refusal now depends on the machine.
    Left as it was, this test passed or failed according to whether Ollama
    happened to be running beside the suite.
    """
    from app.orchestrator import routes as orchestrator_routes
    monkeypatch.setattr(orchestrator_routes, "local_chat_models", lambda: [])

    response = client.post("/api/orchestrator/runs",
                           json={"request": "build something", "root": ".", "models": []})
    assert response.status_code == 400
    assert "No model is configured" in response.json()["detail"]


def test_a_run_with_no_models_uses_an_installed_one(client, monkeypatch):
    """The other half, and the defect that prompted the change: a machine with
    a local model was told to go and start a local model."""
    from app.orchestrator import routes as orchestrator_routes
    monkeypatch.setattr(orchestrator_routes, "local_chat_models",
                        lambda: [{"model": "qwen2.5-coder:7b"}])

    response = client.post("/api/orchestrator/runs",
                           json={"request": "build something", "root": ".", "models": []})
    assert response.status_code != 400 or "No model is configured" not in \
        response.json().get("detail", ""), (
        "an installed local model was not used when none was named"
    )


def test_an_unknown_run_is_a_404_not_an_empty_run(client):
    assert client.get("/api/orchestrator/runs/nope").status_code == 404
    assert client.post("/api/orchestrator/runs/nope/cancel").status_code == 404


def test_an_empty_request_is_rejected_by_validation(client):
    assert client.post("/api/orchestrator/runs",
                       json={"request": "", "root": "."}).status_code == 422


def test_concurrency_is_bounded(client):
    response = client.post("/api/orchestrator/runs", json={
        "request": "x", "root": ".", "concurrency": 99,
        "models": [{"model": "local"}]})
    assert response.status_code == 422
