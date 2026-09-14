"""Longer clips, joining, enlargement - and what each of them honestly is.

The request behind this file was "at least a 5 minute video, and not looping".
Both halves needed work and only one of them was possible.

Not looping is fixed properly: each clip is conditioned on the last frame of
the one before, so the picture moves forward instead of repeating. (The loop
the user actually saw was worse than a model problem - it was a `loop`
attribute on a preview page I built. The clip was 1.71 seconds and played
over and over because I told it to.)

Five minutes is not fixed, because it cannot be. The decode holds every frame
at full resolution in VRAM at once, so on a 6 GB card a single pass caps out
below two seconds, and five minutes is a chain of about 176 clips - roughly
175 hours. The planner returns that number up front rather than discovering it
after an evening of rendering, and these tests pin that it stays honest.

The ffmpeg tests build their own clips with lavfi, so they exercise the real
binary without needing the model.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.video import continuity  # noqa: E402
from app.video.planner import _round_frames, decode_will_fit  # noqa: E402

ffmpeg = continuity.ffmpeg_path()
needs_ffmpeg = pytest.mark.skipif(not ffmpeg, reason="ffmpeg is not available")


def make_clip(path, colour="red", seconds=0.3, size="160x96", fps=24):
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", "color=c=%s:s=%s:d=%s:r=%d" % (colour, size, seconds, fps),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return str(path)


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("wanted", [1.5, 2.0, 3.0, 5.0, 10.0])
def test_a_sequence_lands_on_the_length_that_was_asked_for(wanted):
    """Within one chunk. Overshooting is as wrong as falling short.

    An earlier version multiplied the chunk length by the chunk count and
    answered a 2 second request with 3.4 seconds of video.
    """
    plan = continuity.plan_sequence(wanted, aspect="16:9")
    assert plan["possible"]
    assert plan["total_seconds"] <= wanted + plan["chunk_seconds"]
    assert plan["total_seconds"] >= wanted - plan["chunk_seconds"]


def test_every_chunk_is_the_same_size():
    """Clips of different dimensions cannot be joined by stream copy.

    Planning each chunk independently looked right and was not: the planner
    shrinks resolution to fit a longer piece, so a short final chunk came back
    smaller than the rest and the join would have failed.
    """
    plan = continuity.plan_sequence(10.0, aspect="16:9")
    for length in plan["chunk_durations"]:
        frames = _round_frames(length, plan["fps"])
        assert decode_will_fit(plan["width"], plan["height"], frames) is None, (
            "a chunk of %.2fs does not decode at the sequence's own size" % length
        )


def test_the_reported_total_is_the_sum_of_the_real_chunks():
    plan = continuity.plan_sequence(5.0, aspect="16:9")
    assert plan["total_seconds"] == pytest.approx(sum(plan["chunk_durations"]), abs=0.05)
    assert plan["chunks"] == len(plan["chunk_durations"])


def test_resolution_is_held_and_length_is_chunked():
    """Given the choice, chunk rather than shrink.

    Asking the planner about 3 seconds directly returns a smaller picture,
    because it shrinks resolution until a single pass fits. Softness is the
    complaint this is meant to answer and length is what chunking is for, so
    the sequence keeps the full size and adds clips instead.
    """
    from app.video.planner import plan_clip

    shortest = plan_clip(seconds=0.4, aspect="16:9")
    for wanted in (3.0, 5.0, 10.0):
        plan = continuity.plan_sequence(wanted, aspect="16:9")
        assert (plan["width"], plan["height"]) == (shortest["width"], shortest["height"]), (
            "a %.0fs sequence dropped resolution instead of adding a clip" % wanted
        )


def test_a_long_request_is_answered_with_its_real_cost():
    """Five minutes is possible and absurd. Both facts are reported."""
    plan = continuity.plan_sequence(300.0, aspect="16:9")
    assert plan["possible"] is True
    assert plan["chunks"] > 100
    assert plan["estimate_seconds"] > 3600 * 24, (
        "a 5 minute chain on this class of card is days of work; an estimate "
        "that says otherwise is the thing being guarded against"
    )
    assert "hours" in plan["estimate_text"]


def test_a_multi_clip_plan_says_what_it_actually_is():
    plan = continuity.plan_sequence(10.0, aspect="16:9")
    assert plan["chunks"] > 1
    assert plan["caveat"], "a chain of continuations is described as one shot"
    assert "not a single unbroken shot" in plan["caveat"]


def test_a_single_clip_makes_no_such_claim():
    plan = continuity.plan_sequence(1.0, aspect="16:9")
    assert plan["chunks"] == 1
    assert plan["caveat"] == ""


def test_the_planner_does_not_run_away():
    """A loop bounded by subtraction can fail to terminate if a chunk is 0."""
    plan = continuity.plan_sequence(100000.0, aspect="16:9")
    assert plan["chunks"] <= continuity._MAX_CHUNKS


# ---------------------------------------------------------------------------
# Joining
# ---------------------------------------------------------------------------

@needs_ffmpeg
def test_clips_are_joined_into_their_total_length(tmp_path):
    parts = [make_clip(tmp_path / ("p%d.mp4" % i), c, 1.0)
             for i, c in enumerate(["red", "green", "blue"])]
    out = str(tmp_path / "joined.mp4")
    continuity.concatenate(parts, out)
    assert os.path.getsize(out) > 0
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", out],
                           capture_output=True, text=True)
    assert "Duration: 00:00:03" in probe.stderr, (
        "three one-second clips did not produce three seconds"
    )


@needs_ffmpeg
def test_joining_one_clip_is_just_that_clip(tmp_path):
    only = make_clip(tmp_path / "one.mp4", "red", 1.0)
    out = str(tmp_path / "out.mp4")
    continuity.concatenate([only], out)
    assert os.path.getsize(out) == os.path.getsize(only)


@needs_ffmpeg
def test_the_last_frame_is_the_last_frame(tmp_path):
    """The chain depends on this. Off by one shows as a jump at every join."""
    from PIL import Image

    parts = [make_clip(tmp_path / ("p%d.mp4" % i), c, 1.0)
             for i, c in enumerate(["red", "green", "blue"])]
    joined = str(tmp_path / "j.mp4")
    continuity.concatenate(parts, joined)
    still = continuity.last_frame(joined, str(tmp_path / "last.png"))

    image = Image.open(still).convert("RGB")
    red, green, blue = image.getpixel((image.width // 2, image.height // 2))
    assert blue > 200 and red < 60 and green < 60, (
        "the extracted frame is not from the final clip (got %r)" % ((red, green, blue),)
    )


@needs_ffmpeg
def test_joining_nothing_is_an_error_not_an_empty_file(tmp_path):
    with pytest.raises(continuity.ContinuityError):
        continuity.concatenate([], str(tmp_path / "out.mp4"))


# ---------------------------------------------------------------------------
# Enlargement
# ---------------------------------------------------------------------------

@needs_ffmpeg
@pytest.mark.parametrize("target,height", [("HD", 720), ("QHD", 1440), ("4K", 2160)])
def test_enlarging_reaches_the_named_height(tmp_path, target, height):
    src = make_clip(tmp_path / "s.mp4", "red")
    out = str(tmp_path / ("%s.mp4" % target))
    result = continuity.upscale(src, out, target)
    assert result["to"][1] == height
    # h264 with yuv420p cannot encode an odd width.
    assert result["to"][0] % 2 == 0


@needs_ffmpeg
def test_enlarging_preserves_the_shape(tmp_path):
    src = make_clip(tmp_path / "s.mp4", "red", size="416x736")
    result = continuity.upscale(src, str(tmp_path / "o.mp4"), "QHD")
    before = result["from"][0] / result["from"][1]
    after = result["to"][0] / result["to"][1]
    assert abs(before - after) < 0.02, "a portrait clip came back a different shape"


@needs_ffmpeg
def test_enlargement_says_it_is_not_a_render(tmp_path):
    """The whole point. "4K" on a label with nothing qualifying it is a lie
    about a picture that holds 736x416 worth of detail."""
    src = make_clip(tmp_path / "s.mp4", "red")
    result = continuity.upscale(src, str(tmp_path / "o.mp4"), "4K")
    assert "Enlarged from" in result["detail"]
    assert "not rendered at" in result["detail"]
    assert "interpolated" in result["detail"]


def test_an_unknown_size_is_refused_by_name(tmp_path):
    with pytest.raises(continuity.ContinuityError) as caught:
        continuity.upscale(str(tmp_path / "nope.mp4"), str(tmp_path / "o.mp4"), "16K")
    assert "16K" in str(caught.value)
