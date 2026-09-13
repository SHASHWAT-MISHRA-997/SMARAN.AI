"""Stamp the stylesheet and script with a hash of their contents.

netlify.toml caches CSS and JS for an hour and neither filename changes
between deploys, so a returning visitor kept the previous stylesheet and saw
a layout the markup no longer matched. A query string derived from the file's
own bytes changes only when the file does: unchanged assets stay cached, and
a real edit invalidates itself.

Run before deploying:  python stamp.py
"""

import hashlib
import io
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(path: str) -> str:
    return hashlib.md5((ROOT / path).read_bytes()).hexdigest()[:10]


def main() -> None:
    css, js = digest("styles.css"), digest("main.js")
    raw = io.open(ROOT / "index.html", "r", encoding="utf-8", newline="").read()

    # Only these two. Matching every stylesheet link once stamped the Google
    # Fonts URL as well, which fetched the fonts a second time.
    #
    # The existing value is matched loosely, as anything up to the quote. It
    # used to require [0-9a-f]+, so when a release edit put a version number
    # there instead - styles.css?v=2.10.38, which has dots in it - the pattern
    # stopped matching anything at all. This script then ran, printed the two
    # hashes it had computed, wrote the file back unchanged and exited zero.
    # Cache busting had been off for releases, and the output said it was on.
    css_was, js_was = raw, raw
    raw = re.sub(r'href="styles\.css(?:\?v=[^"]*)?"', f'href="styles.css?v={css}"', raw)
    js_was = raw
    raw = re.sub(r'src="main\.js(?:\?v=[^"]*)?"', f'src="main.js?v={js}"', raw)

    # And it says so rather than reporting success it cannot vouch for.
    if css_was == js_was:
        raise SystemExit("stamp.py matched no stylesheet link in index.html")
    if js_was == raw:
        raise SystemExit("stamp.py matched no main.js script tag in index.html")

    io.open(ROOT / "index.html", "w", encoding="utf-8", newline="").write(raw)
    print(f"styles.css?v={css}\nmain.js?v={js}")


if __name__ == "__main__":
    main()
