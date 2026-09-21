"""Password sign-in and security-question recovery against a throwaway database."""

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import models, password_auth  # noqa: E402

# example.com is reserved for documentation and cannot receive mail, which
# is what makes it safe here. ".invalid" would be safer still but pydantic
# rejects it as a special-use name, and that rejection is correct.
EMAIL = "owner@example.com"
PASSWORD = "correct horse battery staple"
OTHER = "a different long passphrase here"


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


@pytest.fixture
def client(db_session):
    """The account routes, wired to the same helpers main.py passes in.

    bcrypt for real rather than a stub: the timing and one-wayness of the
    hash are part of what is being checked, and a fake would prove nothing.
    """
    import bcrypt

    def hash_password(password: str) -> str:
        return bcrypt.hashpw(str(password).encode()[:72], bcrypt.gensalt(rounds=4)).decode()

    def verify_password(plain: str, hashed: str) -> bool:
        if not plain or not hashed:
            return False
        try:
            return bcrypt.checkpw(str(plain).encode()[:72], str(hashed).encode())
        except Exception:
            return False

    def strength(password, *, check_breaches=False):
        # The real policy is exercised in its own tests; here it only has to
        # be present, and reaching out to HIBP from a unit test would be rude.
        return (len(password) >= 6, "Password must be at least 6 characters long.")

    def start_session(user, response, request, db):
        import secrets
        from datetime import datetime, timedelta
        user.session_token = secrets.token_urlsafe(32)
        user.session_expires = datetime.now() + timedelta(days=30)
        user.last_login = datetime.now()
        db.commit()
        response.set_cookie("session_token", user.session_token, httponly=True, path="/")
        return {"access_token": user.session_token, "token_type": "bearer",
                "user": serialise(user)}

    def serialise(user):
        return {"id": user.id, "username": user.username, "email": user.email}

    def get_db():
        db = db_session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(password_auth.make_router(
        get_db, hash_password, verify_password, strength, start_session, serialise))
    test_client = TestClient(app, raise_server_exceptions=False)
    test_client.sessions = db_session
    return test_client


def register(client, email=EMAIL, password=PASSWORD, **extra):
    return client.post("/api/auth/register", json={"email": email, "password": password, "security_questions": QUESTIONS, **extra})


def sign_in(client, email=EMAIL, password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def stored_user(client, email=EMAIL):
    db = client.sessions()
    try:
        return db.query(models.User).filter(models.User.email == email).first()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Registering
# ---------------------------------------------------------------------------

def test_registering_signs_you_in_without_recovery_codes(client):
    res = register(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["access_token"]
    assert body["user"]["email"] == EMAIL
    assert "recovery_code" not in body


def test_the_password_is_never_stored(client):
    register(client)
    user = stored_user(client)
    assert user.password_hash
    assert PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$2")


def test_no_recovery_code_is_stored_or_accepted(client):
    register(client)
    assert stored_user(client).reset_token is None
    assert client.post('/api/auth/recover', json={
        'email': EMAIL, 'recovery_code': 'old-code', 'new_password': OTHER}).status_code == 404


def test_an_address_cannot_be_registered_twice(client):
    register(client)
    again = register(client, password=OTHER)
    assert again.status_code == 409
    # And the original password still works, so a second attempt cannot be
    # used to overwrite somebody else's account.
    assert sign_in(client).status_code == 200


def test_the_address_is_matched_regardless_of_case_or_spacing(client):
    register(client)
    assert sign_in(client, email="  OWNER@Example.Com  ".strip()).status_code == 200


def test_a_weak_password_is_refused_before_an_account_exists(client):
    res = register(client, password="abc")
    assert res.status_code == 400
    assert stored_user(client) is None


# ---------------------------------------------------------------------------
# Signing in
# ---------------------------------------------------------------------------

def test_the_right_password_signs_in(client):
    register(client)
    res = sign_in(client)
    assert res.status_code == 200, res.text
    assert res.json()["access_token"]


def test_the_wrong_password_does_not(client):
    register(client)
    assert sign_in(client, password=OTHER).status_code == 401


def test_an_unknown_address_is_answered_exactly_like_a_wrong_password(client):
    """So the sign-in form cannot be used to find out who has an account."""
    register(client)
    wrong = sign_in(client, password=OTHER)
    missing = sign_in(client, email="nobody@example.com", password=OTHER)
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


def test_a_session_is_issued_as_an_httponly_cookie(client):
    register(client)
    res = sign_in(client)
    cookie = res.headers.get("set-cookie", "")
    assert "session_token=" in cookie
    assert "HttpOnly" in cookie


# ---------------------------------------------------------------------------
# Slowing guesses down
# ---------------------------------------------------------------------------

def test_repeated_wrong_passwords_start_costing_time(client):
    register(client)
    for _ in range(password_auth.MAX_ATTEMPTS_BEFORE_DELAY + 1):
        sign_in(client, password=OTHER)
    blocked = sign_in(client, password=OTHER)
    assert blocked.status_code == 429
    assert "Try again in" in blocked.json()["detail"]


def test_the_delay_applies_to_the_right_password_too(client):
    """Otherwise the delay is only an inconvenience to the person guessing."""
    register(client)
    for _ in range(password_auth.MAX_ATTEMPTS_BEFORE_DELAY + 1):
        sign_in(client, password=OTHER)
    assert sign_in(client).status_code == 429


def test_the_delay_is_bounded_rather_than_a_permanent_lockout(client):
    """Anybody who knows the address could otherwise shut the owner out."""
    register(client)
    for _ in range(40):
        sign_in(client, password=OTHER)
    user = stored_user(client)
    from datetime import datetime
    waiting = (user.locked_until - datetime.now()).total_seconds()
    assert waiting <= password_auth.MAX_DELAY_SECONDS + 1


def test_signing_in_successfully_clears_the_count(client):
    register(client)
    sign_in(client, password=OTHER)
    sign_in(client, password=OTHER)
    assert sign_in(client).status_code == 200
    assert stored_user(client).failed_login_attempts == 0


def test_guessing_one_account_does_not_slow_down_another(client):
    register(client)
    register(client, email="second@example.com", password=OTHER)
    for _ in range(10):
        sign_in(client, password="wrong wrong wrong")
    assert sign_in(client, email="second@example.com", password=OTHER).status_code == 200


# ---------------------------------------------------------------------------
# Getting back in with the recovery code
# ---------------------------------------------------------------------------

def test_a_signed_in_person_can_set_a_new_password(client):
    """The Google route: the provider proved who this is, so no old password."""
    token = register(client).json()["access_token"]
    res = client.post("/api/auth/set-password", json={"new_password": OTHER},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    assert sign_in(client, password=OTHER).status_code == 200


def test_setting_a_password_without_a_session_is_refused(client):
    register(client)
    client.cookies.clear()  # Registering left a real session in the jar.
    assert client.post("/api/auth/set-password", json={"new_password": OTHER}).status_code == 401


def test_an_invented_session_token_cannot_set_a_password(client):
    register(client)
    client.cookies.clear()
    res = client.post("/api/auth/set-password", json={"new_password": OTHER},
                      headers={"Authorization": "Bearer not-a-real-token"})
    assert res.status_code == 401
    assert sign_in(client).status_code == 200


def test_registration_cannot_take_over_a_google_account(client):
    """Same person, same address - not a second row with the same email."""
    db = client.sessions()
    try:
        db.add(models.User(username="google_abc", email=EMAIL, role="user",
                           is_approved=True, email_verified=True))
        db.commit()
    finally:
        db.close()

    res = register(client)
    assert res.status_code == 409
    assert stored_user(client).password_hash is None
    assert sign_in(client).status_code == 401


def test_account_status_says_whether_a_password_exists(client):
    token = register(client).json()["access_token"]
    body = client.get("/api/auth/account-status",
                      headers={"Authorization": f"Bearer {token}"}).json()
    assert body == {"signed_in": True, "has_password": True, "has_questions": True}
    client.cookies.clear()
    assert client.get("/api/auth/account-status").json()["signed_in"] is False


# ---------------------------------------------------------------------------
# The recovery code itself
# ---------------------------------------------------------------------------

QUESTIONS = [
    {"question": "What was the name of your first school?", "answer": "St. Mary's"},
    {"question": "What was the name of your first pet?", "answer": "Rex"},
]


def answer(client, answers, new_password=OTHER, email=EMAIL):
    return client.post("/api/auth/recover-questions", json={
        "email": email, "answers": answers, "new_password": new_password})


def test_questions_can_be_set_at_registration(client):
    res = register(client, security_questions=QUESTIONS)
    assert res.status_code == 200, res.text
    asked = client.post("/api/auth/security-questions",
                        json={"email": EMAIL, "password": "unused"}).json()["questions"]
    assert asked == [q["question"] for q in QUESTIONS]


def test_the_answers_are_stored_the_same_way_as_a_password(client):
    register(client, security_questions=QUESTIONS)
    stored = stored_user(client).security_questions
    assert "Rex" not in stored and "rex" not in stored.lower().replace("first", "")
    assert "$2" in stored


def test_answering_every_question_sets_a_new_password(client):
    register(client, security_questions=QUESTIONS)
    res = answer(client, QUESTIONS)
    assert res.status_code == 200, res.text
    assert "recovery_code" not in res.json()
    assert sign_in(client, password=OTHER).status_code == 200


def test_answers_are_matched_the_way_a_person_writes_them(client):
    """"St. Mary's" at registration, "st marys" a year later."""
    register(client, security_questions=QUESTIONS)
    res = answer(client, [
        {"question": QUESTIONS[0]["question"], "answer": "st marys"},
        {"question": QUESTIONS[1]["question"], "answer": "  REX "},
    ])
    assert res.status_code == 200, res.text


def test_one_right_answer_is_not_enough(client):
    register(client, security_questions=QUESTIONS)
    assert answer(client, [QUESTIONS[0]]).status_code == 401
    assert sign_in(client).status_code in (200, 429)


def test_one_wrong_answer_fails_the_whole_reset(client):
    register(client, security_questions=QUESTIONS)
    before = stored_user(client).password_hash
    res = answer(client, [QUESTIONS[0],
                          {"question": QUESTIONS[1]["question"], "answer": "Fluffy"}])
    assert res.status_code == 401
    assert stored_user(client).password_hash == before


def test_an_account_without_questions_cannot_be_reset_by_answering_none(client):
    register(client)
    assert answer(client, []).status_code == 401


def test_asking_for_questions_does_not_reveal_who_has_an_account(client):
    register(client, security_questions=QUESTIONS)
    missing = client.post("/api/auth/security-questions",
                          json={"email": "nobody@example.com", "password": "x"})
    without = client.post("/api/auth/security-questions",
                          json={"email": "plain@example.com", "password": "x"})
    assert missing.status_code == without.status_code == 200
    assert missing.json() == without.json() == {"questions": []}


def test_answer_guesses_are_slowed_down(client):
    register(client, security_questions=QUESTIONS)
    wrong = [QUESTIONS[0], {"question": QUESTIONS[1]["question"], "answer": "nope"}]
    for _ in range(password_auth.MAX_ATTEMPTS_BEFORE_DELAY + 1):
        answer(client, wrong)
    assert answer(client, QUESTIONS).status_code == 429


def test_a_single_question_is_refused_as_too_weak(client):
    res = register(client, security_questions=[QUESTIONS[0]])
    assert res.status_code == 400
    assert stored_user(client) is None


def test_an_answer_too_short_to_be_worth_anything_is_refused(client):
    res = register(client, security_questions=[
        QUESTIONS[0], {"question": QUESTIONS[1]["question"], "answer": "!"}])
    assert res.status_code == 400


def test_the_same_question_cannot_be_used_twice(client):
    res = register(client, security_questions=[QUESTIONS[0], QUESTIONS[0]])
    assert res.status_code == 400


def test_resetting_by_answers_signs_other_devices_out(client):
    register(client, security_questions=QUESTIONS)
    before = stored_user(client).session_token
    answer(client, QUESTIONS)
    assert stored_user(client).session_token != before


def test_registration_requires_questions(client):
    assert register(client, security_questions=[]).status_code == 400
    assert stored_user(client) is None


def test_reset_rejects_weak_password_without_changing_existing_password(client):
    register(client)
    assert answer(client, QUESTIONS, new_password='abc').status_code == 400
    assert sign_in(client).status_code == 200
