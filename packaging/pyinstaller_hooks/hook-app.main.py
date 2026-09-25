"""PyInstaller hook for app.main: bundle the whole standard library.

PyInstaller bundles only the standard library this app imports. The image and
video packages (torch, diffusers, transformers) are fetched later into
data/video-packages and run on this interpreter, so whatever they import has
to be here already - and 1.0.17 showed it was not: torch stopped at "No module
named 'pickletools'". Naming modules one by one would find the next gap only
on someone's machine, so the whole library comes along (a few MB); extension
modules follow through their wrappers.
"""
import sysconfig
from pathlib import Path

# Parts no fetched package needs, or that do something on import
# (antigravity opens a browser).
_SKIP = {
    "tkinter", "turtle", "turtledemo", "idlelib", "test", "ensurepip", "lib2to3",
    "venv", "antigravity", "this", "__phello__", "__hello__", "_pyrepl", "pydoc_data",
}


def stdlib_modules() -> list:
    root = Path(sysconfig.get_paths()["stdlib"])
    names = set()
    for path in root.rglob("*.py"):
        parts = path.relative_to(root).with_suffix("").parts
        if parts[0] in ("site-packages", "dist-packages") or parts[0] in _SKIP:
            continue
        if any(part in ("test", "tests", "idle_test") for part in parts):
            continue
        if not all(part.isidentifier() for part in parts):
            continue
        if parts[-1] == "__init__":
            parts = parts[:-1]
        if not parts or parts[-1] == "__main__":
            continue
        names.add(".".join(parts))
    return sorted(names)


hiddenimports = stdlib_modules()
