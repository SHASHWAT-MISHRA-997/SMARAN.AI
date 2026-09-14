"""Render one real clip through the chunked continuation path, with logging.

Run directly. Writes progress to stdout with timestamps so a long render can be
followed from outside, and prints the verified facts about the finished file
rather than claiming success from the fact that the call returned.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(os.path.dirname(BACKEND), "data", "video-packages"))

from app.video.continuity import generate_sequence, plan_sequence  # noqa: E402

PROMPT = (
    "a paper lantern drifting slowly upward through a misty pine forest at "
    "dawn, warm golden light, soft volumetric fog, gentle upward camera drift, "
    "cinematic, highly detailed"
)
SECONDS = float(os.environ.get("DEMO_SECONDS", "5"))
ASPECT = os.environ.get("DEMO_ASPECT", "16:9")
OUT = os.environ.get("DEMO_OUT") or os.path.join(
    os.path.dirname(BACKEND), "data", "video", "demo_sequence.mp4")

started = time.time()


def note(message):
    print("[%6.1fs] %s" % (time.time() - started, message), flush=True)


plan = plan_sequence(SECONDS, aspect=ASPECT)
note("plan: %s" % plan)
if not plan["possible"]:
    raise SystemExit("refused: %s" % plan["reason"])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
result = generate_sequence(
    prompt=PROMPT, output_path=OUT, total_seconds=SECONDS,
    aspect=ASPECT, seed=7, progress=note,
)
note("result: %s" % result)
note("bytes on disk: %d" % os.path.getsize(OUT))
