"""Joining the rendered shots into one file.

Every clip comes out of the same pipeline at the same size and frame rate, so
this can concatenate the streams without re-encoding them. That is exact:
the assembled file holds the same frames the model produced, not a second
generation of lossy compression over them.

The equality is checked rather than assumed. If two clips disagree on size,
frame rate or codec, stream copy would produce a file that plays wrong or
not at all, so this falls back to re-encoding and says which clip forced it.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from typing import List, Optional

from app.media.extract import MediaError, _ffmpeg, describe

logger = logging.getLogger(__name__)


def _signature(info: dict) -> tuple:
    return (info["width"], info["height"], info["fps"], info["video_codec"])


def concat(clips: List[str], output_path: str,
           progress: Optional[callable] = None) -> dict:
    """Join `clips` in order. Returns what was written and how."""
    if not clips:
        raise MediaError("There are no clips to join.")

    missing = [c for c in clips if not os.path.exists(c)]
    if missing:
        raise MediaError(
            "%d of the clips are not on disk, the first being %s."
            % (len(missing), missing[0])
        )

    infos = [describe(c) for c in clips]
    signatures = {_signature(i) for i in infos}
    uniform = len(signatures) == 1

    reason = ""
    if not uniform:
        first = _signature(infos[0])
        odd = next(i for i, info in enumerate(infos) if _signature(info) != first)
        reason = (
            "Clip %d is %sx%s at %s fps (%s) where clip 1 is %sx%s at %s fps "
            "(%s), so the streams cannot be copied and were re-encoded."
            % (odd + 1, infos[odd]["width"], infos[odd]["height"],
               infos[odd]["fps"], infos[odd]["video_codec"],
               infos[0]["width"], infos[0]["height"], infos[0]["fps"],
               infos[0]["video_codec"])
        )
        logger.warning(reason)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

    # The concat demuxer reads a list file. Paths are written as ffmpeg's
    # own escaping expects, and the file lives beside the output so a
    # temp directory on another volume cannot break relative resolution.
    handle = tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, encoding="utf-8",
        dir=os.path.dirname(os.path.abspath(output_path)),
    )
    try:
        for clip in clips:
            escaped = os.path.abspath(clip).replace("\\", "/").replace("'", r"'\''")
            handle.write("file '%s'\n" % escaped)
        handle.close()

        command = [_ffmpeg(), "-y", "-v", "error", "-f", "concat",
                   "-safe", "0", "-i", handle.name]
        if uniform:
            command += ["-c", "copy"]
        else:
            command += ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
                        "-pix_fmt", "yuv420p"]
        command.append(output_path)

        if progress:
            progress("Joining %d clips%s."
                     % (len(clips), "" if uniform else " with a re-encode"))

        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=1800)
        if result.returncode != 0 or not os.path.exists(output_path):
            raise MediaError(
                "Joining failed: %s" % (result.stderr.strip()[:300] or "no output")
            )
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass

    final = describe(output_path)
    # Reported from the file that exists, not from the sum of the requests.
    return {
        "path": output_path,
        "clips": len(clips),
        "duration_seconds": final["duration_seconds"],
        "width": final["width"],
        "height": final["height"],
        "fps": final["fps"],
        "size_bytes": final["size_bytes"],
        "stream_copied": uniform,
        "reencode_reason": reason,
    }
