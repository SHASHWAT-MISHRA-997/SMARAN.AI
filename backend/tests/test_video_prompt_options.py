"""Reading the shape and length out of the sentence the user typed.

Asking for "a 5 second vertical video of a lantern" and getting a 2 second
landscape one, with nothing said about the difference, is the behaviour this
replaces. The chat path hardcoded seconds=2.0 and no shape at all, so every
video was the same size and the same length no matter what was asked for.

The risk in reading a prompt is reading it wrong, and the damage is not
symmetric. A missed "vertical" costs the user a rotation. A *false* "landscape"
in "a video of a mountain landscape" silently deletes the subject of the prompt
before it reaches the model - so the second half of this file matters more than
the first.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.local_image import read_video_options  # noqa: E402


# ---------------------------------------------------------------------------
# What it must read
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("prompt,seconds", [
    ("make a 5 second video of a lantern", 5.0),
    ("ek 3 second ka video banao", 3.0),
    ("create a 10 sec video of a city", 10.0),
    ("a 2s clip of fireworks", 2.0),
    ("make a 8 seconds video of rain", 8.0),
    ("12 sekand ka video banao", 12.0),
    # Minutes are almost always beyond what a card can decode, but they still
    # have to be *read* - otherwise the refusal names two seconds, a number the
    # user never asked for, and reads as the app malfunctioning.
    ("make a 5 minute video of the ocean", 300.0),
    ("2 min ka video", 120.0),
])
def test_a_stated_length_is_read(prompt, seconds):
    _, found, _ = read_video_options(prompt)
    assert found == seconds, f"{prompt!r} gave {found!r}"


@pytest.mark.parametrize("prompt,aspect", [
    ("9:16 video of a waterfall", "9:16"),
    ("16:9 video of a waterfall", "16:9"),
    ("1:1 video of a coin", "1:1"),
    ("4:3 video of an old film", "4:3"),
    ("portrait mode video of a temple", "9:16"),
    ("vertical video of a lantern", "9:16"),
    ("video in portrait of a temple", "9:16"),
    ("landscape format video of a city", "16:9"),
    ("widescreen video of a desert", "16:9"),
    ("square video of a spinning coin", "1:1"),
    ("reels video of a dancing cat", "9:16"),
    ("youtube shorts video of a cat", "9:16"),
])
def test_a_stated_shape_is_read(prompt, aspect):
    _, _, found = read_video_options(prompt)
    assert found == aspect, f"{prompt!r} gave {found!r}"


def test_both_at_once():
    text, seconds, aspect = read_video_options(
        "make a 5 second vertical video of a lantern")
    assert seconds == 5.0
    assert aspect == "9:16"
    assert "lantern" in text


# ---------------------------------------------------------------------------
# What it must NOT read - the expensive direction
# ---------------------------------------------------------------------------

NOT_SHAPES = [
    # The subject of the prompt, not an orientation.
    "a video of a mountain landscape at sunrise",
    "a video panning across a desert landscape",
    "paint a portrait of a woman, as a video",
    "a video of a wide river",
    "video of a square table in a room",
    "a video of a man in shorts running",
    # A length, not a shape. "short video" as 9:16 would be badly wrong.
    "make a short video of a lantern",
    "a short clip of rain",
]


@pytest.mark.parametrize("prompt", NOT_SHAPES)
def test_ordinary_words_are_not_mistaken_for_a_shape(prompt):
    text, _, aspect = read_video_options(prompt)
    assert aspect is None, f"{prompt!r} was read as {aspect!r}"
    assert text == prompt, (
        f"{prompt!r} was altered to {text!r} - the model would never see the "
        f"missing words"
    )


def test_the_word_video_survives_being_used_as_a_qualifier():
    """"vertical video" once consumed "video" too, leaving "make a of a lantern".

    The prompt reached the model with its subject removed.
    """
    text, _, aspect = read_video_options("vertical video of a lantern")
    assert aspect == "9:16"
    assert "video" in text
    assert "lantern" in text


def test_nothing_stated_means_nothing_invented():
    """None is the signal to use the machine's own default, not a guess here."""
    text, seconds, aspect = read_video_options("a video of a lantern floating")
    assert seconds is None and aspect is None
    assert text == "a video of a lantern floating"


def test_hinglish_without_options_is_untouched():
    prompt = "banao ek video jisme barish ho rahi ho"
    text, seconds, aspect = read_video_options(prompt)
    assert (text, seconds, aspect) == (prompt, None, None)


def test_an_empty_prompt_does_not_crash():
    assert read_video_options("") == ("", None, None)
    assert read_video_options(None) == ("", None, None)


# ---------------------------------------------------------------------------
# The chat path uses it
# ---------------------------------------------------------------------------

def test_the_chat_path_passes_the_choice_to_the_job():
    """Parsing it and then ignoring it would be worse than not parsing it."""
    source = (BACKEND / "app" / "main.py").read_text(encoding="utf-8")
    assert "read_video_options" in source, "chat never reads the options"
    assert "seconds=seconds" in source and "aspect=aspect" in source, (
        "the options are read but the job is still started with fixed settings"
    )
    assert "plan_sequence" in source, (
        "the chat path starts the job without checking it can finish"
    )
    assert "CHAT_VIDEO_AUTOSTART_LIMIT_SECONDS" in source, (
        "chat would start a multi-day render because a sentence said "
        "'5 minute', without quoting the cost first"
    )
