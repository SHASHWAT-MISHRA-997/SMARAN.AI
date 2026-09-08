"""Run the real video-package install and record what actually happened.

This is the multi-gigabyte install the smaller checks stand in for: torch with
CUDA, torchvision, diffusers, transformers and the rest, into the real data
directory by the real code path. Everything it prints comes from the
installer's own counters, so the log is evidence rather than narration.

    python tools/run_video_install.py

Nothing is simulated and nothing is cleaned up afterwards: a finished install
is the point.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

LOG = ROOT / ".cache" / "audit" / "video-install-real.log"

#: Long enough for a slow connection, short enough to give up rather than hang.
PATIENCE_SECONDS = 3 * 60 * 60


def mb(value):
    return "-" if value is None else f"{value / 1_000_000:.0f} MB"


def rate(value):
    return "measuring" if not value else f"{value / 1_000_000:.2f} MB/s"


def clock(seconds):
    if seconds is None:
        return "-"
    return f"{int(seconds) // 60}m{int(seconds) % 60:02d}s"


def main() -> int:
    from app.video import install as vi

    LOG.parent.mkdir(parents=True, exist_ok=True)
    log = LOG.open("w", encoding="utf-8")

    def say(line: str) -> None:
        print(line, flush=True)
        log.write(line + "\n")
        log.flush()

    before = vi.status()
    say(f"target        : {vi.packages_dir()}")
    say(f"free / needed : {before['free_space_gb']} GB / {before['required_free_gb']} GB")
    say(f"packages      : {', '.join(vi.VIDEO_PACKAGES)}")
    say(f"approx download: {vi.APPROX_DOWNLOAD_GB} GB")
    say("")

    started = vi.start()
    say(f"start: {started}")
    if not started.get("started"):
        say("Nothing to do.")
        return 0

    began = time.time()
    last_line = ""
    peak_speed = 0.0
    seen_files = set()
    deadline = began + PATIENCE_SECONDS

    while time.time() < deadline:
        state = vi.status()
        if state["status"] != "running":
            break

        speed = state["bytes_per_second"] or 0
        peak_speed = max(peak_speed, speed)
        if state["current_name"]:
            seen_files.add(state["current_name"])

        line = (
            f"[{clock(time.time() - began)}] "
            f"{state['approx_percent']:>3}% of ~{vi.APPROX_DOWNLOAD_GB}GB "
            f"| got {mb(state['obtained_bytes'])} "
            f"(net {mb(state['downloaded_bytes'])}, cache {mb(state['cached_bytes'])}) "
            f"| {rate(speed)} "
            f"| file {state['current_percent'] if state['current_percent'] is not None else '-'}%"
            f" of {mb(state['current_total']) if state['current_total'] else 'unknown size'}"
            f" eta {clock(state['current_eta_seconds'])} "
            f"| {(state['current_name'] or '')[:44]}"
        )
        if line != last_line:
            say(line)
            last_line = line
        time.sleep(5)

    final = vi.status()
    say("")
    say(f"status         : {final['status']}")
    say(f"error          : {final['error']}")
    say(f"downloaded     : {mb(final['downloaded_bytes'])} (over the network)")
    say(f"from pip cache : {mb(final['cached_bytes'])}")
    say(f"obtained total : {mb(final['obtained_bytes'])}")
    say(f"peak speed     : {rate(peak_speed)}")
    say(f"files seen     : {len(seen_files)}")
    say(f"restart needed : {final['restart_required']}")
    say(f"installed      : {final['installed']}")
    say(f"elapsed        : {clock(time.time() - began)}")
    say("")
    for message in final["messages"][-12:]:
        say(f"  {message}")

    live = Path(vi.packages_dir())
    staging = Path(vi.staging_dir())
    say("")
    say(f"live directory : {live} exists={live.is_dir()}")
    say(f"staging left   : {staging.is_dir()}")
    if live.is_dir():
        total = sum(f.stat().st_size for f in live.rglob("*") if f.is_file())
        say(f"installed size : {total / 1_000_000_000:.2f} GB")

    log.close()
    return 0 if final["status"] == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
