"""A proposal ID is not authentication: its creator receives it directly.

The acceptance audit called IDs unguessable, but an anonymous LAN caller
could open a folder, propose a change and apply the returned ID. Keep the
process-global desktop workspace local until remote ownership is implemented.
All files here are disposable; no installed application state is used.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.workspace import routes
from app.workspace.core import Workspace


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    workspace = Workspace()
    monkeypatch.setattr(routes, "workspace", workspace)
    (tmp_path / "note.txt").write_text("original", encoding="utf-8")
    workspace.open(str(tmp_path))
    app = FastAPI()
    app.include_router(routes.router)
    return app, workspace, tmp_path


def test_network_cannot_open_propose_and_apply(isolated):
    app, workspace, folder = isolated
    client = TestClient(app, client=("192.168.1.50", 54321))
    opened = client.post("/api/workspace/open", json={"folder": str(folder)})
    proposed = client.post("/api/workspace/propose/write", json={
        "path": "note.txt", "text": "unapproved network edit"})
    if proposed.status_code == 200:
        client.post("/api/workspace/apply", json={"id": proposed.json()["id"]})
    assert (folder / "note.txt").read_text() == "original"
    assert opened.status_code == proposed.status_code == 403


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/status", None), ("GET", "/browse", None),
    ("GET", "/tree", None), ("GET", "/file?path=note.txt", None),
    ("GET", "/pending", None), ("GET", "/history", None),
    ("POST", "/close", None),
    ("POST", "/propose/delete", {"path": "note.txt"}),
    ("POST", "/apply", {"id": "known-id"}),
    ("POST", "/reject", {"id": "known-id"}),
])
def test_network_cannot_read_or_mutate_shared_workspace(isolated, method, path, body):
    app, workspace, folder = isolated
    client = TestClient(app, client=("192.168.1.50", 54321))
    response = client.request(method, "/api/workspace" + path, json=body,
                              headers={"X-Forwarded-For": "127.0.0.1"})
    assert response.status_code == 403
    assert workspace.root == folder


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"])
def test_local_owner_can_still_apply_a_proposal(isolated, host):
    app, workspace, folder = isolated
    client = TestClient(app, client=(host, 54321))
    proposed = client.post("/api/workspace/propose/write", json={
        "path": "note.txt", "text": "approved local edit"})
    assert proposed.status_code == 200
    applied = client.post("/api/workspace/apply", json={"id": proposed.json()["id"]})
    assert applied.status_code == 200
    assert (folder / "note.txt").read_text() == "approved local edit"
