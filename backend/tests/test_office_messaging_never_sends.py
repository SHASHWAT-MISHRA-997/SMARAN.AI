"""Messaging opens a draft. It must never send on the owner's behalf.

Every function in app/office/messaging.py documents itself as opening a
conversation with the text written but not sent, and the route that calls them
repeats the claim. A docstring is not a guarantee, and the difference matters
more here than almost anywhere else in the app: sending a message to a real
contact cannot be undone, and the owner would not have seen it happen.

So this holds the claim down rather than trusting it. Nothing here opens a
window - the handoff is replaced, and what would have been opened is inspected
instead.

These are also the only checks of this module that can run anywhere, since the
live driver deliberately does not call the messaging routes: doing so spawns
browser windows and app handlers on whatever desktop the suite runs on.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.office import messaging  # noqa: E402

SECRET = "meeting at seven"


@pytest.fixture
def opened(monkeypatch):
    """Capture what would have been handed to the browser or app handler."""
    seen = []
    monkeypatch.setattr(messaging, "_open", lambda url: seen.append(url))
    return seen


CASES = (
    ("whatsapp", lambda: messaging.whatsapp("+919876543210", SECRET)),
    ("telegram", lambda: messaging.telegram("@someone", SECRET)),
    ("sms", lambda: messaging.sms("+919876543210", SECRET)),
    ("email", lambda: messaging.email("someone@example.com", "Subject", SECRET)),
)


@pytest.mark.parametrize("name,invoke", CASES)
def test_no_service_reports_having_sent_anything(name, invoke, opened):
    result = invoke()
    assert result.get("sent") is False, (
        "%s reported sending a message on the owner's behalf" % name
    )


@pytest.mark.parametrize("name,invoke", CASES)
def test_each_service_only_opens_a_draft(name, invoke, opened):
    invoke()
    assert len(opened) == 1, "%s opened %d things, expected one" % (name, len(opened))
    url = opened[0]
    # A draft is a link that a human still has to act on. None of these
    # endpoints may be an API call that transmits by itself.
    assert not url.startswith("POST"), url
    assert "send" not in url.split("?")[0].lower(), (
        "%s opened something whose path is a send action: %s" % (name, url)
    )


@pytest.mark.parametrize("name,invoke", CASES)
def test_the_message_text_reaches_the_draft(name, invoke, opened):
    """The other half: refusing to send is only useful if the draft is right."""
    invoke()
    url = opened[0]
    assert "meeting" in url and "seven" in url, (
        "%s opened a draft that does not contain the message: %s" % (name, url)
    )


def test_a_telegram_handle_is_required_rather_than_guessed(opened):
    with pytest.raises(messaging.MessagingError):
        messaging.telegram("", SECRET)
    assert opened == [], "an empty handle still opened something"


def test_a_service_with_no_prefill_does_not_pretend_to_have_one(opened):
    """Some services cannot take text in a link. Saying otherwise would lose
    the message silently - the window opens empty and the text is gone."""
    result = messaging.social("instagram", SECRET, "someone")
    assert result.get("sent") is False
    # Either it prefilled, or it says plainly that it could not.
    prefilled = "meeting" in (opened[0] if opened else "")
    assert prefilled or result.get("note"), (
        "no prefill and no explanation of where the text went: %r" % result
    )


def test_every_documented_service_is_covered_here():
    """If a service is added, this test fails until it is checked too."""
    documented = {s["id"] for s in messaging.services().get("prefilled", [])}
    covered = {name for name, _ in CASES} | {"instagram"}
    missing = documented - covered - {"gmail"}
    assert not missing, (
        "these messaging services have no never-sends check: %s" % sorted(missing)
    )
