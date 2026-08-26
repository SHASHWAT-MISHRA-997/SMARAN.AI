"""HTTP surface for reading video files.

video-to-images and video-to-text without another model download: FFmpeg takes
the file apart, and the frames go to the vision model already installed.

Describing a video is deliberately split from extracting it. Someone who wants
the frames should not wait on a language model, and someone who wants a
description should not have to ask for the frames first.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .extract import MediaError, audio, describe, frames

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["media"])

_jobs: dict = {}
_jobs_lock = threading.Lock()


class PathRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=1000)


class FramesRequest(PathRequest):
    count: int = Field(8, ge=1, le=40)
    width: int = Field(640, ge=128, le=1920)


@router.post("/describe")
async def describe_route(req: PathRequest):
    """What the file is: duration, size, codecs, whether it has audio."""
    try:
        return describe(req.path)
    except MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/frames")
async def frames_route(req: FramesRequest):
    """Sample frames across the whole video and return where they were written."""
    from app.config import settings

    out_dir = os.path.join(settings.DATA_DIR, "frames", uuid.uuid4().hex[:12])
    try:
        written = frames(req.path, out_dir, count=req.count, width=req.width)
    except MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "directory": out_dir,
        "count": len(written),
        "frames": written,
        "note": (
            "Sampled evenly across the whole video, not the first frames: an "
            "opening title card describes nothing about the content."
        ),
    }


@router.post("/audio")
async def audio_route(req: PathRequest):
    """Pull the audio out as 16 kHz mono WAV, ready for transcription."""
    from app.config import settings

    out_dir = os.path.join(settings.DATA_DIR, "audio")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "%s.wav" % uuid.uuid4().hex[:12])
    try:
        audio(req.path, out_path)
    except MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"path": out_path, "sample_rate": 16000, "channels": 1}


@router.post("/cleanup")
async def cleanup(req: PathRequest):
    """Remove a directory this module created.

    Scoped to the data directory on purpose: a path from a caller is not a
    licence to delete anywhere on the disk.
    """
    from app.config import settings

    root = os.path.abspath(settings.DATA_DIR)
    target = os.path.abspath(req.path)
    if not target.startswith(root + os.sep):
        raise HTTPException(
            status_code=400,
            detail="Only paths inside the app's own data directory can be removed.",
        )
    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="No such directory.")

    shutil.rmtree(target, ignore_errors=True)
    return {"removed": target}
