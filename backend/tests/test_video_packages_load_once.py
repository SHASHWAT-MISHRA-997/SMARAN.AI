"""The image/video packages: a failed load is reported, and never retried into WinError 206.

Windows refuses DLL folder registrations past about 32K characters in total.
torch registered torch\\lib on every import attempt and the status poll retried
a failed import every 1.5 s, so torch ended up unable to load at all while the
page said "not installed yet".
"""
import os

import pytest

from app.video import install


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setattr(install, "_package_failure", None)
    yield


@pytest.mark.skipif(os.name != "nt", reason="add_dll_directory is Windows only")
def test_a_folder_is_registered_once(tmp_path):
    install._register_dll_directories_once()
    folder = str(tmp_path)
    handles = [os.add_dll_directory(folder) for _ in range(1000)]  # past the old limit
    assert isinstance(handles[1], install._AlreadyRegistered)
    handles[0].close()
    # Closed for real, so the next registration is a real one again.
    again = os.add_dll_directory(folder)
    assert not isinstance(again, install._AlreadyRegistered)
    again.close()


def test_a_broken_package_is_imported_once_and_reported(monkeypatch):
    calls = []

    def broken(name):
        calls.append(name)
        raise OSError("[WinError 127] The specified procedure could not be found")

    monkeypatch.setattr(install.importlib, "import_module", broken)
    first = install._package_error()
    assert "WinError 127" in first and first.startswith("torch")
    assert install._package_error() == first
    assert calls == ["torch"]


def test_missing_packages_are_not_remembered(monkeypatch):
    def missing(name):
        raise ModuleNotFoundError(f"No module named '{name}'", name=name)

    monkeypatch.setattr(install.importlib, "import_module", missing)
    assert install._package_error().startswith("torch")
    assert install.load_failure() is None   # an install can still fix this


def test_probe_says_why_instead_of_not_installed(monkeypatch):
    from app.video import hardware

    monkeypatch.setattr(install, "_package_failure", "torch: OSError: DLL load failed")
    hw = hardware.probe()
    assert "would not load" in hw.reason and "DLL load failed" in hw.reason
    assert "not installed yet" not in hw.reason


def test_a_package_already_imported_finds_missing_parts_in_the_fetched_copy(tmp_path, monkeypatch):
    import importlib
    import sys
    import types

    bundled = tmp_path / "bundle" / "smaran_fake_pkg"
    bundled.mkdir(parents=True)
    fetched = tmp_path / "live" / "smaran_fake_pkg"
    fetched.mkdir(parents=True)
    (fetched / "__init__.py").write_text("")
    (fetched / "extra.py").write_text("VALUE = 7\n")

    package = types.ModuleType("smaran_fake_pkg")
    package.__file__ = str(bundled / "__init__.py")
    package.__path__ = [str(bundled)]
    monkeypatch.setitem(sys.modules, "smaran_fake_pkg", package)

    install._reach_into(str(tmp_path / "live"))
    assert importlib.import_module("smaran_fake_pkg.extra").VALUE == 7
    monkeypatch.delitem(sys.modules, "smaran_fake_pkg.extra", raising=False)
