import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.models import User, ChatSession, ChatMessage, CodingTask, UserMemory
from app.main import app
from app.desktop_agent import DesktopAgent, detect_desktop_intent
from app.conversation_memory import retrieve_conversations


from sqlalchemy.pool import StaticPool

@pytest.fixture
def sync_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # User 1
    u1 = User(
        id=1,
        username="developer_one",
        email="dev1@smaran.ai",
        password_hash="pw1",
        session_token="token_user_1",
        session_expires=datetime.now() + timedelta(days=7),
        is_approved=True,
    )
    # User 2
    u2 = User(
        id=2,
        username="developer_two",
        email="dev2@smaran.ai",
        password_hash="pw2",
        session_token="token_user_2",
        session_expires=datetime.now() + timedelta(days=7),
        is_approved=True,
    )
    db.add_all([u1, u2])
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield db
    app.dependency_overrides.pop(get_db, None)
    db.close()


def test_coding_task_lifecycle_and_optimistic_locking(sync_db):
    client = TestClient(app)
    headers = {"Authorization": "Bearer token_user_1"}

    # 1. Create a coding task from Desktop SMARAN Code
    task_id = "task_ui_refactor_1"
    payload = {
        "expected_revision": 0,
        "project_id": "smaran-core",
        "title": "Refactor Sidebar and Memory",
        "entries": [{"kind": "you", "title": "You", "body": "Refactor navigation"}],
        "history": [{"role": "user", "content": "Refactor navigation"}],
        "archived": False,
        "deleted": False,
    }
    res = client.put(f"/api/code/tasks/{task_id}", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["id"] == task_id
    assert data["revision"] == 1
    assert data["title"] == "Refactor Sidebar and Memory"
    assert len(data["entries"]) == 1

    # 2. Get task from VS Code extension
    res = client.get(f"/api/code/tasks/{task_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["revision"] == 1

    # 3. Continue task in VS Code extension (revision increment to 2)
    payload_v2 = {
        "expected_revision": 1,
        "project_id": "smaran-core",
        "title": "Refactor Sidebar and Memory",
        "entries": [
            {"kind": "you", "title": "You", "body": "Refactor navigation"},
            {"kind": "says", "title": "SMARAN", "body": "Added section switcher"},
        ],
        "history": [
            {"role": "user", "content": "Refactor navigation"},
            {"role": "assistant", "content": "Added section switcher"},
        ],
        "archived": False,
        "deleted": False,
    }
    res = client.put(f"/api/code/tasks/{task_id}", json=payload_v2, headers=headers)
    assert res.status_code == 200
    assert res.json()["revision"] == 2
    assert len(res.json()["entries"]) == 2

    # 4. Conflict detection: stale write with expected_revision 1 fails with 409
    import copy
    stale_payload = copy.deepcopy(payload_v2)
    stale_payload["expected_revision"] = 1
    stale_payload["entries"].append({"kind": "you", "title": "You", "body": "Conflict attempt"})
    res_conflict = client.put(f"/api/code/tasks/{task_id}", json=stale_payload, headers=headers)
    assert res_conflict.status_code == 409

    # 5. Idempotent retry: resending exact same values succeeds without conflict
    res_retry = client.put(f"/api/code/tasks/{task_id}", json=payload_v2, headers=headers)
    assert res_retry.status_code == 200
    assert res_retry.json()["revision"] == 2

    # 6. Tombstone deletion from either surface
    delete_payload = dict(payload_v2, expected_revision=2, deleted=True)
    res_del = client.put(f"/api/code/tasks/{task_id}", json=delete_payload, headers=headers)
    assert res_del.status_code == 200
    assert res_del.json()["deleted"] is True
    assert res_del.json()["entries"] == []  # Payload cleared for tombstone


def test_coding_sync_account_isolation(sync_db):
    client = TestClient(app)
    h1 = {"Authorization": "Bearer token_user_1"}
    h2 = {"Authorization": "Bearer token_user_2"}

    # User 1 creates task
    task_id = "user1_private_task"
    payload = {
        "expected_revision": 0,
        "project_id": "proj1",
        "title": "Confidential Algorithm",
        "entries": [],
        "history": [],
    }
    res = client.put(f"/api/code/tasks/{task_id}", json=payload, headers=h1)
    assert res.status_code == 200

    # User 2 cannot access or list User 1's task
    res_get = client.get(f"/api/code/tasks/{task_id}", headers=h2)
    assert res_get.status_code == 404

    res_list = client.get("/api/code/tasks", headers=h2)
    assert res_list.status_code == 200
    assert all(t["id"] != task_id for t in res_list.json()["tasks"])


def test_section_separation_and_movement(sync_db):
    client = TestClient(app)
    headers = {"Authorization": "Bearer token_user_1"}

    # 1. Create a chat session (default section='chat')
    res_chat = client.post("/api/chat/sessions", json={"title": "Personal Discussion", "section": "chat"}, headers=headers)
    assert res_chat.status_code == 200
    chat_id = res_chat.json()["id"]
    assert res_chat.json()["section"] == "chat"

    # 2. Create a coding session (section='code')
    res_code = client.post("/api/chat/sessions", json={"title": "Rust Compiler Optimization", "section": "code"}, headers=headers)
    assert res_code.status_code == 200
    code_id = res_code.json()["id"]
    assert res_code.json()["section"] == "code"

    # 3. List sessions filtered by section
    chat_list = client.get("/api/chat/sessions?section=chat", headers=headers).json()
    assert any(s["id"] == chat_id for s in chat_list)
    assert all(s["id"] != code_id for s in chat_list)

    code_list = client.get("/api/chat/sessions?section=code", headers=headers).json()
    assert any(s["id"] == code_id for s in code_list)
    assert all(s["id"] != chat_id for s in code_list)

    # 4. Move conversation between sections
    move_res = client.put(f"/api/chat/sessions/{chat_id}/section", json={"section": "code"}, headers=headers)
    assert move_res.status_code == 200
    assert move_res.json()["section"] == "code"

    updated_code_list = client.get("/api/chat/sessions?section=code", headers=headers).json()
    assert any(s["id"] == chat_id for s in updated_code_list)


def test_memory_scoping_between_chat_and_code(sync_db):
    # Personal chat session
    sync_db.add(ChatSession(id="sess_chat_1", user_id=1, title="Personal Medical Advice", section="chat"))
    sync_db.add(ChatMessage(session_id="sess_chat_1", role="user", content="My doctor prescribed vitamin D3 60000 IU."))
    sync_db.add(ChatMessage(session_id="sess_chat_1", role="assistant", content="Take vitamin D3 once weekly after a meal."))

    # Code session
    sync_db.add(ChatSession(id="sess_code_1", user_id=1, title="FastAPI Architecture", section="code"))
    sync_db.add(ChatMessage(session_id="sess_code_1", role="user", content="We decided to use Redis for task caching."))
    sync_db.add(ChatMessage(session_id="sess_code_1", role="assistant", content="Redis cache layer configured on port 6379."))

    sync_db.commit()

    # Querying from a coding session with section='code' must NOT leak personal chat memories
    code_memories = retrieve_conversations(sync_db, user_id=1, current_session_id="sess_new_code", query="Redis cache", section="code")
    assert any("Redis" in m["content"] for m in code_memories)
    assert all("vitamin" not in m["content"].lower() for m in code_memories)

    # Personal chat retrieval with section='chat' retrieves chat memories and excludes code memories
    chat_memories = retrieve_conversations(sync_db, user_id=1, current_session_id="sess_new_chat", query="vitamin doctor", section="chat")
    assert any("vitamin" in m["content"].lower() for m in chat_memories)
    assert all("Redis" not in m["content"] for m in chat_memories)


@pytest.mark.anyio
async def test_computer_use_policy_enforcement():
    # 1. Disabled computer use blocks execution
    blocked_res = await DesktopAgent.execute("open_website", {"name": "google", "computer_use_enabled": False})
    assert blocked_res["success"] is False
    assert blocked_res.get("blocked") is True
    assert "disabled in settings" in blocked_res["error"]

    # 2. Destructive action blocked by allow_destructive policy
    destructive_res = await DesktopAgent.execute("empty_recycle_bin", {"allow_destructive": "block"}, confirmed=True)
    assert destructive_res["success"] is False
    assert destructive_res.get("blocked") is True
    assert "Destructive system actions are blocked" in destructive_res["error"]


def test_youtube_channel_intent_detection():
    # User regression test: "Shashwat Mishra Techie YouTube channel open karo"
    phrase = "Shashwat Mishra Techie YouTube channel open karo"
    intent = detect_desktop_intent(phrase)
    assert intent is not None
    assert intent["action"] == "open_youtube_channel"
    assert "Shashwat Mishra Techie" in intent["params"]["channel"]

    # English phrasing: "open Shashwat Mishra Techie YouTube channel"
    phrase_en = "open Shashwat Mishra Techie YouTube channel"
    intent_en = detect_desktop_intent(phrase_en)
    assert intent_en is not None
    assert intent_en["action"] == "open_youtube_channel"
    assert "Shashwat Mishra Techie" in intent_en["params"]["channel"]


def test_memory_crud_and_search_and_export(sync_db):
    client = TestClient(app)
    headers = {"Authorization": "Bearer token_user_1"}

    # 1. Create a memory fact
    res_create = client.post("/api/memory", json={"fact": "Prefers TailwindCSS and React for dashboards", "category": "user_preference"}, headers=headers)
    assert res_create.status_code == 200
    mem_id = res_create.json()["id"]
    assert res_create.json()["fact"] == "Prefers TailwindCSS and React for dashboards"

    # 2. Search memory
    res_search = client.get("/api/memory/search?q=TailwindCSS", headers=headers)
    assert res_search.status_code == 200
    assert len(res_search.json()) >= 1
    assert res_search.json()[0]["id"] == mem_id

    # 3. Update / correct memory fact
    res_update = client.put(f"/api/memory/{mem_id}", json={"fact": "Prefers Vanilla CSS and clean semantic HTML for performance"}, headers=headers)
    assert res_update.status_code == 200
    assert "Vanilla CSS" in res_update.json()["fact"]

    # 4. Export memories
    res_export = client.get("/api/memory/export", headers=headers)
    assert res_export.status_code == 200
    assert res_export.json()["count"] >= 1
    assert any(m["id"] == mem_id for m in res_export.json()["memories"])

    # 5. Delete individual memory
    res_del = client.delete(f"/api/memory/{mem_id}", headers=headers)
    assert res_del.status_code == 200
    assert res_del.json()["deleted_id"] == mem_id

    # Verify deleted
    res_search_after = client.get("/api/memory/search?q=Vanilla", headers=headers)
    assert all(m["id"] != mem_id for m in res_search_after.json())


def test_cowork_desktop_settings_and_memory_import(sync_db):
    client = TestClient(app)
    headers = {"Authorization": "Bearer token_user_1"}

    # 1. Batch import memories
    import_payload = {
        "facts": [
            {"fact": "Project uses PostgreSQL for analytical reporting", "category": "project_decision"},
            {"fact": "Never execute rm -rf without confirmation", "category": "user_preference"},
        ]
    }
    res_import = client.post("/api/memory/import", json=import_payload, headers=headers)
    assert res_import.status_code == 200
    assert res_import.json()["imported_count"] == 2

    # 2. Verify imported memories searchable
    res_search = client.get("/api/memory/search?q=PostgreSQL", headers=headers)
    assert res_search.status_code == 200
    assert len(res_search.json()) >= 1

    # 3. Cowork settings
    res_cowork_get = client.get("/api/cowork/settings", headers=headers)
    assert res_cowork_get.status_code == 200
    assert "dispatch_enabled" in res_cowork_get.json()

    res_cowork_put = client.put("/api/cowork/settings", json={"dispatch_enabled": False, "preferred_browser": "builtin"}, headers=headers)
    assert res_cowork_put.status_code == 200
    assert res_cowork_put.json()["settings"]["dispatch_enabled"] is False

    # 4. Desktop settings
    res_desktop_get = client.get("/api/desktop/settings", headers=headers)
    assert res_desktop_get.status_code == 200
    # Compared against the one place that holds the version, not a literal.
    # Written out, this line had to be edited every release, and a test that
    # needs editing to stay green is a test that will be edited to stay green.
    from app.updates import APP_VERSION

    assert res_desktop_get.json()["version"] == APP_VERSION

    # 5. Browser extension status
    res_ext_status = client.get("/api/browser-extension/status", headers=headers)
    assert res_ext_status.status_code == 200
    assert "extension_enabled" in res_ext_status.json()


