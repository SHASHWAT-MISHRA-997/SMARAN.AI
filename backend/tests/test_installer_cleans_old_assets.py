"""The installer must not leave every previous release's assets behind.

Found by installing the published build on the machine it was meant for,
rather than reading the script.

The built frontend names every asset after the version that produced it, so
index-v2.10.53-BREG8BZN.js and index-v2.10.51-CEggwwOC.js are different files.
[Files] overwrites what it ships and removes nothing, so each upgrade landed a
new set of names beside the old ones and nothing ever cleaned them up.

On a machine upgraded thirteen times the assets folder held 1,170 files. 1,080
of them were dead: 42.2 MB of the 49 MB was assets no index.html had referenced
since 2.10.7. Nothing was broken by it - index.html only names the current
ones - which is exactly why it went unnoticed through thirteen releases while
growing every time.

These read the Inno Setup script. There is no way to assert this from Python
against a real install without running Inno Setup, so what is held down is the
instruction that does the cleaning.
"""

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "installer" / "SMARAN.AI.iss"


@pytest.fixture(scope="module")
def script():
    if not SCRIPT.is_file():
        pytest.skip("installer script is not in this checkout")
    return SCRIPT.read_text(encoding="utf-8", errors="replace")


def section(text, name):
    """The body of one [Section] of an Inno Setup script."""
    match = re.search(r"^\[%s\]\s*$(.*?)(?=^\[|\Z)" % name, text,
                      re.M | re.S | re.I)
    return match.group(1) if match else ""


def test_there_is_an_install_delete_section(script):
    assert section(script, "InstallDelete").strip(), (
        "nothing is removed before the new files are copied, so every "
        "release's assets accumulate forever"
    )


def test_the_versioned_asset_folder_is_cleared(script):
    body = section(script, "InstallDelete")
    assert "frontend_dist" in body and "assets" in body, (
        "the folder that accumulates is not the one being cleared: %r" % body
    )


def test_it_clears_rather_than_deleting_single_files(script):
    """The names are unpredictable - a content hash per build - so they can
    only be cleared as a folder."""
    line = next((l for l in section(script, "InstallDelete").splitlines()
                 if "frontend_dist" in l), "")
    assert "filesandordirs" in line, line


def test_nothing_outside_the_app_folder_is_deleted(script):
    """A cleanup that reached user data would be far worse than the bloat."""
    for line in section(script, "InstallDelete").splitlines():
        line = line.strip()
        if not line or line.startswith(";"):
            continue
        name = re.search(r'Name:\s*"([^"]+)"', line)
        assert name, line
        assert name.group(1).startswith("{app}\\"), (
            "install-time delete reaches outside the application folder: %s"
            % name.group(1)
        )


def test_user_data_is_still_preserved_on_uninstall(script):
    """The existing promise, kept: uninstalling must not take the user's
    conversations with it."""
    # Comments only, stripped first. The section explains in prose that
    # %LOCALAPPDATA%\SMARAN.AI is deliberately preserved, and a naive search
    # for that word flagged the sentence promising the very thing being
    # checked - failing whether or not the code was correct.
    body = section(script, "UninstallDelete")
    directives = [l.strip() for l in body.splitlines()
                  if l.strip() and not l.strip().startswith(";")]
    assert directives, "nothing is cleaned up on uninstall at all"
    for line in directives:
        name = re.search(r'Name:\s*"([^"]+)"', line)
        assert name, line
        assert name.group(1).startswith("{app}\\"), (
            "uninstall deletes outside the application folder: %s" % name.group(1)
        )


def test_the_files_section_still_ships_everything(script):
    """The delete only makes sense because [Files] puts it all back."""
    body = section(script, "Files")
    assert "recursesubdirs" in body and "createallsubdirs" in body, body
