"""What counts as "make me a video", and what does not.

The detector was a list of exact phrases - "create a video", "make a video".
Real requests put words between the verb and the thing, and people mistype the
verb. This one was reported:

    Craete a full ultrarealistic + cyber and neon effect video ultrarealistic
    in which one pearson typing in the computer

It contains no phrase from that list, so it was not a video request at all.
With web search on it went down the search path and came back as a summary of
somebody else's YouTube videos - to a person who had asked for a video to be
made.

The cases below are the two failures that matter in both directions: a request
that must be recognised, and a sentence that merely mentions a video and must
not be.
"""

import pytest

from app.local_image import (is_image_generation_request,
                             is_video_generation_request)

WANTS_VIDEO = [
    "Craete a full ultrarealistic + cyber and neon effect video ultrarealistic "
    "in which one pearson typing in the computer",
    "create a video of a sunset",
    "make me a short animation of a cat",
    "generate a 4k cinematic movie about rain",
    "video banao",
    "/video a robot walking",
]

WANTS_IMAGE = [
    "create an image of a mountain",
    "draw a red car",
    "generate a highly detailed cyberpunk poster",
    "tasveer banao",
]

WANTS_NEITHER = [
    # A question about doing it is not a request to do it.
    "how to create a video in premiere pro",
    "kaise video banao",
    "what is the best video codec",
    "summarise this youtube video for me",
    # The verb is there and the object is not a picture.
    "make a coffee then send me the report",
    "explain the project",
    # "draw" is an ordinary English verb too.
    "draw a conclusion from these numbers",
    "draw attention to the bug",
]


@pytest.mark.parametrize("prompt", WANTS_VIDEO)
def test_video_requests_are_recognised(prompt):
    assert is_video_generation_request(prompt) is True
    # A video request contains image-ish words; it must not be answered as one.
    assert is_image_generation_request(prompt) is False


@pytest.mark.parametrize("prompt", WANTS_IMAGE)
def test_image_requests_are_recognised(prompt):
    assert is_image_generation_request(prompt) is True
    assert is_video_generation_request(prompt) is False


@pytest.mark.parametrize("prompt", WANTS_NEITHER)
def test_ordinary_sentences_are_left_alone(prompt):
    assert is_video_generation_request(prompt) is False
    assert is_image_generation_request(prompt) is False
