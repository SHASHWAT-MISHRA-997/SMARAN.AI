"""What this machine can do, decided by looking at it.

Nothing here is configured. The registries record what each model needs and
this compares that against what the hardware reports, so a capability appears
the moment the machine can carry it and is refused with numbers when it
cannot. Moving to a bigger card, or freeing memory, is enough - there is no
setting to find and no build to change.

The refusals matter as much as the offers. "Not supported" tells someone
nothing; "needs 16 GB and this card has 6" tells them exactly what would
change the answer, and whether it is worth changing.
"""

from __future__ import annotations

import logging
import shutil
import time
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Re-probing on every request would run nvidia-smi and torch calls in a loop.
# Hardware does not change often, but free VRAM does, so the window is short
# enough to notice a model being unloaded.
_CACHE_SECONDS = 20
_cache: dict = {"at": 0.0, "value": None}


def _tool_present(name: str) -> bool:
    return shutil.which(name) is not None


def _module_present(name: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _requirement(need_gb: Optional[float], have_gb: float, label: str) -> dict:
    """One capability's verdict, with the numbers that produced it."""
    if need_gb is None:
        return {
            "available": False,
            "reason": "%s publishes no memory requirement, so it is not offered "
                      "rather than guessed at." % label,
            "needs_vram_gb": None,
        }
    if need_gb <= have_gb:
        return {
            "available": True,
            "reason": "%s needs about %.1f GB and %.1f GB is free."
                      % (label, need_gb, have_gb),
            "needs_vram_gb": need_gb,
        }
    return {
        "available": False,
        "reason": "%s needs about %.1f GB; this card has %.1f GB free. A larger "
                  "card enables it with no other change."
                  % (label, need_gb, have_gb),
        "needs_vram_gb": need_gb,
    }


def scan(force: bool = False) -> dict:
    """Look at the machine and decide, fresh or from the short cache."""
    now = time.time()
    if not force and _cache["value"] and now - _cache["at"] < _CACHE_SECONDS:
        return _cache["value"]

    from app.video.hardware import probe

    hw = probe()
    have = hw.vram_free_gb if hw.has_cuda else 0.0

    caps: Dict[str, dict] = {}

    # --- things that need no model at all -------------------------------
    ffmpeg = _tool_present("ffmpeg")
    for name in ("video-to-images", "video-to-audio", "video-metadata"):
        caps[name] = {
            "available": ffmpeg,
            "reason": "FFmpeg is installed." if ffmpeg else
                      "FFmpeg is not on PATH. It reads the file; nothing here "
                      "works without it.",
            "engine": "ffmpeg",
        }

    # --- speech ---------------------------------------------------------
    onnx = _module_present("onnxruntime")
    g2p = _module_present("g2p_en")
    caps["text-to-speech-offline"] = {
        "available": onnx and g2p,
        "reason": "Kokoro runs on the processor; no GPU is involved. English "
                  "only: the phonemiser here reads the Latin alphabet, so the "
                  "model's Hindi voices are refused rather than mispronounced."
                  if (onnx and g2p) else
                  "Needs onnxruntime and g2p-en. Without them only the online "
                  "voice works.",
        "engine": "kokoro",
    }
    caps["speech-to-text"] = {
        "available": _module_present("faster_whisper"),
        "reason": "faster-whisper is installed." if _module_present("faster_whisper")
                  else "faster-whisper is not installed.",
        "engine": "faster-whisper",
    }

    # --- anything that needs torch --------------------------------------
    torch_ready = hw.has_cuda and _module_present("diffusers")
    if not torch_ready:
        blocked = {
            "available": False,
            "reason": hw.reason or "The image and video packages are not installed.",
            "engine": None,
        }
        for name in ("text-to-image", "image-to-image", "text-to-video",
                     "image-to-video", "image-to-3d"):
            caps[name] = dict(blocked)
    else:
        from app.imaging.registry import MODELS as IMAGE_MODELS
        from app.video.registry import MODELS as VIDEO_MODELS

        # The best model this card can carry, not the first that fits: a
        # machine that grows should start using what it grew into.
        def best(models, capability):
            fitting = [
                m for m in models
                if capability in m.capabilities
                and m.min_vram_gb is not None
                and m.min_vram_gb <= have
            ]
            return max(fitting, key=lambda m: m.min_vram_gb) if fitting else None

        for capability, models in (
            ("text-to-image", IMAGE_MODELS),
            ("image-to-image", IMAGE_MODELS),
            ("text-to-video", VIDEO_MODELS),
            ("image-to-video", VIDEO_MODELS),
        ):
            chosen = best(models, capability)
            if chosen:
                caps[capability] = {
                    "available": True,
                    "reason": "%s fits: needs about %.1f GB, %.1f GB free."
                              % (chosen.display_name, chosen.min_vram_gb, have),
                    "engine": chosen.id,
                }
            else:
                candidates = [m for m in models if capability in m.capabilities]
                smallest = min(
                    (m for m in candidates if m.min_vram_gb is not None),
                    key=lambda m: m.min_vram_gb, default=None,
                )
                caps[capability] = _requirement(
                    smallest.min_vram_gb if smallest else None, have,
                    smallest.display_name if smallest else capability,
                )
                caps[capability]["engine"] = None

    # --- capabilities nothing here can serve yet -------------------------
    # Recorded rather than omitted. A machine that meets the figure gets a
    # straight answer instead of silence, and one that does not is told what
    # the gap is.
    caps.setdefault("image-to-3d", _requirement(16.0, have, "TRELLIS"))
    caps["image-to-3d"]["engine"] = None
    caps["image-to-3d"]["note"] = (
        "Its README states 16 GB minimum and that it is tested only on Linux, "
        "and it compiles CUDA submodules at install. Not wired up."
    )

    result = {
        "scanned_at": now,
        "hardware": hw.as_dict(),
        "capabilities": caps,
        "available": sorted(k for k, v in caps.items() if v["available"]),
        "unavailable": sorted(k for k, v in caps.items() if not v["available"]),
        "note": (
            "Decided by looking at this machine, not by configuration. A "
            "capability appears when the hardware can carry it."
        ),
    }
    _cache.update(at=now, value=result)
    return result
