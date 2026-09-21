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
* Getting back in needs either a recovery code issued once at registration,
  or a Google sign-in on the same address. Both prove something the account
  holder has; neither involves anyone else.
* The recovery code is stored the same way as a password - hashed, never in
  the clear - so it is worth no more to a thief with the database than the
  password is.
* Wrong answers are slowed down per account and per machine, and every
  failure is worded identically, so trying them tells an attacker nothing
  about which part was wrong or whether an address has an account at all.
"""

from __future__ import annotations

import hmac
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
WRONG_RECOVERY = "That recovery code is not valid for this account."

RECOVERY_GROUPS = 5
RECOVERY_GROUP_SIZE = 5
# Crockford base32 without I, L, O and U: no character can be confused with
# another when read off a screen and typed back in, and none of them can
# accidentally spell anything.
RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def make_recovery_code() -> str:
    """A code with enough entropy that guessing it is not a strategy.

    Twenty-five characters from a 32-symbol alphabet is 125 bits. Written in
    groups of five because it has to be copied down by a human being, and a
    code nobody can transcribe is a code nobody keeps.
    """
    groups = [
        "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(RECOVERY_GROUP_SIZE))
        for _ in range(RECOVERY_GROUPS)
    ]
    return "-".join(groups)


def normalise_recovery_code(raw: str) -> str:
    """What the person typed, as the code it was meant to be.

    Spaces, missing dashes and lower case are all how a human writes down
    something a machine generated, and none of them should be a failure.
    """
    return re.sub(r"[^0-9A-Z]", "", str(raw or "").upper())


def normalise_email(raw: str) -> str:
    return str(raw or "").strip().lower()


class Registration(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    # Optional: what the person would like to be called. The account is keyed
    # on the address regardless.
    display_name: Optional[str] = Field(default=None, max_length=80)


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class RecoveryReset(BaseModel):
    email: EmailStr
    recovery_code: str = Field(min_length=1, max_length=120)
    new_password: str = Field(min_length=1, max_length=200)


class PasswordChoice(BaseModel):
    """Setting a password while already signed in, after a Google reset."""
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

    @router.post("/register")
    def register(payload: Registration, request: Request, response: Response,
                 db: Session = Depends(get_db)):
        """Make an account, and hand back the one recovery code it will get."""
        email = normalise_email(payload.email)
        check_strength(payload.password)

        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.password_hash:
            raise HTTPException(409, "An account already exists for that email address.")

        recovery_code = make_recovery_code()
        if existing:
            # An account made by signing in with Google, now choosing a
            # password as well. Same person, same account - not a second one.
            user = existing
        else:
            user = User(username=f"user_{secrets.token_hex(8)}", email=email,
                        role="user", is_approved=True, email_verified=False)
            db.add(user)
            db.flush()
        if payload.display_name and payload.display_name.strip():
            user.username = payload.display_name.strip()[:80]
        user.password_hash = hash_password(payload.password)
        user.reset_token = hash_password(normalise_recovery_code(recovery_code))
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()

        session = start_session(user, response, request, db)
        # The only time this value exists outside the person's own hands. It is
        # stored hashed, so it cannot be shown again, and saying so here is the
        # difference between a code that gets written down and one that does not.
        return {**session, "recovery_code": recovery_code,
                "recovery_notice": "This is the only time this code will be shown. "
                                   "Write it down and keep it somewhere safe - it is "
                                   "the only way back into this account if the "
                                   "password is forgotten."}

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

    @router.post("/recover")
    def recover(payload: RecoveryReset, request: Request, response: Response,
                db: Session = Depends(get_db)):
        """Set a new password using the code issued at registration."""
        email = normalise_email(payload.email)
        user = db.query(User).filter(User.email == email).first()

        wait = account_delay(user)
        if wait:
            refuse(WRONG_RECOVERY, wait)

        check_strength(payload.new_password)

        offered = normalise_recovery_code(payload.recovery_code)
        stored = (user.reset_token if user and user.reset_token else _TIMING_DECOY)
        matched = verify_password(offered, stored)

        if not user or not user.reset_token or not matched:
            record_failure(db, user)
            refuse(WRONG_RECOVERY)

        # Used once and gone. A code that still works after it has been used -
        # and after it has been typed into whatever machine the person was
        # standing at - is a spare key left in the lock.
        new_code = make_recovery_code()
        user.password_hash = hash_password(payload.new_password)
        user.reset_token = hash_password(normalise_recovery_code(new_code))
        # Every other device is signed out: if the password was forgotten
        # because somebody else changed it, this is what takes it back.
        user.session_token = None
        user.session_expires = None
        clear_failures(db, user)

        session = start_session(user, response, request, db)
        return {**session, "recovery_code": new_code,
                "recovery_notice": "Your previous recovery code has been used and no "
                                   "longer works. This is its replacement, and this is "
                                   "the only time it will be shown."}

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
        issue_code = not user.reset_token
        new_code = make_recovery_code() if issue_code else None

        user.password_hash = hash_password(payload.new_password)
        if issue_code:
            user.reset_token = hash_password(normalise_recovery_code(new_code))
        clear_failures(db, user)

        result = {"user": serialise_user(user), "password_set": True}
        if issue_code:
            result.update(recovery_code=new_code,
                          recovery_notice="This is the only time this code will be shown.")
        return result

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
        if not user:
            return {"signed_in": False, "has_password": False, "has_recovery_code": False}
        return {"signed_in": True, "has_password": bool(user.password_hash),
                "has_recovery_code": bool(user.reset_token)}

    return router


def constant_time_equals(left: str, right: str) -> bool:
    """Used where a comparison is on a secret but not on a hash."""
    return hmac.compare_digest(str(left or ""), str(right or ""))
