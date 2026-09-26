"""An invalid Bearer header must not hide a valid session cookie."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from app import main
from app.models import User


class _Q:
    def __init__(self, users):
        self.users = users
        self.token = None

    def filter(self, cond):
        self.token = cond.right.value
        return self

    def first(self):
        return next((u for u in self.users if u.session_token == self.token), None)


def test_cookie_is_used_when_the_header_says_undefined():
    owner = User(id=5, email="me@example.com", session_token="good-token",
                 session_expires=datetime.now() + timedelta(hours=1))
    db = SimpleNamespace(query=lambda model: _Q([owner]))
    request = SimpleNamespace(headers={"Authorization": "Bearer undefined"},
                              client=SimpleNamespace(host="203.0.113.9"), query_params={})
    assert main.get_current_user(request, db, session_token="good-token") is owner
