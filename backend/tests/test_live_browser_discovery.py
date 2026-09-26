"""Live Browser finds a Chromium-family browser where real Linux machines keep one."""
import os
import sys

import pytest

from app import live_browser as lb


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux lookup")
def test_a_playwright_chromium_is_found_when_nothing_is_on_path(tmp_path, monkeypatch):
    exe = tmp_path / "chromium-1200" / "chrome-linux" / "chrome"
    exe.parent.mkdir(parents=True)
    exe.write_text("")
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    monkeypatch.delenv("SMARAN_BROWSER", raising=False)
    monkeypatch.setattr(lb.shutil, "which", lambda name: None)
    monkeypatch.setattr(lb, "_LINUX_PATHS", [])
    assert lb.find_browser() == str(exe)


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux lookup")
def test_a_browser_under_opt_is_found(tmp_path, monkeypatch):
    exe = tmp_path / "chrome"
    exe.write_text("")
    monkeypatch.delenv("SMARAN_BROWSER", raising=False)
    monkeypatch.setattr(lb.shutil, "which", lambda name: None)
    monkeypatch.setattr(lb, "_LINUX_PATHS", [str(exe)])
    assert lb.find_browser() == str(exe)


def test_the_override_wins(tmp_path, monkeypatch):
    exe = tmp_path / "mybrowser"
    exe.write_text("")
    monkeypatch.setenv("SMARAN_BROWSER", str(exe))
    assert lb.find_browser() == str(exe)
