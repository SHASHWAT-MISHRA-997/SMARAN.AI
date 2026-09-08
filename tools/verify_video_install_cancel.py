"""Cancel a real download in flight, and check the numbers were real.

The install this guards is several gigabytes, so two things have to be true
and neither can be shown with a stub: pressing cancel has to stop the bytes
arriving, not just change a label, and the speed and progress shown while it
runs have to come from the download rather than from a timer.

So this starts a genuine pip download over the network, watches the counters
move, cancels part way through, and then looks at what was left behind.
`scipy` stands in for the real package list - about 45 MB, large enough to
measure and small enough to be polite about. `PIP_NO_CACHE_DIR` makes sure it
is actually fetched rather than copied out of pip's cache, which is what makes
the byte counts real.

Run from the repository root. Writes only inside .cache/audit.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".cache" / "audit" / "video-install-cancel"

#: Give up rather than hang if nothing ever downloads.
PATIENCE_SECONDS = 180
#: Cancel once this much has really arrived, so there is something to stop.
CANCEL_AFTER_BYTES = 12_000_000
#: And not before this long. The speed is deliberately not reported from a
#: window under a second, because two byte counts a fraction apart give a wild
#: figure - so a check that cancels inside a second never sees a speed at all.
#: The real install runs for minutes; this waits long enough to be that.
CANCEL_AFTER_SECONDS = 4.0


def load(live: Path):
    spec = importlib.util.spec_from_file_location(
        "isolated_video_cancel", ROOT / "backend" / "app" / "video" / "install.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.packages_dir = lambda: str(live)
    module.VIDEO_PACKAGES = ["scipy"]
    module.APPROX_DOWNLOAD_GB = 0.05
    # status() otherwise imports torch on every poll to check the real package
    # set, which has nothing to do with what is being measured here.
    module._package_error = lambda: "not installed (stubbed for this check)"
    return module


def human(n):
    return "-" if n is None else f"{n / 1_000_000:.1f} MB"


def main() -> int:
    if WORK.exists():
        shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    live = WORK / "video-packages"

    # A real fetch, not a copy out of the cache: the byte counts are the point.
    os.environ["PIP_NO_CACHE_DIR"] = "1"

    installer = load(live)

    print("== 1. free space is checked before anything downloads ==")
    free = installer.free_space_gb(str(live))
    print(f"   free: {free:.1f} GB | required: {installer.REQUIRED_FREE_GB:.0f} GB")
    if free is not None and free < installer.REQUIRED_FREE_GB:
        print("   NOTE: this drive would refuse the real install, which is the")
        print("   intended behaviour. Lowering the bar for this check only.")
        installer.REQUIRED_FREE_GB = 0.1

    print("== 2. start a real download ==")
    started = installer.start()
    print("  ", started["detail"])

    peak_bytes = 0
    speeds = []
    etas = []
    saw_phase = None
    began = time.time()
    deadline = began + PATIENCE_SECONDS
    while time.time() < deadline:
        state = installer.status()
        if state["status"] != "running":
            break
        peak_bytes = max(peak_bytes, state["downloaded_bytes"] + state["current_bytes"])
        saw_phase = saw_phase or state["phase"]
        if state["bytes_per_second"]:
            speeds.append(state["bytes_per_second"])
        if state["current_eta_seconds"] is not None:
            etas.append(state["current_eta_seconds"])
        # Cancel once there is genuinely something to stop *and* the panel has
        # had a real speed to show. pip spends its first seconds resolving
        # before a single byte moves, so a check that cancels on a byte count
        # alone can finish before the speed window has opened - and then
        # reports that speed is broken when it has simply not been reached yet.
        # Bounded by PATIENCE_SECONDS, so a speed that never arrives still fails.
        if peak_bytes >= CANCEL_AFTER_BYTES and speeds \
                and time.time() - began >= CANCEL_AFTER_SECONDS:
            break
        time.sleep(0.25)

    print(f"   downloaded before cancelling: {human(peak_bytes)}")
    print(f"   phase reported: {saw_phase}")
    if speeds:
        print(f"   speed seen: {max(speeds) / 1_000_000:.2f} MB/s"
              f" (measured, over {len(speeds)} polls)")
    else:
        print("   speed: never measured")
    if etas:
        print(f"   ETA offered: {min(etas)}-{max(etas)}s remaining on the current file")

    if peak_bytes == 0:
        print("\nINCONCLUSIVE: nothing downloaded, so there was nothing to cancel.")
        print("Check the network and that scipy is not already satisfied.")
        installer.cancel()
        return 2

    print("== 3. cancel it ==")
    result = installer.cancel()
    print("  ", result)

    # The worker still has to notice and tidy up.
    for _ in range(80):
        if installer.status()["status"] != "running":
            break
        time.sleep(0.25)

    final = installer.status()
    staging = Path(installer.staging_dir())
    marker = staging / installer.COMPLETE_MARKER

    print("== 4. what was left behind ==")
    print("   status:", final["status"])
    print("   error:", final["error"])
    print("   completion marker written:", marker.is_file())
    print("   live packages directory touched:", live.exists())
    print("   pip process handle cleared:", installer._process is None)

    checks = [
        ("bytes really arrived", peak_bytes >= CANCEL_AFTER_BYTES),
        ("speed was measured from the download", bool(speeds)),
        ("an ETA was offered for a file whose size was known", bool(etas)),
        ("phase was reported as packages", saw_phase == "packages"),
        ("cancel was accepted", result.get("cancelled") is True),
        ("status is cancelled, not failed", final["status"] == "cancelled"),
        ("no error is invented for a deliberate stop", final["error"] is None),
        ("a partial install is never marked complete", not marker.is_file()),
        ("nothing already installed was touched", not live.exists()),
        ("the process handle was released", installer._process is None),
    ]

    print()
    ok = True
    for name, passed in checks:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        ok = ok and passed

    print()
    print("RESULT:", "PASS" if ok else "FAIL")
    if ok:
        print("A real download was stopped part way through, the counters that")
        print("drove the panel came from the transfer, and nothing partial was")
        print("left claiming to be finished.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
