"""A Code-mode run is kept in its conversation, and only in its owner's."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import ChatMessage, ChatSession, User


@pytest.fixture
def client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    local = User(id=1, username="local_user", email="local@smaran.ai", is_approved=True, role="admin",
                 session_token="t1", session_expires=datetime.now() + timedelta(days=1))
    other = User(id=2, username="other", email="o@x", is_approved=True,
                 session_token="t2", session_expires=datetime.now() + timedelta(days=1))
    db.add_all([local, other])
    db.add_all([ChatSession(id="s1", user_id=1, title="mine"), ChatSession(id="s2", user_id=2, title="theirs")])
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    c = TestClient(app)
    c.headers.update({"Authorization": "Bearer t1"})
    c.cookies.set("session_token", "t1")
    yield c, db
    app.dependency_overrides.pop(get_db, None)


def test_a_run_is_saved_to_the_conversation(client):
    c, db = client
    r = c.post("/api/chat/sessions/s1/messages", json={"messages": [
        {"role": "user", "content": "add a test"},
        {"role": "assistant", "content": "Added tests/test_x.py", "model_used": "qwen2.5-coder:7b"}]})
    assert r.status_code == 200, r.text
    rows = db.query(ChatMessage).filter(ChatMessage.session_id == "s1").all()
    assert [(m.role, m.content) for m in rows] == [("user", "add a test"), ("assistant", "Added tests/test_x.py")]


def test_someone_elses_conversation_is_not_found(client):
    c, _ = client
    assert c.post("/api/chat/sessions/s2/messages",
                  json={"messages": [{"role": "user", "content": "x"}]}).status_code == 404


@pytest.mark.parametrize("messages", [[], [{"role": "system", "content": "x"}], [{"role": "user", "content": "  "}],
                                      [{"role": "user", "content": "x"}] * 5])
def test_bad_messages_are_refused(client, messages):
    c, _ = client
    assert c.post("/api/chat/sessions/s1/messages", json={"messages": messages}).status_code in (400, 422)
