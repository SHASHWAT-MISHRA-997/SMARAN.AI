"""Entry point for the frozen build.

PyInstaller runs its target as a top-level script, so `smaran_cli/__main__.py`
cannot be used directly: its `from .main import main` has no parent package to
resolve against and the executable dies on import. An absolute import from a
module outside the package sidesteps that.
"""

import sys

from smaran_cli.main import main

if __name__ == "__main__":
    sys.exit(main())
