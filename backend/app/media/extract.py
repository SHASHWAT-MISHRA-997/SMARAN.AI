"""Taking a video apart: frames, audio, and what is in it.

None of this needs a model or a key. FFmpeg reads the file and the frames go
to a vision model that is already here, so video-to-images and video-to-text
are a matter of wiring rather than another download.

Frames are sampled rather than exported wholesale. A three-minute clip at
30 fps is 5,400 images, and a vision model asked to read all of them would
take longer than watching the video.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from typing import List, Optional

logger = logging.getLogger(__name__)


class MediaError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def _ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if not found:
        raise MediaError(
            "FFmpeg is not on PATH. It reads and writes the video; without it "
            "nothing here can run. Install it from ffmpeg.org."
        )
    return found


def _ffprobe() -> str:
    found = shutil.which("ffprobe")
    if not found:
        raise MediaError("ffprobe is not on PATH. It ships with FFmpeg.")
    return found


def describe(path: str) -> dict:
    """What the file actually is, read from the file rather than its name."""
    if not os.path.exists(path):
        raise MediaError("No such file: %s" % path)

    try:
        out = subprocess.run(
            [_ffprobe(), "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise MediaError("ffprobe did not finish within 60 seconds.")

    if out.returncode != 0:
        raise MediaError("Could not read %s: %s" % (path, out.stderr.strip()[:200]))

    try:
        data = json.loads(out.stdout)
    except ValueError:
        raise MediaError("ffprobe returned something that is not JSON.")

    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)

    rate = video.get("r_frame_rate") or "0/1"
    try:
        num, den = rate.split("/")
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 0.0

    return {
        "path": path,
        "duration_seconds": round(float(data.get("format", {}).get("duration") or 0), 2),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": round(fps, 2),
        "video_codec": video.get("codec_name"),
        "audio_codec": audio.get("codec_name") if audio else None,
        "has_audio": audio is not None,
        "size_bytes": int(data.get("format", {}).get("size") or 0),
    }


def frames(path: str, out_dir: str, count: int = 8,
           width: int = 640) -> List[str]:
    """Sample `count` frames spread across the whole video.

    Evenly spaced rather than the first N: the opening seconds of a clip are
    often a title card or a fade, and describing those describes nothing.
    """
    info = describe(path)
    duration = info["duration_seconds"]
    if duration <= 0:
        raise MediaError("That file reports no duration, so it cannot be sampled.")

    count = max(1, min(count, 40))
    os.makedirs(out_dir, exist_ok=True)

    written: List[str] = []
    for index in range(count):
        # Offset into the middle of each slice, so the last sample is not the
        # final frame, which is frequently black.
        at = duration * (index + 0.5) / count
        target = os.path.join(out_dir, "frame-%02d.jpg" % index)
        result = subprocess.run(
            [_ffmpeg(), "-y", "-v", "error", "-ss", "%.3f" % at, "-i", path,
             "-frames:v", "1", "-vf", "scale=%d:-1" % width, target],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0 and os.path.exists(target):
            written.append(target)

    if not written:
        raise MediaError("No frame could be read from that file.")
    return written


def audio(path: str, out_path: str) -> str:
    """Pull the audio out as 16 kHz mono WAV, which is what the recogniser wants."""
    info = describe(path)
    if not info["has_audio"]:
        raise MediaError("That video has no audio track.")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    result = subprocess.run(
        [_ffmpeg(), "-y", "-v", "error", "-i", path,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out_path],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0 or not os.path.exists(out_path):
        raise MediaError("Could not extract audio: %s" % result.stderr.strip()[:200])
    return out_path
