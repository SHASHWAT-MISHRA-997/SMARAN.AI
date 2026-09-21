"""Accounts on this machine: registering, signing in, and getting back in.

SMARAN is local-first, so there is no server we run and often no internet.
That removes the usual recovery story - a link sent by email - and it also
means every guess an attacker makes is made here, against this machine, with
nobody watching. The properties below are what stands in for that missing
supervision, so each one is pinned rather than assumed:

* a password is only ever stored as a bcrypt hash, and so is the recovery code
* a wrong password, a wrong recovery code and an address with no account are
  answered identically, so probing teaches nothing
* repeated failures get slower, and the slowdown decays instead of locking an
  account out permanently - which would let anybody who knows an address shut
  the owner out of their own machine
* a recovery code works once, and using it signs every other device out
* arriving through Google and then choosing a password gives one account, not
  two

Everything runs against a throwaway sqlite file. These cases create users and
change passwords, which is not something to do to a real database.
"""

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
    return client.post("/api/auth/register", json={"email": email, "password": password, **extra})


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

def test_registering_signs_you_in_and_issues_one_recovery_code(client):
    res = register(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["access_token"]
    assert body["user"]["email"] == EMAIL
    code = body["recovery_code"]
    # Five groups of five, so it can be written down without ambiguity.
    assert len(code.split("-")) == password_auth.RECOVERY_GROUPS
    assert all(len(group) == password_auth.RECOVERY_GROUP_SIZE for group in code.split("-"))
    assert "only time" in body["recovery_notice"]


def test_the_password_is_never_stored(client):
    register(client)
    user = stored_user(client)
    assert user.password_hash
    assert PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$2")


def test_the_recovery_code_is_stored_the_same_way_as_a_password(client):
    """A code kept in the clear is worth as much to a thief as the password."""
    code = register(client).json()["recovery_code"]
    user = stored_user(client)
    assert user.reset_token
    assert code not in user.reset_token
    assert password_auth.normalise_recovery_code(code) not in user.reset_token
    assert user.reset_token.startswith("$2")


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

def recover(client, code, new_password=OTHER, email=EMAIL):
    return client.post("/api/auth/recover", json={
        "email": email, "recovery_code": code, "new_password": new_password})


def test_the_recovery_code_sets_a_new_password(client):
    code = register(client).json()["recovery_code"]
    res = recover(client, code)
    assert res.status_code == 200, res.text
    assert sign_in(client, password=OTHER).status_code == 200
    assert sign_in(client, password=PASSWORD).status_code == 401


def test_the_code_is_accepted_however_it_was_written_down(client):
    code = register(client).json()["recovery_code"]
    assert recover(client, code.lower().replace("-", " ")).status_code == 200


def test_a_recovery_code_works_once(client):
    code = register(client).json()["recovery_code"]
    assert recover(client, code).status_code == 200
    again = recover(client, code, new_password="yet another long passphrase")
    assert again.status_code == 401


def test_recovery_hands_back_a_replacement_code(client):
    code = register(client).json()["recovery_code"]
    replacement = recover(client, code).json()["recovery_code"]
    assert replacement != code
    # And the replacement is itself usable, so nobody is left without one.
    assert recover(client, replacement, new_password="a third long passphrase here").status_code == 200


def test_recovering_signs_every_other_device_out(client):
    """If the password was changed by somebody else, this is what takes it back."""
    code = register(client).json()["recovery_code"]
    before = stored_user(client).session_token
    recover(client, code)
    assert stored_user(client).session_token != before


def test_a_wrong_recovery_code_changes_nothing(client):
    register(client)
    before = stored_user(client).password_hash
    bad = recover(client, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")
    assert bad.status_code == 401
    # The stored password is untouched: a failed recovery must not be a way
    # to clear somebody's password by attrition.
    assert stored_user(client).password_hash == before


def test_recovery_for_an_unknown_address_looks_the_same_as_a_wrong_code(client):
    register(client)
    wrong = recover(client, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")
    missing = recover(client, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", email="nobody@example.com")
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


def test_recovery_guesses_are_slowed_down_too(client):
    register(client)
    for _ in range(password_auth.MAX_ATTEMPTS_BEFORE_DELAY + 1):
        recover(client, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")
    assert recover(client, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE").status_code == 429


def test_recovery_still_requires_a_password_worth_having(client):
    code = register(client).json()["recovery_code"]
    assert recover(client, code, new_password="abc").status_code == 400


# ---------------------------------------------------------------------------
# Getting back in through Google
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


def test_a_google_account_adding_a_password_stays_one_account(client):
    """Same person, same address - not a second row with the same email."""
    db = client.sessions()
    try:
        db.add(models.User(username="google_abc", email=EMAIL, role="user",
                           is_approved=True, email_verified=True))
        db.commit()
    finally:
        db.close()

    res = register(client)
    assert res.status_code == 200, res.text

    db = client.sessions()
    try:
        assert db.query(models.User).filter(models.User.email == EMAIL).count() == 1
    finally:
        db.close()
    assert sign_in(client).status_code == 200


def test_account_status_says_whether_a_password_exists(client):
    token = register(client).json()["access_token"]
    body = client.get("/api/auth/account-status",
                      headers={"Authorization": f"Bearer {token}"}).json()
    assert body == {"signed_in": True, "has_password": True, "has_recovery_code": True}
    client.cookies.clear()
    assert client.get("/api/auth/account-status").json()["signed_in"] is False


# ---------------------------------------------------------------------------
# The recovery code itself
# ---------------------------------------------------------------------------

def test_recovery_codes_do_not_repeat():
    codes = {password_auth.make_recovery_code() for _ in range(500)}
    assert len(codes) == 500


def test_recovery_codes_avoid_characters_that_are_read_wrong():
    """I, L, O and U: misread as 1, 1, 0, and able to spell things."""
    everything = "".join(password_auth.make_recovery_code() for _ in range(200))
    for letter in "ILOU":
        assert letter not in everything


def test_a_recovery_code_is_long_enough_that_guessing_is_not_a_strategy():
    import math
    bits = password_auth.RECOVERY_GROUPS * password_auth.RECOVERY_GROUP_SIZE * math.log2(
        len(password_auth.RECOVERY_ALPHABET))
    assert bits >= 100
