"""Sound for a generated clip.

Worth being exact about what this is, because the obvious assumption is wrong.

LTX-Video is a silent model. It does not produce audio, and there is no
setting that makes it: the weights have no audio head. So a clip coming back
without sound is not a bug in this app, and nothing here can extract sound
that was never generated.

What can be done is generate a separate soundtrack from the same prompt and
lay it under the picture. That is a *different* model - MusicGen - doing a
different job, and it is music rather than sound effects: it does not watch
the video, so it will not match footsteps to feet. Calling that "audio from
the video" would be a lie, so the app says "a soundtrack generated from your
prompt" wherever it appears.

The weights are about 2.2 GB and are not downloaded unless asked for, in
keeping with how the video packages are handled. Without them this module
reports that plainly instead of inventing a tone generator and calling it
music.
"""

from __future__ import annotations

import logging
import os
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# The small model, deliberately. On a card that is already offloading layers to
# run the video, the medium and large variants cost more than the soundtrack is
# worth, and MusicGen runs acceptably on CPU at this size.
MODEL_ID = "facebook/musicgen-small"
APPROX_DOWNLOAD_GB = 2.4
SAMPLE_RATE = 32000

# Only the files transformers actually reads.
#
# Fetching the repository wholesale pulls 5.8 GB for a 2.4 GB model: the same
# weights arrive twice, once as model.safetensors and again as the older
# pytorch_model.bin, and state_dict.bin plus compression_state_dict.bin are
# audiocraft's format, which nothing here loads. Measured on a real download -
# 5.81 GB in 13 files where 2.36 GB was needed. Naming the files is the
# difference between a five minute wait and a quarter of an hour.
_WANTED = [
    "*.json",
    "*.model",
    "model.safetensors",
    "preprocessor_config.json",
    "spiece.model",
    "tokenizer.json",
]


class SoundtrackError(RuntimeError):
    """Raised with a message written to be shown to the user."""


def _cache_root() -> str:
    return os.path.join(
        os.path.expanduser("~"), ".cache", "huggingface", "hub",
        "models--" + MODEL_ID.replace("/", "--"),
    )


def status() -> dict:
    """Whether a soundtrack can be made, and what it would take."""
    try:
        import transformers  # noqa: F401
    except ImportError:
        return {
            "available": False,
            "installed": False,
            "can_install": False,
            "reason": (
                "The video packages are not installed, and the soundtrack "
                "model needs them."
            ),
            "approx_download_gb": APPROX_DOWNLOAD_GB,
            "model": MODEL_ID,
        }

    root = _cache_root()
    present = os.path.isdir(root) and any(
        name.endswith(".safetensors") or name.endswith(".bin")
        for _, _, files in os.walk(root) for name in files
    )
    return {
        "available": present,
        "installed": present,
        "can_install": True,
        "reason": "" if present else (
            "No soundtrack model is installed. %s is about %.1f GB and is "
            "only fetched if you ask for it."
            % (MODEL_ID, APPROX_DOWNLOAD_GB)
        ),
        "approx_download_gb": APPROX_DOWNLOAD_GB,
        "model": MODEL_ID,
        # Said here so it reaches every caller rather than one screen.
        "note": (
            "The video model itself is silent. This generates music from the "
            "same prompt and lays it underneath; it does not watch the video, "
            "so it will not line up with what happens on screen."
        ),
    }


def install(progress: Optional[Callable[[str], None]] = None) -> dict:
    """Fetch the soundtrack weights, and only the ones that get used."""
    state = status()
    if state["installed"]:
        return {"installed": True, "detail": "Already installed."}
    if not state["can_install"]:
        raise SoundtrackError(state["reason"])

    from huggingface_hub import snapshot_download

    if progress:
        progress("Fetching %s, about %.1f GB." % (MODEL_ID, APPROX_DOWNLOAD_GB))
    path = snapshot_download(MODEL_ID, allow_patterns=_WANTED)
    return {"installed": True, "path": path}


def generate_track(
    prompt: str,
    seconds: float,
    output_path: str,
    progress: Optional[Callable[[str], None]] = None,
) -> str:
    """Write a WAV of roughly `seconds` length generated from `prompt`."""
    state = status()
    if not state["installed"]:
        raise SoundtrackError(state["reason"])

    import numpy as np
    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    if progress:
        progress("Composing a soundtrack from your prompt.")

    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = MusicgenForConditionalGeneration.from_pretrained(MODEL_ID)

    try:
        # MusicGen counts in tokens, at 50 per second of audio. Asking in
        # seconds and converting here keeps the caller in one unit.
        tokens = max(16, int(round(seconds * 50)))
        inputs = processor(text=[prompt], padding=True, return_tensors="pt")
        with torch.no_grad():
            audio = model.generate(**inputs, do_sample=True, max_new_tokens=tokens)
        samples = audio[0, 0].cpu().numpy()
    finally:
        del model

    # Normalised before writing: MusicGen's output sits well below full scale,
    # and under a video it is otherwise inaudible at ordinary volume.
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0:
        samples = samples / peak * 0.89

    from scipy.io import wavfile

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    wavfile.write(output_path, SAMPLE_RATE, (samples * 32767).astype("int16"))
    return output_path


def mux(video_path: str, audio_path: str, output_path: str) -> str:
    """Lay an audio track under a video.

    The video stream is copied rather than re-encoded - it has already been
    through one lossy pass and a second would soften it further for no reason.
    """
    from .continuity import ContinuityError, _run

    if not os.path.isfile(video_path):
        raise SoundtrackError("There is no video to add sound to.")
    if not os.path.isfile(audio_path):
        raise SoundtrackError("There is no audio to add.")

    try:
        _run(
            [
                "-i", video_path, "-i", audio_path,
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                # The soundtrack is generated to the clip's length, but
                # rounding leaves a fraction of a second either way. -shortest
                # trims to the picture so the file never ends on silence or a
                # frozen last frame.
                "-shortest",
                "-map", "0:v:0", "-map", "1:a:0",
                output_path,
            ],
            "Adding the soundtrack",
        )
    except ContinuityError as exc:
        raise SoundtrackError(str(exc)) from exc
    return output_path


def has_audio(path: str) -> bool:
    """Whether a file actually carries an audio stream.

    Used to verify the result rather than trusting that ffmpeg was asked to
    add one - "I added audio" without checking is how a silent file gets
    reported as having sound.
    """
    import subprocess

    from .continuity import ffmpeg_path

    exe = ffmpeg_path()
    if not exe or not os.path.isfile(path):
        return False
    try:
        done = subprocess.run(
            [exe, "-hide_banner", "-i", path], capture_output=True, text=True, timeout=60,
        )
    except Exception:  # noqa: BLE001
        logger.warning("could not inspect %s", path, exc_info=True)
        return False
    return "Stream #" in done.stderr and "Audio:" in done.stderr
