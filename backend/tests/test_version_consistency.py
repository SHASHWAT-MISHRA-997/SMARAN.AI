"""One release, one version number, in every place that states it.

The version is baked into every frozen binary, so a release means editing it in
several files at once - and the failure mode is silent. The ping endpoint once
answered 2.8.5 while the app was 2.9.6, four releases of anything asking it
being told the wrong thing, because that one was typed in by hand rather than
read from the single source.

This walks the declarations that a human has to edit and asserts they agree.
It does not care *which* version they say, only that they say the same one, so
it keeps working across bumps without needing to be edited itself.
"""

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

SEMVER = r"(\d+\.\d+\.\d+)"


def _search(relative_path, pattern):
    path = ROOT / relative_path
    if not path.exists():
        pytest.skip(f"{relative_path} is not present in this checkout")
    found = re.search(pattern, path.read_text(encoding="utf-8"))
    assert found, f"no version matching {pattern!r} found in {relative_path}"
    return found.group(1)


def declared_versions():
    versions = {
        "README.md badge": _search("README.md", r"badge/version-" + SEMVER),
        "installer/SMARAN.AI.iss": _search(
            "installer/SMARAN.AI.iss", r'#define\s+AppVersion\s+"' + SEMVER + '"'
        ),
        "cli/smaran_cli/__init__.py": _search(
            "cli/smaran_cli/__init__.py", r'__version__\s*=\s*"' + SEMVER + '"'
        ),
        "backend/app/updates.py": _search(
            "backend/app/updates.py", r'SMARAN_APP_VERSION",\s*"' + SEMVER + '"'
        ),
        "backend/app/usage_reporting.py": _search(
            "backend/app/usage_reporting.py", r'SMARAN_APP_VERSION",\s*"' + SEMVER + '"'
        ),
        "frontend/android build.gradle": _search(
            "frontend/android/app/build.gradle", r'versionName\s+"' + SEMVER + '"'
        ),
    }
    package_json = ROOT / "frontend" / "package.json"
    if package_json.exists():
        versions["frontend/package.json"] = json.loads(
            package_json.read_text(encoding="utf-8")
        )["version"]
    return versions


def test_every_declared_version_agrees():
    versions = declared_versions()
    distinct = set(versions.values())
    assert len(distinct) == 1, (
        "these disagree: "
        + ", ".join(f"{where}={what}" for where, what in sorted(versions.items()))
    )


def test_the_running_app_reports_that_same_version():
    from app.updates import APP_VERSION

    declared = set(declared_versions().values())
    assert APP_VERSION in declared, (
        f"the app reports {APP_VERSION} but the files declare {sorted(declared)}"
    )


def test_android_version_code_tracks_the_version_name():
    """`versionCode` is what Android uses to decide an upgrade is an upgrade."""
    gradle = (ROOT / "frontend/android/app/build.gradle").read_text(encoding="utf-8")
    name = re.search(r'versionName\s+"' + SEMVER + '"', gradle).group(1)
    code = int(re.search(r"versionCode\s+(\d+)", gradle).group(1))
    major, minor, patch = (int(part) for part in name.split("."))
    expected = major * 10000 + minor * 100 + patch
    assert code == expected, (
        f"versionName {name} implies versionCode {expected}, found {code}. "
        "Shipping a build whose code did not increase means the phone refuses "
        "the update without saying why."
    )


def test_no_handler_hardcodes_its_own_version_string():
    """`main.py` had one typed in, and it drifted four releases behind."""
    source = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
    literals = re.findall(r'"version":\s*"(\d+\.\d+\.\d+)"', source)
    assert literals == [], (
        f"these are typed in rather than read from APP_VERSION: {literals}"
    )
