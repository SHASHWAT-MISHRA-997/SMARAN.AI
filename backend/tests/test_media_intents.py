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

import json
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


# Read from the file the phone's tests read too.
#
# The phone has its own matcher, in JavaScript, because a handset that is not
# paired with a desktop has no backend to ask - it went to a cloud model, which
# answered "I have no tool that can open apps on your device". Two matchers is
# one more than anybody wants, so the phrases they must both answer to live in
# one place and both suites read it. A phrase that works on the desktop and not
# on the phone now fails a test instead of being found on a phone.
_SHARED = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "device-intents.json")
    .read_text(encoding="utf-8")
)

PLAY_PHRASINGS = _SHARED["play_on_youtube"]


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


@pytest.mark.parametrize("text", _SHARED["not_a_device_command"])
def test_talking_about_youtube_is_not_a_command_to_open_it(text):
    """Pinned on both sides. Reading a question as an instruction hijacks it:
    the user asks what YouTube is and the app launches it instead of
    answering."""
    action, _ = route(text)
    assert action != "search_youtube", "%r was read as a play command" % text


@pytest.mark.parametrize("text", _SHARED["desktop_only"])
def test_the_desktop_can_still_do_its_own_commands(text):
    """These are the ones the phone honestly cannot, so the desktop must."""
    action, _ = route(text)
    assert action, "%r reaches nothing on the desktop either" % text


# ---------------------------------------------------------------------------
# Desktop commands, in the other word order
# ---------------------------------------------------------------------------
#
# The same fault as the YouTube one, spread across the whole agent: every rule
# was written for one word order and only that one. Twenty of twenty-seven
# ordinary commands reached nothing. The actions all existed and worked -
# take_screenshot, lock_computer, get_battery_status, minimize_all_windows -
# there was simply no sentence that arrived at them.

DESKTOP_PHRASINGS = [
    ("screenshot lo", "take_screenshot"),
    ("screenshot le lo", "take_screenshot"),
    ("screen capture karo", "take_screenshot"),
    ("lock karo", "lock_computer"),
    ("computer lock kar do", "lock_computer"),
    ("sleep kar do", "sleep_computer"),
    ("kitna battery hai", "get_battery_status"),
    ("battery kitni hai", "get_battery_status"),
    ("time kya hua", "get_time"),
    ("window minimize karo", "minimize_all_windows"),
    ("downloads folder kholo", "open_folder"),
    ("sound increase karo", "volume_up"),
]


@pytest.mark.parametrize("text,expected", DESKTOP_PHRASINGS)
def test_desktop_commands_reach_their_action(text, expected):
    action, _ = route(text)
    assert action == expected, f"{text!r} routed to {action!r}"


# The orders that already worked must keep working: the new rules sit above
# the originals, so a mistake there would shadow them silently.
@pytest.mark.parametrize("text,expected", [
    ("take a screenshot", "take_screenshot"),
    ("lock my computer", "lock_computer"),
    ("volume badhao", "volume_up"),
    ("volume kam karo", "volume_down"),
    ("chrome kholo", "open_application"),
])
def test_the_orders_that_already_worked_still_do(text, expected):
    action, _ = route(text)
    assert action == expected, f"{text!r} routed to {action!r}"


@pytest.mark.parametrize("text,expected", [
    # Broadening these rules is exactly how "awaz band karo" was once captured
    # by the media stop rule and muted nothing while stopping the track.
    ("awaz band karo", "toggle_mute"),
    ("band karo", "media_stop"),
    ("gaana band karo", "media_stop"),
    ("open youtube", "open_website"),
    ("ganpati bappa song youtube par play karo", "search_youtube"),
])
def test_the_wider_rules_do_not_swallow_other_commands(text, expected):
    action, _ = route(text)
    assert action == expected, f"{text!r} routed to {action!r}"
