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


def digest(path: str) -> str:
    return hashlib.md5(io.open(path, "rb").read()).hexdigest()[:10]


def main() -> None:
    css, js = digest("styles.css"), digest("main.js")
    raw = io.open("index.html", "r", encoding="utf-8", newline="").read()

    # Only these two. Matching every stylesheet link once stamped the Google
    # Fonts URL as well, which fetched the fonts a second time.
    raw = re.sub(r'href="styles\.css(?:\?v=[0-9a-f]+)?"', f'href="styles.css?v={css}"', raw)
    raw = re.sub(r'src="main\.js(?:\?v=[0-9a-f]+)?"', f'src="main.js?v={js}"', raw)

    io.open("index.html", "w", encoding="utf-8", newline="").write(raw)
    print(f"styles.css?v={css}\nmain.js?v={js}")


if __name__ == "__main__":
    main()
