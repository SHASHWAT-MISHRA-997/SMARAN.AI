"""Puts the data the offline voice needs somewhere the app controls.

Kokoro turns text into phonemes with g2p-en, which uses nltk, which needs two
corpora and a tagger. Nothing owned those files. They were expected to already
be on the machine, wherever nltk happened to look, and that produced a
different failure on every machine that ran it:

    Resource 'averaged_perceptron_tagger_eng' not found
    Security Violation [pathsec.open]: Unauthorized path ...\\nltk_data\\...

The first is a machine that never downloaded them. The second is nltk 3.10's
path check refusing a location it did not consider trustworthy. Both end the
same way - the assistant answers in text and never speaks - and neither says
anything a person could act on.

So the app keeps its own copy, beside its own data, and points nltk at it.
One directory it owns, on every machine, whether installed or run from
source. If a file is missing it is fetched once; if there is no network the
reason is recorded rather than discovered later as silence.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger("speech.resources")

#: What g2p-en actually opens. cmudict is the pronunciation dictionary; the
#: taggers decide which pronunciation a word takes in context. Both spellings
#: of the tagger are listed because nltk renamed it and different versions
#: ask for different names.
REQUIRED = (
    ("corpora/cmudict", "cmudict"),
    ("taggers/averaged_perceptron_tagger_eng", "averaged_perceptron_tagger_eng"),
    ("taggers/averaged_perceptron_tagger", "averaged_perceptron_tagger"),
)

_prepared = False
_problem: Optional[str] = None


def problem() -> Optional[str]:
    """Why the offline voice cannot speak, or None if it can."""
    return _problem


def data_dir() -> str:
    from app.config import settings

    return os.path.join(settings.DATA_DIR, "nltk_data")


def _copy_existing(package: str, probe: str, target: str) -> bool:
    """Copy a corpus the machine already has into the app's own directory.

    Searched by hand rather than through nltk, because nltk is the thing
    refusing to open these paths - asking it where they are and then copying
    them ourselves is the way past that.
    """
    import shutil

    kind = probe.split("/")[0]          # "corpora" or "taggers"
    destination = os.path.join(target, kind, package)
    if os.path.isdir(destination) and os.listdir(destination):
        return True

    roots = []
    for candidate in (os.getenv("APPDATA"), os.path.expanduser("~")):
        if candidate:
            roots.append(os.path.join(candidate, "nltk_data"))
    roots.append(os.path.join(os.path.dirname(os.__file__), "..", "nltk_data"))

    for root in roots:
        source = os.path.join(root, kind, package)
        if not os.path.isdir(source):
            continue
        try:
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copytree(source, destination, dirs_exist_ok=True)
            logger.info("Copied %s from %s", package, root)
            return True
        except OSError as exc:
            logger.info("Could not copy %s from %s: %s", package, root, exc)
    return False


def ensure(download: bool = True) -> bool:
    """Make the resources available and point nltk at them.

    Returns whether everything the offline voice needs is now present.
    """
    global _prepared, _problem

    if _prepared:
        return _problem is None

    try:
        import nltk
    except ImportError as exc:
        _problem = "nltk is not installed (%s)" % exc
        _prepared = True
        return False

    target = data_dir()
    os.makedirs(target, exist_ok=True)

    # Ahead of everything else, so a copy the app owns is preferred over
    # whatever else happens to be on the machine.
    if target not in nltk.data.path:
        nltk.data.path.insert(0, target)
    existing = os.environ.get("NLTK_DATA", "")
    if target not in existing.split(os.pathsep):
        os.environ["NLTK_DATA"] = (target + os.pathsep + existing) if existing else target

    missing = []
    for probe, package in REQUIRED:
        # The app's own copy comes first, and is made before asking nltk
        # whether it can find the corpus anywhere. Asking first was wrong:
        # find() answers yes for a location nltk will then refuse to open,
        # so the check passed and the voice still could not speak.
        kind = probe.split("/")[0]
        owned = os.path.join(target, kind, package)
        if not (os.path.isdir(owned) and os.listdir(owned)):
            _copy_existing(package, probe, target)

        try:
            found = str(nltk.data.find(probe))
            if found.startswith(os.path.abspath(target)):
                continue
            # Found, but somewhere else - and somewhere else is exactly what
            # fails on the machines where this breaks.
        except Exception:
            pass

        if not download:
            missing.append(package)
            continue

        # Copy before downloading. nltk 3.10 refuses to write outside what it
        # considers the download directory, and refuses to *read* corpora from
        # locations it does not trust - so on a machine that already has the
        # data, downloading it again fails and reading the existing copy fails
        # too. Copying it into the app's own directory satisfies both: the
        # file is where the app expects, under a root nltk accepts.
        if _copy_existing(package, probe, target):
            try:
                nltk.data.find(probe)
                continue
            except Exception:
                pass

        try:
            nltk.download(package, download_dir=target, quiet=True)
            nltk.data.find(probe)
        except Exception as exc:
            missing.append("%s (%s)" % (package, str(exc)[:80]))

    _prepared = True
    if missing:
        _problem = ("The offline voice needs these and could not get them: %s. "
                    "Speech will fall back to the online voice."
                    % ", ".join(missing))
        logger.warning(_problem)
        return False

    _problem = None
    logger.info("Offline voice resources ready in %s", target)
    return True
