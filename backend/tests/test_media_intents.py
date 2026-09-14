"""Asking for a song in the words people actually use.

Reported as "YouTube opens but nothing plays". Two separate faults sat behind
it, and neither was visible from the code alone - both patterns looked
reasonable until they were tried on real sentences.

The intent patterns required "youtube" to come *before* the thing to play:
"play on youtube X", or "youtube par X chalao". Hinglish normally puts the
subject first - "ganpati bappa song youtube par play karo" - and English often
puts the site last - "play ganpati bappa on youtube". Neither matched, so the
sentence fell through to the plain open-youtube rule and the browser landed on
the home page with nothing searched.

Stopping was worse: "stop" was not among the verbs at all, and the noun had to
sit directly before it, so "band karo", "stop karo", "rok do" and even "stop
the music" all missed. Eight of ten ordinary phrasings did nothing.

These pin the phrasings rather than the regexes, so the patterns can be
rewritten as long as the sentences keep working.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.desktop_agent import INTENT_PATTERNS  # noqa: E402


def route(text):
    """The action a sentence reaches, and the parameters it carries."""
    for pattern, action_id, template in INTENT_PATTERNS:
        match = pattern.search(text)
        if match:
            query = None
            if template.get("query") == "$1" and match.groups():
                query = match.group(1)
            return action_id, query
    return None, None


PLAY_PHRASINGS = [
    # the one that was reported
    "ganpati bappa song youtube par play karo",
    "play ganpati bappa on youtube",
    "ganpati bappa gaana youtube pe chalao",
    "youtube par ganpati bappa song play karo",
    "arijit singh song youtube pe bajao",
    "tum hi ho youtube par lagao",
    "play lofi beats on youtube",
]


@pytest.mark.parametrize("text", PLAY_PHRASINGS)
def test_asking_to_play_something_reaches_youtube_search(text):
    action, query = route(text)
    assert action == "search_youtube", f"{text!r} routed to {action!r}"
    assert query and query.strip(), f"{text!r} matched but carried no query"
    # The site name must not end up inside the thing being searched for.
    assert "youtube" not in query.lower(), f"query {query!r} still contains the site"


STOP_PHRASINGS = [
    "band karo",
    "stop karo",
    "bandh karo",
    "rok do",
    "stop the music",
    "gaana band karo",
    "video band karo",
    "music band karo",
    "stop the video",
]


@pytest.mark.parametrize("text", STOP_PHRASINGS)
def test_asking_to_stop_actually_stops(text):
    """Stop must stop, not toggle.

    Only play/pause existed, so on a paused track "band karo" would have
    started it playing again - the opposite of the request.
    """
    action, _ = route(text)
    assert action == "media_stop", f"{text!r} routed to {action!r}"


@pytest.mark.parametrize("text", ["pause karo", "pause the song", "resume karo"])
def test_pause_and_resume_still_toggle(text):
    action, _ = route(text)
    assert action == "media_play_pause", f"{text!r} routed to {action!r}"


def test_stop_is_a_registered_action_with_an_implementation():
    from app.desktop_agent import DESKTOP_ACTION_CATALOG, DesktopAgent

    assert "media_stop" in DESKTOP_ACTION_CATALOG
    assert callable(getattr(DesktopAgent, "_action_media_stop", None))


def test_plain_open_youtube_still_just_opens_it():
    """The broader play patterns must not swallow a bare open request."""
    action, _ = route("open youtube")
    assert action == "open_website"
