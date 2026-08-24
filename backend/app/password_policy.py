"""Password strength, including a check against known-breached passwords.

The previous rule was six characters and nothing else, so "123456" was
accepted. Length is the single biggest factor in how hard a password is to
crack, and a breach check catches the far more common failure: a password
that is long and looks fine but has already appeared in a public dump, where
an attacker will try it first.

The breach check uses Have I Been Pwned's range API, which is free and needs
no key. It is k-anonymous: only the first five characters of the SHA-1 hash
leave this machine, and the service returns every suffix sharing that prefix
for us to match locally. The password itself, and enough of its hash to
identify it, never go anywhere.

If the service cannot be reached the password is allowed through. An offline
machine must still be able to set a password, and refusing would turn a
network blip into a lockout.
"""

from __future__ import annotations

import hashlib
import logging
import urllib.error
import urllib.request

logger = logging.getLogger("password_policy")

MIN_LENGTH = 12
_HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/"
_TIMEOUT_SECONDS = 4


def _breach_count(password: str) -> int:
    """How many times this password appears in known breaches, 0 if unknown.

    Sends only the first five hex characters of the SHA-1 hash. Returning 0
    on any failure is deliberate: this check can strengthen a password rule,
    but it must never be the reason someone cannot set one.
    """
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        request = urllib.request.Request(
            _HIBP_RANGE_URL + prefix,
            headers={"User-Agent": "SMARAN.AI-password-check", "Add-Padding": "true"},
        )
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.debug("Breach check skipped, service unreachable: %s", exc)
        return 0

    for line in body.splitlines():
        candidate, _, count = line.partition(":")
        if candidate.strip() == suffix:
            try:
                return int(count.strip())
            except ValueError:
                return 1
    return 0


def verify_password_strength(password: str, *, check_breaches: bool = True) -> tuple[bool, str]:
    """Return (ok, message). The message is shown to the person choosing it."""
    if len(password) < MIN_LENGTH:
        return False, f"Password must be at least {MIN_LENGTH} characters long."

    # A long string of one repeated character clears the length bar while
    # being trivial to guess.
    if len(set(password)) < 4:
        return False, "Password must use at least four different characters."

    if check_breaches:
        seen = _breach_count(password)
        if seen:
            return False, (
                f"This password has appeared in {seen:,} known data breaches. "
                "Attackers try these first, so please choose a different one."
            )

    return True, ""
