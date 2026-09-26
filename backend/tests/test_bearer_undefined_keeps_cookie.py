"""A screen with no token in memory must not sign the owner out of their chats.

The chat screen sends `Authorization: Bearer ${token}`. When the token lives
only in the sign-in cookie, that header reads "Bearer undefined". It used to
replace the cookie outright, match nobody, and fall back to the device
account - which owns none of the signed-in user's conversations, so every
message came back 403 "You do not have access to this chat session".
"""
import secrets
import sys
from datetime import datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_a_junk_bearer_header_does_not_hide_the_sign_in_cookie():
    from app.database import SessionLocal
    from app.main import app
    from app.models import User

    token = secrets.token_urlsafe(24)
    name = "cookie_" + secrets.token_hex(4)
    db = SessionLocal()
    user = User(username=name, email=f"{name}@example.test", is_approved=True, role="user",
                session_token=token, session_expires=datetime.now() + timedelta(days=1))
    db.add(user)
    db.commit()
    user_id = user.id
    db.close()

    client = TestClient(app, client=("127.0.0.1", 50123))
    client.cookies.set("session_token", token)
    for junk in ("Bearer undefined", "Bearer null", "Bearer not-a-real-token"):
        me = client.get("/api/auth/me", headers={"Authorization": junk})
        assert me.status_code == 200 and me.json()["id"] == user_id, junk
