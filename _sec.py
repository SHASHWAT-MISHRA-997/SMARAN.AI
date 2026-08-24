"""Wire the stronger password policy in, and close the rate-limit gap.

From the security review:
  * hole 5 - the rule was six characters and no breach check
  * hole 4 - /api/auth/verify-email had no limit, so a token could be guessed
"""
from pathlib import Path

p = Path("backend/app/main.py")
raw = p.read_bytes().decode("utf-8")
nl = "\r\n" if "\r\n" in raw else "\n"

# --- password policy moves to its own module ------------------------------
old = nl.join([
    "def verify_password_strength(password: str) -> tuple[bool, str]:",
    '    """Validate password strength. Returns (is_valid, error_message)."""',
    "    if len(password) < 6:",
    '        return False, "Password must be at least 6 characters long"',
    '    return True, ""',
])
assert old in raw, "password strength function"

new = nl.join([
    "# Length and a breach check, in app/password_policy.py. The rule here used",
    '# to be six characters and nothing else, so "123456" was accepted.',
    "from app.password_policy import verify_password_strength  # noqa: E402",
])
raw = raw.replace(old, new, 1)

# --- rate limit the verification endpoint ---------------------------------
old_verify = '@app.post("/api/auth/verify-email")'
assert old_verify in raw, "verify-email route"
new_verify = nl.join([
    "# Verification tokens are guessable if the endpoint is unlimited, so this",
    "# gets the same treatment as the other credential-bearing routes.",
    old_verify,
    '@auth_limiter.limit("20/hour")',
])
raw = raw.replace(old_verify, new_verify, 1)

p.write_bytes(raw.encode("utf-8"))
print("password policy wired in; verify-email rate limited")
