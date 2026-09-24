"""Check that a Google client secret belongs to SMARAN's desktop OAuth client.

    python tools/check_google_secret.py

Asks for the secret with hidden input (it is not shown, stored or logged),
then asks Google's token endpoint to redeem a deliberately fake code. Google
checks the client before the code, so the answer says which is wrong:

  invalid_client  -> this secret does NOT belong to the desktop client ID
  invalid_grant   -> the secret matches (only the fake code was refused)
"""
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "backend")
try:
    from app.direct_oauth import GOOGLE_DESKTOP_CLIENT_ID as CLIENT_ID
except Exception:  # run from elsewhere: the ID is public
    CLIENT_ID = "656427300466-d1fetqra2pv352klkociveaem72kvpdr.apps.googleusercontent.com"


def main():
    print("Desktop client ID:", CLIENT_ID)
    if sys.stdin.isatty():
        secret = getpass.getpass("Paste the client secret (hidden), then Enter: ").strip()
    else:  # piped in, e.g. from a password manager's CLI
        secret = sys.stdin.readline().strip()
    if not secret:
        print("Nothing entered.")
        return 1
    body = urllib.parse.urlencode({
        "client_id": CLIENT_ID, "client_secret": secret, "code": "fake-code-for-check",
        "code_verifier": "a" * 50, "grant_type": "authorization_code",
        "redirect_uri": "http://127.0.0.1:3003/api/auth/direct/google/callback",
    }).encode()
    try:
        urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=body), timeout=15)
        print("Unexpected success.")
        return 1
    except urllib.error.HTTPError as err:
        error = json.loads(err.read() or b"{}").get("error", "")
    finally:
        secret = None
    if error == "invalid_grant":
        print("OK: this secret belongs to the desktop client. Put exactly this value in the GitHub secret.")
        return 0
    if error == "invalid_client":
        print("NO: this secret does not belong to this client ID. Copy it from the Desktop app client in Google Cloud.")
        return 2
    print("Google answered:", error or "(no error code)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
