"""Spoken lines that should control the desktop, and lines that should not.

Two faults these cover. A refusal in the middle of a sentence executed the
command it refused — "I do not want you to open chrome" opened Chrome, because
the guard was anchored at the start of the line. And every application pattern
required the verb first, so "open Chrome" worked while "Chrome kholo", which is
how the owner speaks, matched nothing.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.desktop_agent import detect_desktop_intent          # noqa: E402
from app.web_intents import detect_browser_command, is_being_discussed  # noqa: E402


# ---- Hindi and Hinglish word order ----------------------------------------

@pytest.mark.parametrize("said", [
    "chrome kholo",
    "notepad kholo",
    "calculator kholo",
    "vscode kholo",
    "file explorer kholo",
    "chrome khol do",
    "notepad chalu karo",
])
def test_the_verb_may_come_last(said):
    """Hindi puts the verb after the object; English patterns alone miss it."""
    intent = detect_desktop_intent(said)
    assert intent is not None, f"{said!r} was not understood"
    assert intent["action"] == "open_application"


@pytest.mark.parametrize("said", ["open chrome", "launch notepad", "start calculator"])
def test_the_english_order_still_works(said):
    assert detect_desktop_intent(said)["action"] == "open_application"


# ---- talking about a command is not giving one ----------------------------

@pytest.mark.parametrize("said", [
    "I do not want you to open chrome",      # refusal in the middle
    "do not open chrome",
    "please never open notepad",
    "chrome mat kholo",                      # Hindi refusal
    "what does \"open chrome\" do",          # quoted, and a question
    "how do I open chrome",
    "kaise chrome kholo",
])
def test_discussing_a_command_does_not_run_it(said):
    assert detect_desktop_intent(said) is None, f"{said!r} should not act"


@pytest.mark.parametrize("said", [
    "I do not want you to open youtube",
    "don't search for anything",
    "what does \"open youtube\" do",
])
def test_the_browser_refuses_the_same_sentences(said):
    assert detect_browser_command(said) is None, f"{said!r} should not act"


def test_the_guard_is_narrow_enough_to_leave_real_requests_alone():
    """Blocking anything that sounds uncertain would refuse ordinary asks."""
    assert not is_being_discussed("search for quantum computing")
    assert not is_being_discussed("chrome kholo")
    assert not is_being_discussed("can you search for cats")
    # A single apostrophe is not a pair of quotation marks. Written without a
    # leading question word, because a line starting with "what" is caught by
    # the question rule instead and would prove nothing about quoting.
    assert not is_being_discussed("it's urgent, search for cats")


def test_a_question_about_anything_is_left_to_conversation():
    """Not a desktop command, and not treated as one."""
    assert is_being_discussed("what's the weather")
    assert detect_desktop_intent("what's the weather") is None


# ---- saying what was actually done ----------------------------------------

def test_a_youtube_search_is_not_called_playing():
    """It opens a results page. Nothing plays until a video is chosen."""
    result = detect_browser_command("play shape of you on youtube")
    assert result is not None
    assert "results" in result["url"]
    assert "playing" not in result["spoken"].lower(), result["spoken"]
    assert "search" in result["spoken"].lower()
    assert result.get("action") == "search"


def test_the_hinglish_youtube_form_is_understood_and_honest():
    result = detect_browser_command("youtube par arijit singh chalao")
    assert result is not None
    assert "search_query" in result["url"]
    assert "playing" not in result["spoken"].lower()


def test_a_web_search_says_it_is_searching():
    result = detect_browser_command("search for quantum computing")
    assert result is not None
    assert "google.com/search" in result["url"]
    assert "searching" in result["spoken"].lower()


def test_an_empty_line_asks_for_nothing():
    assert detect_browser_command("") is None
    assert detect_desktop_intent("") is None
