"""Check foreign video packages cannot shadow a Linux bundle's tokenizer.

Run on Linux from the repository root with PYTHONPATH pointing at the frozen
artifact's _internal directory. This verifies activation; it is not a frozen
application startup or microphone transcription test.
"""
import importlib.util
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "platform_video_installer", root / "backend/app/video/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
directory = root / "data/video-packages"
installer.packages_dir = lambda: str(directory)
installer.promote_staged = lambda: False  # Read-only audit of the existing tree.
before = list(sys.path)
assert not installer.ensure_on_path(), "Expected the foreign wheel tree to be refused"
assert sys.path == before, "Foreign packages changed module resolution"
assert installer._activation_error, "Missing actionable compatibility error"
import tokenizers
assert not Path(tokenizers.__file__).is_relative_to(directory)
print(installer._activation_error)
print(f"PASS: bundled tokenizer {tokenizers.__version__} imports from {tokenizers.__file__}")
