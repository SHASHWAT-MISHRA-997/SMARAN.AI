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
    # Counted, not compared.
    #
    # The check below first asked whether the text had changed, which is a
    # different question and gets it wrong in the ordinary case: when the file
    # has not been edited since the last stamp, the hash is the same, the
    # substitution is a no-op, and an unchanged document was read as "matched
    # nothing". It failed a release for a stylesheet that was perfectly fine.
    raw, css_hits = re.subn(
        r'href="styles\.css(?:\?v=[^"]*)?"', f'href="styles.css?v={css}"', raw)
    raw, js_hits = re.subn(
        r'src="main\.js(?:\?v=[^"]*)?"', f'src="main.js?v={js}"', raw)

    # And it says so rather than reporting success it cannot vouch for.
    if not css_hits:
        raise SystemExit("stamp.py matched no stylesheet link in index.html")
    if not js_hits:
        raise SystemExit("stamp.py matched no main.js script tag in index.html")

    io.open(ROOT / "index.html", "w", encoding="utf-8", newline="").write(raw)
    print(f"styles.css?v={css}\nmain.js?v={js}")
    # About and Join use the home page's stylesheet and script, so they need
    # the same stamp or they serve last deploy's layout for an hour.
    for page in ("about.html", "join.html"):
        path = ROOT / page
        text = io.open(path, "r", encoding="utf-8", newline="").read()
        text, a = re.subn(r'href="styles\.css(?:\?v=[^"]*)?"', f'href="styles.css?v={css}"', text)
        text, b = re.subn(r'src="main\.js(?:\?v=[^"]*)?"', f'src="main.js?v={js}"', text)
        if not (a and b):
            raise SystemExit(f"stamp.py matched no stylesheet or main.js in {page}")
        io.open(path, "w", encoding="utf-8", newline="").write(text)
    stamp_shared_theme()
    stamp_version()


# docs, showcase and terms share these two, and neither was ever stamped.
#
# netlify.toml caches every .css and .js for an hour, and these filenames do
# not change, so a fix to the light palette reached returning visitors up to
# an hour late - or not at all, if they came back inside the window and the
# browser revalidated nothing. That is the exact failure the home page was
# already protected from; these three pages were added later and did not
# inherit it. Found while a light-mode fix appeared to have no effect.
THEME_ASSETS = ("page-theme.css", "page-theme.js")
THEMED_PAGES = ("docs.html", "showcase.html", "terms.html")


def stamp_shared_theme() -> None:
    hashes = {name: digest(name) for name in THEME_ASSETS}
    for page in THEMED_PAGES:
        path = ROOT / page
        raw = io.open(path, "r", encoding="utf-8", newline="").read()
        total = 0
        for name, value in hashes.items():
            attribute = "href" if name.endswith(".css") else "src"
            raw, hits = re.subn(
                rf'{attribute}="{re.escape(name)}(?:\?v=[^"]*)?"',
                f'{attribute}="{name}?v={value}"',
                raw,
            )
            total += hits
        if total != len(THEME_ASSETS):
            raise SystemExit(f"stamp.py matched {total} of {len(THEME_ASSETS)} theme assets in {page}")
        io.open(path, "w", encoding="utf-8", newline="").write(raw)
    print(" ".join(f"{name}?v={value}" for name, value in hashes.items()))


# Version strings that are prose rather than markup, so a release edit that
# greps for the previous number walks straight past them.
#
# Found at 1.0.7 still reading 1.0.2: the JSON-LD softwareVersion, the
# showcase footer and the terms header, each written in its own wording. They
# had been wrong since 1.0.3 and nobody had a reason to look. Anchoring on the
# words around the number, rather than on the number, is what makes this hold
# for the next release instead of only fixing this one.
VERSION_PATTERNS = [
    ("index.html", r'("softwareVersion":\s*")[0-9]+\.[0-9]+\.[0-9]+(")'),
    ("showcase.html", r'(Official Release Version )[0-9]+\.[0-9]+\.[0-9]+()'),
    ("terms.html", r'(Software Version: )[0-9]+\.[0-9]+\.[0-9]+( Production)'),
]


def current_version() -> str:
    """The one the rest of the repository agrees on."""
    source = (ROOT.parent / "cli" / "smaran_cli" / "__init__.py").read_text(encoding="utf-8")
    found = re.search(r'__version__\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"', source)
    if not found:
        raise SystemExit("stamp.py could not read the version from cli/smaran_cli/__init__.py")
    return found.group(1)


def stamp_version() -> None:
    version = current_version()
    for name, pattern in VERSION_PATTERNS:
        path = ROOT / name
        raw = io.open(path, "r", encoding="utf-8", newline="").read()
        raw, hits = re.subn(pattern, lambda m: f"{m.group(1)}{version}{m.group(2)}", raw)
        # Silence here is how these three went stale in the first place.
        if not hits:
            raise SystemExit(f"stamp.py matched no version string in {name}")
        io.open(path, "w", encoding="utf-8", newline="").write(raw)
    print(f"version {version} stamped into {len(VERSION_PATTERNS)} files")


if __name__ == "__main__":
    main()
