"""Reproduce the WinError 5 video-package install failure, at a size that fits.

The real failure took four gigabytes of downloading to reach. The file it died
on was protobuf's `google/_upb/_message.pyd`, and protobuf is under a megabyte,
so the same collision can be staged in a few seconds:

  1. install protobuf into the live directory, the way a first install ends up
  2. import it, so the .pyd is mapped into this process - a running SMARAN
  3. install over the live directory: this is the old behaviour, and Windows
     refuses it with "[WinError 5] Access is denied"
  4. install through the current code path, which stages elsewhere, and watch
     it succeed with the very same DLL still loaded

Run it from the repository root. It writes only inside .cache/audit.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".cache" / "audit" / "video-install-lock"


def load_installer(live: Path):
    spec = importlib.util.spec_from_file_location(
        "isolated_video_install", ROOT / "backend" / "app" / "video" / "install.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.packages_dir = lambda: str(live)
    # protobuf stands in for the whole list: it is the package that actually
    # broke, and the CUDA index in the real command carries only torch.
    module.VIDEO_PACKAGES = ["protobuf"]
    module.APPROX_DOWNLOAD_GB = 0.001
    return module


def pip_into(target: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "pip", "install", "--target", str(target),
         "--upgrade", "--disable-pip-version-check", "protobuf"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=600,
    )


def find_pyd(live: Path):
    return next(iter(live.glob("google/_upb/*.pyd")), None)


def main() -> int:
    if WORK.exists():
        shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    live = WORK / "video-packages"

    print("== 1. first install into the live directory ==")
    first = pip_into(live)
    if first.returncode != 0:
        print(first.stdout[-2000:])
        print("FAIL: could not install protobuf at all")
        return 1
    pyd = find_pyd(live)
    if pyd is None:
        print("SKIP: this protobuf wheel is pure Python, so nothing can be locked")
        return 0
    print("   installed", pyd.relative_to(live), "%.0f KB" % (pyd.stat().st_size / 1024))

    print("== 2. load the .pyd, the way the running app does ==")
    sys.path.insert(0, str(live))
    import ctypes
    handle = ctypes.CDLL(str(pyd))          # keeps the DLL mapped for the rest of the run
    print("   mapped into this process:", bool(handle))

    print("== 3. the old behaviour: install over the live directory ==")
    over = pip_into(live)
    combined = (over.stdout or "") + (over.stderr or "")
    denied = "WinError 5" in combined or "Access is denied" in combined
    if over.returncode == 0 and not denied:
        print("   NOTE: this platform allowed it (not Windows, or no lock held).")
        print("   The staging path below is still what protects the install.")
    else:
        print("   pip exited %s" % over.returncode)
        for line in combined.splitlines():
            if "WinError 5" in line or "Access is denied" in line:
                print("   >>", line.strip()[:160])
                break
        print("   REPRODUCED: this is the failure the owner saw.")

    print("== 4. the current code path, same DLL still loaded ==")
    installer = load_installer(live)
    # A running SMARAN has already put the live directory on sys.path and
    # imported from it, which is what makes its DLLs unreplaceable. That
    # happens at startup, so it is true before the install begins - not after.
    installer._activated_directory = os.path.abspath(str(live))
    messages: list[str] = []
    installer._install(on_message=messages.append)
    staged = Path(installer.staging_dir())
    marker = staged / installer.COMPLETE_MARKER
    state = installer._state

    print("   status:", state.get("status"))
    if state.get("error"):
        print("   error:", state["error"])
    print("   staged at:", staged.name, "| complete marker:", marker.is_file())
    print("   bytes pip reported receiving:", state.get("downloaded_bytes"),
          "(0 means it was served from pip's cache, not invented)")
    for line in messages[-2:]:
        print("   note:", line[:150])

    ok = state.get("status") == "done" and marker.is_file()

    print("== 5. promotion is deferred while the old copy is in use ==")
    deferred = not installer.promote_staged()
    print("   held back until restart:", deferred)
    print("   restart_required flag:", state.get("restart_required"))
    print("   live copy still intact:", find_pyd(live) is not None)

    print()
    if ok and deferred and state.get("restart_required"):
        print("PASS: the install completed with the locked DLL still mapped,")
        print("      and the finished copy waits for a restart instead of")
        print("      being swapped under a running process.")
        return 0
    print("FAIL: see the status above")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
