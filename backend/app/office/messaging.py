"""Opening a conversation with the message already written.

What this does, precisely: it opens the chat with the recipient and the text
already in the box. It does not press send. You do.

That is not a limitation being dressed up. WhatsApp and Telegram publish
link formats that pre-fill a message and nothing more; there is no public
way to make either of them send. The alternative is driving the web
interface with simulated clicks, which breaks whenever the page changes,
violates both services' terms, and — the part that matters — would send
before anyone had read what was written. A misheard name is a message to
the wrong person, and that does not come back.

So the last click is yours, everywhere, on purpose. Everything up to it is
done for you.

Where a service publishes no pre-fill link at all, that is said plainly and
the text goes to the clipboard instead, so it is one paste rather than
retyping. Instagram is the case that matters here.
"""

from __future__ import annotations

import logging
import re
import subprocess
import urllib.parse
import webbrowser
from typing import Optional

logger = logging.getLogger("messaging")


class MessagingError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def _clean_phone(number: str) -> str:
    """Digits only, which is what every one of these link formats wants."""
    digits = re.sub(r"\D", "", number or "")
    if not digits:
        raise MessagingError(
            "That does not contain a phone number. Include the country code, "
            "for example 919876543210."
        )
    if len(digits) < 8:
        raise MessagingError(
            "%s is too short to be a full number with its country code." % number
        )
    return digits


def _open(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception as exc:
        raise MessagingError("Could not open %s: %s" % (url[:60], exc)) from exc


def _copy(text: str) -> bool:
    """Put text on the clipboard. Returns whether it worked."""
    try:
        proc = subprocess.run("clip", input=text.encode("utf-16-le"),
                              shell=True, timeout=5)
        return proc.returncode == 0
    except Exception:
        return False


# ── the ones with a published pre-fill link ────────────────────────────

def whatsapp(number: str, text: str = "") -> dict:
    """Open a WhatsApp chat with the message written but not sent.

    wa.me is WhatsApp's own documented link format. It hands off to the
    desktop app when it is installed and to web.whatsapp.com when it is not.
    """
    digits = _clean_phone(number)
    url = "https://wa.me/%s" % digits
    if text:
        url += "?text=" + urllib.parse.quote(text)
    _open(url)
    return {
        "service": "WhatsApp", "to": digits, "opened": url,
        "sent": False,
        "note": "The chat is open with the message written. Press send when "
                "you have read it.",
    }


def telegram(username: str, text: str = "") -> dict:
    """Open a Telegram chat with the message written but not sent."""
    handle = (username or "").lstrip("@").strip()
    if not handle:
        raise MessagingError("A Telegram username is needed, for example @name.")
    url = "https://t.me/%s" % urllib.parse.quote(handle)
    if text:
        url += "?text=" + urllib.parse.quote(text)
    _open(url)
    return {
        "service": "Telegram", "to": "@" + handle, "opened": url, "sent": False,
        "note": "The chat is open with the message written. Press send.",
    }


def sms(number: str, text: str = "") -> dict:
    """Hand the message to whatever handles sms: links on this machine."""
    digits = _clean_phone(number)
    url = "sms:%s" % digits
    if text:
        url += "?body=" + urllib.parse.quote(text)
    _open(url)
    return {
        "service": "SMS", "to": digits, "opened": url, "sent": False,
        "note": "Opened in whatever app handles text messages here. If "
                "nothing opened, this machine has no SMS app associated.",
    }


def email(address: str, subject: str = "", body: str = "") -> dict:
    """Open Gmail's compose window with the fields filled in."""
    url = "https://mail.google.com/mail/?view=cm"
    if address:
        url += "&to=" + urllib.parse.quote(address)
    if subject:
        url += "&su=" + urllib.parse.quote(subject)
    if body:
        url += "&body=" + urllib.parse.quote(body)
    _open(url)
    return {
        "service": "Gmail", "to": address, "opened": url, "sent": False,
        "note": "The draft is written. Press send.",
    }


# ── the ones that publish nothing ──────────────────────────────────────

# Instagram, Messenger and X have no documented link that pre-fills a direct
# message. Their compose screens open, and the text is put on the clipboard
# so it is one paste. Claiming otherwise would be inventing an interface
# they do not offer.
_NO_PREFILL = {
    "instagram": ("Instagram", "https://www.instagram.com/direct/new/"),
    "messenger": ("Messenger", "https://www.messenger.com/"),
    "x": ("X", "https://x.com/messages/compose"),
    "twitter": ("X", "https://x.com/messages/compose"),
    "linkedin": ("LinkedIn", "https://www.linkedin.com/messaging/"),
}


def social(service: str, text: str = "", handle: str = "") -> dict:
    """Open a service's message screen, with the text on the clipboard."""
    key = (service or "").strip().lower()
    if key not in _NO_PREFILL:
        raise MessagingError(
            "%s is not one this knows. It handles: %s — plus WhatsApp, "
            "Telegram, SMS and Gmail, which can be pre-filled."
            % (service, ", ".join(sorted({v[0] for v in _NO_PREFILL.values()})))
        )

    name, url = _NO_PREFILL[key]
    copied = _copy(text) if text else False
    _open(url)
    return {
        "service": name, "to": handle or "(choose in the app)",
        "opened": url, "sent": False, "copied_to_clipboard": copied,
        "note": (
            "%s publishes no link that fills a message in advance, so this "
            "opens the compose screen%s. Choose the person and paste."
            % (name,
               " with your text on the clipboard" if copied
               else "; the text could not be copied to the clipboard")
        ),
    }


def services() -> dict:
    """What can be done, and how far, for each service."""
    return {
        "prefilled": [
            {"id": "whatsapp", "name": "WhatsApp",
             "needs": "phone number with country code", "prefills": True},
            {"id": "telegram", "name": "Telegram",
             "needs": "username", "prefills": True},
            {"id": "sms", "name": "SMS",
             "needs": "phone number", "prefills": True},
            {"id": "email", "name": "Gmail",
             "needs": "email address", "prefills": True},
        ],
        "clipboard_only": [
            {"id": k, "name": v[0], "needs": "you pick the person",
             "prefills": False}
            for k, v in sorted(_NO_PREFILL.items()) if k != "twitter"
        ],
        "note": (
            "Nothing here sends. Every one opens the conversation with the "
            "message ready and leaves the send button to you."
        ),
    }
