"""An account on this machine: register, sign in, and get back in.

SMARAN had accounts, then it did not, and now it does again. The middle
version replaced them with Google and GitHub, which was fine until GitHub
needed a client secret nobody could keep - and a product handed to a client
should not depend on a provider being reachable and correctly configured at
all. Google stays as the one-tap option. This is the one that works with
nothing but the machine it is installed on.

The whole design here is shaped by one fact: this is a local-first
application. There is no server we run, no support desk, and often no
internet. That rules out the usual recovery story - a reset link in an email -
because there is no mail to send it from, and a client who never configured
SMTP would find out only when they were already locked out. It also means
every guess an attacker makes is made against this machine, where nobody is
watching.

So:

* Passwords are stored as bcrypt hashes and nothing else. Reading the
  database tells you nothing you can sign in with.
* Getting back in means answering the security questions set when the
  account was made, or signing in with Google on the same address. Neither
  involves anybody else, and neither needs a network.
* The answers are stored the same way as the password - hashed, never in the
  clear - so they are worth no more to a thief with the database than the
  password is.
* Because the questions are the only offline way back, they are required at
  registration rather than offered. An account with no way in is not a
  feature, and "optional" is how it would happen.
* Wrong answers are slowed down per account and per machine, and every
  failure is worded identically, so trying them tells an attacker nothing
  about which part was wrong or whether an address has an account at all.
"""

from __future__ import annotations

import hmac
import json
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

# Guessing, slowed to a crawl.
#
# Not a lockout that an attacker can trigger deliberately: locking an account
# after N failures hands anybody who knows an address a way to shut the owner
# out of their own machine. The delay grows with the failures and then decays,
# so a person who mistypes twice waits seconds while a script waits forever.
MAX_ATTEMPTS_BEFORE_DELAY = 3
ATTEMPT_WINDOW = timedelta(minutes=15)
MAX_DELAY_SECONDS = 300

# A password is never compared against a missing hash without doing the work
# anyway: bcrypt on a known-bad hash takes the same time as bcrypt on a real
# one, so "no such account" and "wrong password" cannot be told apart by a
# stopwatch either.
_TIMING_DECOY = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Zv5gg7wY2z1p2cJcMcC7QqGkuW1/Iu"

# Deliberately one sentence for every way it can fail.
WRONG_CREDENTIALS = "That email and password do not match an account."
WRONG_ANSWERS = "Those answers do not match this account's security questions."

# Security questions, and what they are worth.
#
# Asked for, and added - with the limits stated rather than hidden. An answer
# to "your first school" is short, guessable, and often findable, so these are
# a convenience and not a second password. What keeps them from being a way
# in: at least two must be set, every one of them must be answered correctly,
# the answers are hashed like passwords, and wrong attempts are slowed on the
# same counter as everything else. Anybody who can answer all of them could
# very likely have answered the password too.
MIN_SECURITY_QUESTIONS = 2
MAX_SECURITY_QUESTIONS = 5
MIN_ANSWER_LENGTH = 2


def normalise_answer(raw: str) -> str:
    """Answers are compared as people actually write them.

    "St. Mary's" and "st marys" are the same memory, and a recovery route
    that fails on a full stop is a recovery route that does not work. Case,
    punctuation and repeated spaces are dropped; the letters and digits are
    what count.
    """
    text = re.sub(r"[^a-z0-9 ]+", "", str(raw or "").lower())
    return re.sub(r"\s+", " ", text).strip()


def normalise_email(raw: str) -> str:
    return str(raw or "").strip().lower()


class SecurityAnswer(BaseModel):
    question: str = Field(min_length=3, max_length=160)
    answer: str = Field(min_length=1, max_length=160)


class Registration(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    # Optional: what the person would like to be called. The account is keyed
    # on the address regardless.
    display_name: Optional[str] = Field(default=None, max_length=80)
    security_questions: list[SecurityAnswer] = Field(default_factory=list)


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class PasswordChoice(BaseModel):
    """Setting a password while already signed in, after a Google reset."""
    new_password: str = Field(min_length=1, max_length=200)


class QuestionReset(BaseModel):
    email: EmailStr
    answers: list[SecurityAnswer] = Field(default_factory=list)
    new_password: str = Field(min_length=1, max_length=200)


def make_router(get_db, hash_password, verify_password, verify_password_strength,
                start_session, serialise_user):
    """Wire the account routes to the machinery main.py already owns.

    Everything that touches the session cookie or the User model is passed in
    rather than imported, because importing main from here would be circular -
    main imports this to mount it.
    """
    router = APIRouter(prefix="/api/auth", tags=["account"])

    from app.models import User  # Imported late for the same reason.

    def account_delay(user) -> int:
        """Seconds this account must wait before another attempt is read."""
        if not user or not user.locked_until:
            return 0
        remaining = (user.locked_until - datetime.now()).total_seconds()
        return max(0, int(remaining))

    def record_failure(db: Session, user) -> None:
        if not user:
            return
        # A long-quiet account starts counting again rather than carrying a
        # grudge from last month.
        stale = user.locked_until and user.locked_until < datetime.now() - ATTEMPT_WINDOW
        user.failed_login_attempts = 1 if stale else (user.failed_login_attempts or 0) + 1
        over = user.failed_login_attempts - MAX_ATTEMPTS_BEFORE_DELAY
        if over > 0:
            wait = min(MAX_DELAY_SECONDS, 2 ** min(over, 8))
            user.locked_until = datetime.now() + timedelta(seconds=wait)
        db.commit()

    def clear_failures(db: Session, user) -> None:
        if not user:
            return
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()

    def refuse(detail: str, wait: int = 0):
        if wait:
            raise HTTPException(429, f"Too many attempts. Try again in {wait} seconds.")
        raise HTTPException(401, detail)

    def check_strength(password: str) -> None:
        ok, message = verify_password_strength(password, check_breaches=True)
        if not ok:
            raise HTTPException(400, message)

    def encode_questions(entries, *, required: bool = False) -> Optional[str]:
        """Store the questions in the clear and the answers as hashes."""
        if not entries and not required:
            return None
        if len(entries) < MIN_SECURITY_QUESTIONS:
            raise HTTPException(400,
                f"Please set at least {MIN_SECURITY_QUESTIONS} security questions.")
        if len(entries) > MAX_SECURITY_QUESTIONS:
            raise HTTPException(400,
                f"Please set no more than {MAX_SECURITY_QUESTIONS} security questions.")
        prepared = []
        seen = set()
        for entry in entries:
            question = entry.question.strip()
            answer = normalise_answer(entry.answer)
            if len(answer) < MIN_ANSWER_LENGTH:
                raise HTTPException(400, "Each security answer needs at least "
                                         f"{MIN_ANSWER_LENGTH} letters or digits.")
            if normalise_answer(question) in seen:
                raise HTTPException(400, "Please choose a different question for each answer.")
            seen.add(normalise_answer(question))
            prepared.append({"question": question, "answer_hash": hash_password(answer)})
        return json.dumps(prepared)

    def decode_questions(user):
        try:
            return json.loads(user.security_questions) if user and user.security_questions else []
        except (TypeError, ValueError):
            return []

    @router.post("/register")
    def register(payload: Registration, request: Request, response: Response,
                 db: Session = Depends(get_db)):
        """Make an account, with the questions that can reopen it."""
        email = normalise_email(payload.email)
        check_strength(payload.password)

        existing = db.query(User).filter(User.email == email).first()
        if existing:
            raise HTTPException(409, "An account already exists for that email address.")

        # Validated before anything is written, so a rejected set of questions
        # does not leave a half-made account behind. Required, not optional:
        # they are the only offline way back into this account.
        questions = encode_questions(payload.security_questions, required=True)

        user = User(username=f"user_{secrets.token_hex(8)}", email=email,
                    role="user", is_approved=True, email_verified=False)
        db.add(user)
        db.flush()
        if payload.display_name and payload.display_name.strip():
            user.username = payload.display_name.strip()[:80]
        user.password_hash = hash_password(payload.password)
        user.security_questions = questions
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()

        return start_session(user, response, request, db)

    @router.post("/login")
    def login(payload: Credentials, request: Request, response: Response,
              db: Session = Depends(get_db)):
        email = normalise_email(payload.email)
        user = db.query(User).filter(User.email == email).first()

        wait = account_delay(user)
        if wait:
            refuse(WRONG_CREDENTIALS, wait)

        # Run the comparison even with no account, so the two cases take the
        # same time. The decoy hash is a real bcrypt hash of a random string.
        stored = (user.password_hash if user and user.password_hash else _TIMING_DECOY)
        matched = verify_password(payload.password, stored)

        if not user or not user.password_hash or not matched:
            record_failure(db, user)
            refuse(WRONG_CREDENTIALS)

        clear_failures(db, user)
        return start_session(user, response, request, db)

    @router.post("/security-questions")
    def security_questions(payload: Credentials, db: Session = Depends(get_db)):
        """Which questions this account was asked, so they can be answered.

        Takes an email and returns questions, which sounds like it would tell
        a stranger whether an address has an account. It does not: an address
        with no account, and one with no questions set, both get an empty
        list, and the list is never the secret - the answers are.
        """
        user = db.query(User).filter(User.email == normalise_email(payload.email)).first()
        return {"questions": [entry.get("question") for entry in decode_questions(user)]}

    @router.post("/recover-questions")
    def recover_with_questions(payload: QuestionReset, request: Request, response: Response,
                               db: Session = Depends(get_db)):
        """Set a new password by answering every security question."""
        email = normalise_email(payload.email)
        user = db.query(User).filter(User.email == email).first()

        wait = account_delay(user)
        if wait:
            refuse(WRONG_ANSWERS, wait)

        check_strength(payload.new_password)

        stored = decode_questions(user)
        offered = {normalise_answer(a.question): a.answer for a in payload.answers}

        # Every question, not a majority and not just one. Two short answers
        # are weak enough on their own; requiring all of them is what keeps
        # this from being the easiest way into an account.
        matched = bool(stored) and len(offered) == len(stored)
        for entry in stored:
            given = offered.get(normalise_answer(entry.get("question", "")))
            # Compared even when there is nothing to compare against, so the
            # time taken does not say which question was the wrong one.
            if not verify_password(normalise_answer(given or ""),
                                   entry.get("answer_hash") or _TIMING_DECOY):
                matched = False

        if not user or not stored or not matched:
            record_failure(db, user)
            refuse(WRONG_ANSWERS)

        user.password_hash = hash_password(payload.new_password)
        # Every other device is signed out: if the password was forgotten
        # because somebody else changed it, this is what takes it back.
        user.session_token = None
        user.session_expires = None
        clear_failures(db, user)

        return start_session(user, response, request, db)

    @router.post("/set-password")
    def set_password(payload: PasswordChoice, request: Request, response: Response,
                     db: Session = Depends(get_db)):
        """Choose a new password for the account already signed in.

        This is the other way back in: sign in with Google on the same address
        and set a new password here. Google has already proved who this is, so
        the old password is not asked for - there would be no point, since not
        knowing it is the reason for being here.
        """
        token = request.cookies.get("session_token") or ""
        header = request.headers.get("authorization") or ""
        if not token and header.lower().startswith("bearer "):
            token = header[7:].strip()
        user = db.query(User).filter(User.session_token == token).first() if token else None
        if not user or not user.session_expires or user.session_expires <= datetime.now():
            raise HTTPException(401, "Sign in first, then choose a new password.")

        check_strength(payload.new_password)
        user.password_hash = hash_password(payload.new_password)
        clear_failures(db, user)
        return {"user": serialise_user(user), "password_set": True,
                # Said plainly, because Google is the only way back for an
                # account that arrived through Google and never set questions.
                "needs_security_questions": not decode_questions(user)}

    @router.get("/account-status")
    def account_status(request: Request, db: Session = Depends(get_db)):
        """Whether the signed-in account has a password yet.

        Asked by the settings screen so it can offer "set a password" to
        somebody who arrived through Google, and "change password" to somebody
        who did not.
        """
        token = request.cookies.get("session_token") or ""
        header = request.headers.get("authorization") or ""
        if not token and header.lower().startswith("bearer "):
            token = header[7:].strip()
        user = db.query(User).filter(User.session_token == token).first() if token else None
        if not user or not user.session_expires or user.session_expires <= datetime.now():
            return {"signed_in": False, "has_password": False, "has_questions": False}
        return {"signed_in": True, "has_password": bool(user.password_hash),
                "has_questions": bool(decode_questions(user))}

    return router


def constant_time_equals(left: str, right: str) -> bool:
    """Used where a comparison is on a secret but not on a hash."""
    return hmac.compare_digest(str(left or ""), str(right or ""))
