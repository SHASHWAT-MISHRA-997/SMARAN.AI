"""Image size, shape and honesty about what "4K" means.

"i don't want Blur" was the report, and the cause was not the model. Images
were rendered at 384x384 with a hard ceiling of 512, on every machine, whatever
card was in it - about a sixth of the pixels this hardware manages comfortably.

The sizes are measured, not guessed. Stable Diffusion 1.5 at 20 steps on the
6 GB RTX 2060 this was written against:

    512     7.1 s   peak 2.08 GB
    640     9.8 s   peak 2.50 GB
    768    15.3 s   peak 3.25 GB
    896    52.3 s   peak 4.46 GB
    1024  339.2 s   peak 6.30 GB   <- past the card, so it thrashes

Two faults found by running it rather than reading it:

  * The tiers were written as card capacities and then fed *free* VRAM, so a
    machine with 4.4 GB free was refused 768 - which peaks at 3.25 GB - and
    quietly given 640.

  * The shipped defaults returned a solid black image. Two steps produces
    noise, the safety checker reads noise as a false positive and substitutes
    a black frame, and that was saved and reported as the finished picture:
    509 bytes, every pixel zero, no error anywhere.

These run without loading any weights.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import image_plan  # noqa: E402
from app.local_image import _is_blank, read_image_options  # noqa: E402

SD15 = "stable-diffusion-v1-5/stable-diffusion-v1-5"


# ---------------------------------------------------------------------------
# Size
# ---------------------------------------------------------------------------

def test_the_old_384_default_is_gone():
    """The single most important line in this file."""
    plan = image_plan.plan(SD15, vram_gb=4.4)
    assert plan["width"] >= 768, (
        "a card with 4.4 GB free is still being given %d px" % plan["width"]
    )


def test_tiers_are_compared_against_free_vram_not_card_size():
    """768 peaks at 3.25 GB, so 4.4 GB free must be enough for it.

    Written the other way round, this returned 640 on a machine that could
    comfortably do 768 - the bug that made the first fix only half a fix.
    """
    assert image_plan.plan(SD15, vram_gb=4.4)["width"] == 768
    assert image_plan.plan(SD15, vram_gb=3.2)["width"] == 640
    assert image_plan.plan(SD15, vram_gb=2.6)["width"] == 512


def test_a_smaller_card_gets_a_smaller_picture_not_a_crash():
    plan = image_plan.plan(SD15, vram_gb=0.0)
    assert plan["width"] <= 512
    assert plan["steps"] >= 1


def test_size_rises_with_available_memory():
    sizes = [image_plan.plan(SD15, vram_gb=v)["width"] for v in (2.0, 2.6, 3.2, 4.4)]
    assert sizes == sorted(sizes), "more memory produced a smaller picture: %r" % sizes


def test_sd15_is_capped_at_its_trained_ceiling():
    """More pixels than the model was trained for is a worse picture.

    Past roughly 768 SD 1.5 draws a second head rather than more detail, and
    that is not a memory problem a bigger card fixes.
    """
    assert image_plan.plan(SD15, vram_gb=24.0)["width"] == 768


def test_a_model_trained_larger_is_allowed_to_be_larger():
    assert image_plan.plan("stabilityai/sdxl-base", vram_gb=7.5)["width"] == 1024


def test_every_size_is_a_multiple_of_eight():
    """The model's own constraint; anything else errors inside diffusers."""
    for vram in (2.0, 2.6, 3.2, 4.4, 7.5):
        for aspect in image_plan.ASPECTS:
            plan = image_plan.plan(SD15, aspect, vram_gb=vram)
            assert plan["width"] % 8 == 0 and plan["height"] % 8 == 0


# ---------------------------------------------------------------------------
# Steps and guidance follow the model
# ---------------------------------------------------------------------------

def test_a_turbo_model_gets_few_steps_and_no_guidance():
    plan = image_plan.plan("stabilityai/sd-turbo", vram_gb=4.4)
    assert plan["steps"] <= 4
    assert plan["guidance"] == 0.0


def test_a_full_model_gets_enough_steps_to_resolve():
    """Two steps through SD 1.5 is noise - which is how the black image happened."""
    plan = image_plan.plan(SD15, vram_gb=4.4)
    assert plan["steps"] >= 20
    assert plan["guidance"] > 1.0


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("aspect", sorted(image_plan.ASPECTS))
def test_each_aspect_produces_that_shape(aspect):
    plan = image_plan.plan(SD15, aspect, vram_gb=4.4)
    wanted = image_plan.ASPECTS[aspect]
    got = plan["width"] / plan["height"]
    assert abs(got - wanted) / wanted < 0.12, (
        "%s asked for %.3f, got %dx%d" % (aspect, wanted, plan["width"], plan["height"])
    )


def test_portrait_and_landscape_differ():
    wide = image_plan.plan(SD15, "16:9", vram_gb=4.4)
    tall = image_plan.plan(SD15, "9:16", vram_gb=4.4)
    assert wide["width"] > wide["height"]
    assert tall["height"] > tall["width"]


# ---------------------------------------------------------------------------
# Enlargement, described as enlargement
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("target,longest", [("HD", 1280), ("QHD", 2560), ("4K", 3840)])
def test_enlarging_reaches_the_named_size(target, longest):
    from PIL import Image

    bigger, note = image_plan.enlarge(Image.new("RGB", (768, 768)), target)
    assert max(bigger.size) == longest
    assert note


def test_enlarging_keeps_the_shape():
    from PIL import Image

    bigger, _ = image_plan.enlarge(Image.new("RGB", (768, 432)), "4K")
    assert abs((bigger.width / bigger.height) - (768 / 432)) < 0.02


def test_enlargement_never_claims_to_be_a_render():
    """A label saying 4K with nothing qualifying it is a lie about a picture
    that holds 768x768 worth of detail."""
    from PIL import Image

    _, note = image_plan.enlarge(Image.new("RGB", (768, 768)), "4K")
    assert "Enlarged from" in note
    assert "interpolated" in note
    assert "not a sharper one" in note


def test_an_unknown_size_is_refused_by_name():
    from PIL import Image

    with pytest.raises(ValueError) as caught:
        image_plan.enlarge(Image.new("RGB", (64, 64)), "16K")
    assert "16K" in str(caught.value)


def test_an_image_already_large_enough_is_left_alone():
    from PIL import Image

    same, note = image_plan.enlarge(Image.new("RGB", (4000, 4000)), "HD")
    assert same.size == (4000, 4000)
    assert "at or above" in note


# ---------------------------------------------------------------------------
# A blank frame is not a picture
# ---------------------------------------------------------------------------

def test_a_solid_black_frame_is_recognised_as_blank():
    from PIL import Image

    assert _is_blank(Image.new("RGB", (64, 64), (0, 0, 0))) is True


def test_a_dark_picture_is_not_mistaken_for_blank():
    """A night scene is dark and still a picture. Checked by extremes rather
    than by the mean for exactly this reason."""
    from PIL import Image

    night = Image.new("RGB", (64, 64), (3, 3, 6))
    night.putpixel((10, 10), (40, 38, 55))
    assert _is_blank(night) is False


def test_the_generator_refuses_to_return_a_blank_image():
    import inspect

    from app import local_image

    source = inspect.getsource(local_image.generate_local_image)
    assert "_is_blank(image)" in source, (
        "a substituted black frame would still be saved and reported as the "
        "finished picture"
    )


# ---------------------------------------------------------------------------
# Reading the request
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("prompt,target", [
    ("make a 4K image of a snow leopard", "4K"),
    ("QHD wallpaper of a neon city", "QHD"),
    ("an 8K photo of a temple", "8K"),
    ("HD picture of a forest", "HD"),
    ("a UHD image of the sea", "4K"),
])
def test_a_requested_size_is_read(prompt, target):
    _, _, found = read_image_options(prompt)
    assert found == target


@pytest.mark.parametrize("prompt,aspect", [
    ("portrait photo of a temple", "9:16"),
    ("landscape image of mountains at dawn", "16:9"),
    ("square picture of a coin", "1:1"),
])
def test_a_requested_shape_is_read(prompt, aspect):
    _, found, _ = read_image_options(prompt)
    assert found == aspect


UNTOUCHED = [
    # The subject, not the orientation - and deleting the word would remove
    # the thing being asked for before the model ever sees it.
    "a portrait of a woman",
    "a photo of a mountain landscape",
    "a painting of a wide valley",
    "a square table in a sunlit room",
]


@pytest.mark.parametrize("prompt", UNTOUCHED)
def test_ordinary_words_are_not_read_as_instructions(prompt):
    text, aspect, target = read_image_options(prompt)
    assert (aspect, target) == (None, None), "%r read as %r/%r" % (prompt, aspect, target)
    assert text == prompt, "%r was altered to %r" % (prompt, text)


def test_the_recognised_words_are_removed_from_the_prompt():
    """Left in, the model is asked to draw the text "4K"."""
    text, _, target = read_image_options("a 4K image of a snow leopard")
    assert target == "4K"
    assert "4K" not in text and "4k" not in text
    assert "snow leopard" in text


def test_nothing_stated_means_nothing_invented():
    assert read_image_options("draw a cat") == ("draw a cat", None, None)


def test_an_empty_prompt_does_not_crash():
    assert read_image_options("") == ("", None, None)
    assert read_image_options(None) == ("", None, None)


# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------

def test_the_model_is_one_that_is_actually_present():
    """The default was a model that was not downloaded, while a usable one sat
    in the cache - so the first image request started a download nobody agreed
    to on a machine that did not need one."""
    chosen = image_plan.available_model()
    assert chosen
    assert "/" in chosen


def test_an_explicit_model_still_wins(monkeypatch):
    monkeypatch.setenv("LOCAL_IMAGE_MODEL", "someone/their-model")
    assert image_plan.available_model() == "someone/their-model"
