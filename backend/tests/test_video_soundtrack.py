"""Sound under a generated clip, and being straight about what it is.

"Video mai audio aa hi nahi raha hai" - there was no audio, and there was no
bug either. LTX-Video has no audio head; it cannot produce sound, and no
setting makes it. So the only honest options were to say that, or to generate
a soundtrack with a second model and lay it underneath.

The second one is what happens, and it comes with a claim that is easy to get
wrong. MusicGen never sees the video. It writes music from the same words the
picture was made from, so it will not match anything on screen. Describing
that as "audio from the video" would be false, and these tests hold the
wording as much as the behaviour.

The model is a 2.2 GB download and is not fetched unless asked for, so almost
everything here runs without it - which is the state most machines are in.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.video import continuity, soundtrack  # noqa: E402

ffmpeg = continuity.ffmpeg_path()
needs_ffmpeg = pytest.mark.skipif(not ffmpeg, reason="ffmpeg is not available")
installed = soundtrack.status().get("installed")


def make_silent_clip(path, seconds=1.0):
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", "color=c=red:s=320x240:d=%s:r=24" % seconds,
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return str(path)


def make_tone(path, seconds=1.0):
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=%s" % seconds, str(path)],
        check=True,
    )
    return str(path)


# ---------------------------------------------------------------------------
# What it says about itself
# ---------------------------------------------------------------------------

def test_status_never_claims_the_video_model_makes_sound():
    state = soundtrack.status()
    assert "silent" in state["note"].lower(), (
        "nothing tells the user the video model produces no audio at all"
    )
    assert "does not watch the video" in state["note"], (
        "the note implies the music is matched to the picture"
    )


def test_status_names_the_download_rather_than_starting_it():
    state = soundtrack.status()
    assert state["approx_download_gb"] > 0
    assert state["model"]
    if not state["installed"]:
        assert "only fetched if you ask" in state["reason"], (
            "a 2.2 GB download must be offered, not assumed"
        )


def test_a_missing_model_is_an_honest_refusal_not_a_fake_tone(tmp_path):
    """Synthesising a sine wave and calling it a soundtrack would be worse
    than having none."""
    if installed:
        pytest.skip("the model is installed on this machine")
    with pytest.raises(soundtrack.SoundtrackError) as caught:
        soundtrack.generate_track("a calm forest", 2.0, str(tmp_path / "a.wav"))
    assert "no soundtrack model is installed" in str(caught.value).lower()
    assert not (tmp_path / "a.wav").exists(), "a file was written anyway"


# ---------------------------------------------------------------------------
# Muxing - real ffmpeg, no model needed
# ---------------------------------------------------------------------------

@needs_ffmpeg
def test_a_silent_clip_is_detected_as_silent(tmp_path):
    """has_audio is the check that stops 'sound added' being said blindly."""
    clip = make_silent_clip(tmp_path / "v.mp4")
    assert soundtrack.has_audio(clip) is False


@needs_ffmpeg
def test_audio_laid_under_a_clip_is_really_there(tmp_path):
    clip = make_silent_clip(tmp_path / "v.mp4", 1.0)
    tone = make_tone(tmp_path / "a.wav", 1.0)
    out = str(tmp_path / "out.mp4")
    soundtrack.mux(clip, tone, out)
    assert soundtrack.has_audio(out) is True, "the muxed file has no audio stream"


@needs_ffmpeg
def test_the_result_is_as_long_as_the_picture(tmp_path):
    """Audio longer than the video must not extend it past its last frame."""
    clip = make_silent_clip(tmp_path / "v.mp4", 1.0)
    tone = make_tone(tmp_path / "a.wav", 5.0)
    out = str(tmp_path / "out.mp4")
    soundtrack.mux(clip, tone, out)
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", out],
                           capture_output=True, text=True)
    assert "Duration: 00:00:01" in probe.stderr, (
        "a 5 second track stretched a 1 second clip"
    )


@needs_ffmpeg
def test_the_picture_is_not_re_encoded(tmp_path):
    """It has already been through one lossy pass; a second softens it."""
    import inspect

    source = inspect.getsource(soundtrack.mux)
    assert '"-c:v", "copy"' in source, "the video stream is re-encoded to add sound"


def test_missing_inputs_are_refused_by_name(tmp_path):
    with pytest.raises(soundtrack.SoundtrackError):
        soundtrack.mux(str(tmp_path / "none.mp4"), str(tmp_path / "none.wav"),
                       str(tmp_path / "o.mp4"))


def test_has_audio_on_a_missing_file_is_false_not_an_error(tmp_path):
    assert soundtrack.has_audio(str(tmp_path / "nothing.mp4")) is False


# ---------------------------------------------------------------------------
# The job path
# ---------------------------------------------------------------------------

def test_a_failed_soundtrack_does_not_discard_the_video():
    """An hour of rendering must not be thrown away because music failed."""
    import inspect

    from app.video import routes

    source = inspect.getsource(routes._add_sound_and_size)
    assert "except SoundtrackError" in source, (
        "a soundtrack failure propagates and fails the whole job"
    )


def test_audio_is_reported_from_the_file_not_from_intent():
    import inspect

    from app.video import routes

    source = inspect.getsource(routes._add_sound_and_size)
    assert 'result["has_audio"] = has_audio(' in source, (
        "the job reports audio because it asked for it, not because it is there"
    )
