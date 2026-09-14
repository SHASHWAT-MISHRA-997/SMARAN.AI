"""How fast this machine actually is, learned from its own runs.

Every duration this app quoted came from one constant - 70,000 pixel-frame-
steps per second - timed on a 6 GB RTX 2060 that was streaming layers onto the
card because the model did not fit. That is the slowest path there is, and it
was applied to every machine.

On the card it was measured on, it is honest. On anything that holds the model
in VRAM it is wildly wrong in the pessimistic direction: an RTX 4090 was told a
two second clip would take "under 6.4 hours", when it is minutes. A number that
absurd does more damage than no number - it reads as a broken app, and the
person closes it before the first step finishes.

Guessing a constant for hardware nobody here owns would be the same mistake
again, so this measures instead. The pipeline reports each step as it finishes;
after a few of them there is a real rate for *this* machine, on *this* path,
and it is written down. The next run quotes that instead of the shipped
default, and says which of the two it is using.

Two things kept deliberately separate:

  * The rate is stored per GPU name and per path. Resident and offloaded are
    different machines as far as throughput is concerned, and averaging them
    would produce a number describing neither.

  * A measurement never silently replaces the shipped figure without saying
    so. "Measured on this machine" and "estimated from a different card" are
    different claims and the interface makes that difference visible.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Reentrant, because record() takes the lock and then calls load(), which takes
# it again. With a plain Lock that is a deadlock, and it would not have shown up
# as an error: the generation would finish, the thread would stop on the line
# that writes the timing down, and the job would hang there for ever.
_lock = threading.RLock()
_cache: Optional[dict] = None

# Ignore the first steps. The first carries one-off work - kernel autotuning,
# lazy allocations, the first weights arriving on the card - and timing it as
# though it were typical makes the machine look far slower than it is.
WARMUP_STEPS = 2

# Below this there is not enough signal to overwrite a shipped default.
MIN_STEPS = 4


def _path() -> str:
    from app.config import settings

    return os.path.join(settings.DATA_DIR, "video", "calibration.json")


def _key(gpu_name: str, resident: bool) -> str:
    return "%s|%s" % (gpu_name or "unknown", "resident" if resident else "offload")


def load() -> dict:
    global _cache
    with _lock:
        if _cache is not None:
            return _cache
        try:
            with open(_path(), encoding="utf-8") as handle:
                _cache = json.load(handle)
        except (OSError, ValueError):
            _cache = {}
        return _cache


# How far a measurement may be stretched to describe a different clip size.
#
# One rate applied to every size looked reasonable and is badly wrong. Measured
# on the 6 GB card this was built against, at 20 steps: a 9-frame clip took
# 2.73 s per step, and a 41-frame clip at the same resolution took about 66 s -
# twenty-four times the time for four and a half times the work. Once a clip
# stops fitting comfortably the cost stops being proportional to it, so a rate
# timed on a small render predicts about four minutes for a job that really
# takes twenty-five.
#
# So a sample only speaks for clips near its own size, and anything outside
# that is reported as unmeasured rather than guessed.
SIZE_TOLERANCE = 2.0


def sample_for(gpu_name: str, resident: bool,
               units_per_step: float) -> Optional[dict]:
    """A measurement taken at a comparable clip size, or None."""
    entry = load().get(_key(gpu_name, resident))
    if not entry:
        return None
    best = None
    for sample in entry.get("samples", []):
        measured_units = float(sample.get("units_per_step") or 0)
        rate = float(sample.get("units_per_sec") or 0)
        if measured_units <= 0 or rate <= 0:
            continue
        ratio = max(units_per_step / measured_units, measured_units / units_per_step)
        if ratio > SIZE_TOLERANCE:
            continue
        if best is None or ratio < best[0]:
            best = (ratio, sample)
    return dict(best[1], ratio=round(best[0], 2)) if best else None


def units_per_sec(gpu_name: str, resident: bool,
                  units_per_step: Optional[float] = None) -> Optional[float]:
    """The measured rate for this machine at a comparable size, or None."""
    if units_per_step is None:
        return None
    sample = sample_for(gpu_name, resident, units_per_step)
    return float(sample["units_per_sec"]) if sample else None


def record(gpu_name: str, resident: bool, units_per_sec_value: float,
           samples: int, units_per_step: float = 0.0) -> None:
    """Write down a rate measured on this machine, with the size it applies to.

    Kept as a list of sizes rather than one averaged number: averaging a
    9-frame clip with a 41-frame one produces a figure that describes neither.
    A repeat at the same size replaces the older reading, so a machine that
    gets faster - a driver update, a laptop unplugged from power saving - is
    not stuck with its worst day for ever.
    """
    if units_per_sec_value <= 0 or samples < MIN_STEPS or units_per_step <= 0:
        return
    key = _key(gpu_name, resident)
    with _lock:
        data = load()
        entry = data.setdefault(key, {"samples": []})
        kept = [s for s in entry.get("samples", [])
                if not _same_size(s.get("units_per_step"), units_per_step)]
        kept.append({
            "units_per_step": round(units_per_step),
            "units_per_sec": round(units_per_sec_value, 1),
            "steps_timed": samples,
            "updated": time.time(),
        })
        # Newest first, and bounded - this is a hint, not a history.
        entry["samples"] = sorted(kept, key=lambda s: -s["updated"])[:12]
        try:
            os.makedirs(os.path.dirname(_path()), exist_ok=True)
            with open(_path(), "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2)
        except OSError:
            # A calibration that cannot be saved is a lost optimisation, not a
            # failed generation. The run continues.
            logger.warning("could not save calibration", exc_info=True)


def _same_size(a, b) -> bool:
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return False
    if a <= 0 or b <= 0:
        return False
    return max(a / b, b / a) < 1.15


class StepTimer:
    """Times diffusion steps and turns them into a rate for this machine.

    Used as the pipeline's per-step callback. It also gives the caller a live
    estimate after the warm-up, which is the first honest number the user sees
    - the one before it came from someone else's hardware.
    """

    def __init__(self, units_per_step: float, total_steps: int,
                 on_estimate=None):
        self.units_per_step = float(units_per_step)
        self.total_steps = int(total_steps)
        self.on_estimate = on_estimate
        self.started: Optional[float] = None
        self.counted = 0
        self.elapsed = 0.0
        self._announced = False

    def step(self) -> None:
        now = time.time()
        self.counted += 1
        if self.counted <= WARMUP_STEPS:
            self.started = now
            return
        if self.started is None:
            self.started = now
            return
        self.elapsed = now - self.started

        if (not self._announced and self.on_estimate
                and self.counted >= WARMUP_STEPS + MIN_STEPS):
            self._announced = True
            remaining = self.total_steps - self.counted
            per_step = self.elapsed / max(1, self.counted - WARMUP_STEPS)
            self.on_estimate(per_step * remaining, per_step)

    def rate(self) -> Optional[float]:
        """Pixel-frame-steps per second, measured. None if too little data."""
        timed = self.counted - WARMUP_STEPS
        if timed < MIN_STEPS or self.elapsed <= 0:
            return None
        return (self.units_per_step * timed) / self.elapsed

    def samples(self) -> int:
        return max(0, self.counted - WARMUP_STEPS)
