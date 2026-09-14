"""A generated picture has to survive the whole way to the screen.

Both faults here were invisible from the code and only appeared by driving the
running server the way a person would. Each looked like success from inside:
no exception, no warning, a cheerful response.

1. Asking for a picture was refused as if you had asked to *read* one.

   The chat endpoint guards prompts containing "image", "photo", "picture" and
   refuses them with "No live vision-capable model is available" unless a
   vision model is configured. Those are the same words a generation request is
   made of, so "generate a 4K photo of a snow leopard" was rejected - on a
   machine perfectly able to draw it, with a message about a feature the
   request never wanted. Image and video generation were unreachable through
   chat for anyone without a vision model, which is most people.

   /api/chat cannot carry an image at all - attachments go to
   /api/chat/vision - so the guard could never have been protecting a real
   attachment on this route.

2. The picture was written somewhere it could not be served from.

   The generated file went to os.getenv("DATA_DIR", "./data")/uploads - a
   relative fallback resolved against whatever the working directory happened
   to be - while /api/static is mounted on settings.UPLOAD_DIR. On this machine
   that meant writing to backend/data/uploads and serving data/uploads. The
   generation succeeded, the markdown link came back, and the image 404'd.

Verified end to end against the running server afterwards: a 4K portrait
request returned 200 and served a 2160x3840 PNG of 7,562,126 bytes.
"""

import ast
import inspect
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

MAIN = BACKEND / "app" / "main.py"


# ---------------------------------------------------------------------------
# 1. Asking for a picture is not asking to read one
# ---------------------------------------------------------------------------

def test_the_vision_guard_lets_generation_through():
    source = MAIN.read_text(encoding="utf-8")
    assert "wants_generation" in source, (
        "the vision guard has no exemption for generation requests, so asking "
        "for a photo is refused for want of a vision model"
    )
    guard = source[source.index("vision_keywords ="):]
    guard = guard[:guard.index("raise HTTPException")]
    assert "is_image_generation_request" in guard
    assert "is_video_generation_request" in guard


def test_the_words_that_triggered_it_are_still_generation_requests():
    """If these ever stopped being recognised, the exemption stops working."""
    from app.local_image import is_image_generation_request

    for prompt in (
        "generate a 4K portrait photo of a snow leopard on a rocky ledge",
        "generate an image of a snow leopard",
        "make a picture of a temple",
        "create a photo of a forest",
    ):
        assert is_image_generation_request(prompt), prompt


def test_the_guard_still_exists_for_prompts_about_reading_an_image():
    """Removing it entirely would be the opposite mistake."""
    source = MAIN.read_text(encoding="utf-8")
    assert "No live vision-capable model is available" in source


# ---------------------------------------------------------------------------
# 2. Written where it is served from
# ---------------------------------------------------------------------------

def test_images_are_written_to_the_directory_that_is_served():
    from app import main

    source = inspect.getsource(main.call_sd_txt2img_bridge)
    assert "settings.UPLOAD_DIR" in source, (
        "the image is written to a path built from DATA_DIR rather than the "
        "directory /api/static is mounted on"
    )
    assert 'os.getenv("DATA_DIR"' not in source, (
        "a relative DATA_DIR fallback resolves against the working directory, "
        "which is how the file ended up somewhere it could not be served from"
    )


def test_the_static_mount_and_the_write_path_are_the_same_setting():
    source = MAIN.read_text(encoding="utf-8")
    assert 'app.mount("/api/static", StaticFiles(directory=settings.UPLOAD_DIR)' in source, (
        "the static mount moved; the write path has to move with it"
    )


def test_the_served_url_matches_the_filename_that_was_written():
    from app import main

    source = inspect.getsource(main.call_sd_txt2img_bridge)
    assert "/api/static/{filename}" in source


# ---------------------------------------------------------------------------
# The fake placeholder is gone
# ---------------------------------------------------------------------------

def test_no_placeholder_image_is_left_to_be_returned():
    """It drew "SMARAN.AI GRAPHICS ENGINE" and the prompt as text on a grid and
    returned that as the generated picture - the image twin of the fallback
    video that was removed earlier. It had no callers, and it carried the same
    unservable path."""
    source = MAIN.read_text(encoding="utf-8")
    assert "GRAPHICS ENGINE" not in source
    assert "generate_fallback_image" not in source


def test_nothing_else_builds_an_upload_path_from_a_relative_default():
    """The same mistake anywhere else has the same result: a file written
    outside the directory the app serves."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        rendered = ast.unparse(node)
        if "uploads" in rendered and 'getenv("DATA_DIR", "./data")' in rendered:
            offenders.append(rendered[:90])
    assert not offenders, "upload paths still built from a relative default: %r" % offenders
