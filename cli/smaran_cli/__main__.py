"""Lets `python -m smaran_cli` work as well as the installed `smaran`."""

import sys

from .main import main

if __name__ == "__main__":
    sys.exit(main())
