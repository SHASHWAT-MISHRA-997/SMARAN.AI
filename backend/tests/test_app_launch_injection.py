"""An application name cannot become a command.

The name reaches desktop_agent from speech, from typing, and from a model
choosing what to open - possibly right after reading a hostile web page. The
last launcher fallback passed it to cmd.exe as `start "" <name>`, and a name
with no spaces is not quoted, so "notepad&calc" opened Notepad and then ran
calc. `&` could chain anything.

Two fixes, tested separately: the fallback no longer goes through a shell at
all, and a name carrying shell or path syntax is refused before any launcher
sees it.
"""

import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import desktop_agent  # noqa: E402
from app.desktop_agent import DesktopAgent, _SAFE_APP_NAME  # noqa: E402


@pytest.mark.parametrize("name", [
    "notepad", "notepad++", "7-zip", "paint.net", "google chrome", "o'reilly",
    "क्रोम", "वीएलसी",
])
def test_real_application_names_are_allowed(name):
    assert _SAFE_APP_NAME.fullmatch(name)


@pytest.mark.parametrize("name", [
    "zzq&calc", "x|y", "a>b", "a<b", "a^b", "a%PATH%", 'a"b', "a;b", "a`b",
    "a$b", "a(b)", "a!b", "a\nb", "a\rb", "c:/windows/x.exe", "..\\evil",
    "a/b", "a*", "a?", "x" * 81,
])
def test_names_carrying_shell_or_path_syntax_are_refused(name):
    assert not _SAFE_APP_NAME.fullmatch(name)


def test_the_action_refuses_an_injection_before_launching_anything(monkeypatch):
    launched = []
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: launched.append(a))
    monkeypatch.setattr(desktop_agent.os, "startfile", lambda *a, **k: launched.append(a), raising=False)
    result = DesktopAgent._action_open_application({"name": "zzq&calc"})
    assert result["success"] is False
    assert launched == []


def test_the_fallback_launch_never_uses_a_shell(monkeypatch):
    """Even for a name that passes, nothing is handed to cmd.exe."""
    shells = []
    real_popen = subprocess.Popen

    def watch(*args, **kwargs):
        if kwargs.get("shell"):
            shells.append(args)
        raise FileNotFoundError("not launched in tests")

    monkeypatch.setattr(subprocess, "Popen", watch)
    monkeypatch.setattr(desktop_agent.subprocess, "Popen", watch)
    monkeypatch.setattr(desktop_agent.os, "startfile",
                        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()), raising=False)
    DesktopAgent._action_open_application({"name": "some-app-that-is-not-registered"})
    assert shells == [], "an unregistered name reached a shell"
    assert subprocess.Popen is watch and real_popen is not watch
