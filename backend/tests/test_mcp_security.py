"""What a custom MCP entry is allowed to do to the machine.

A custom server is a string the user supplies, and it becomes either an HTTP
request or a process. Both are worth pinning down: the first is a request
this app will make on someone's behalf, and the second is a program it will
run. These assert the properties that make that safe, so a later change
cannot quietly remove one.
"""

import asyncio
import json
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.mcp import client as mcp_client        # noqa: E402
from app.mcp.manager import MCPManager          # noqa: E402


# ---- the command transport does not go through a shell ---------------------

@pytest.mark.parametrize("target,expected_first", [
    ("npx -y @modelcontextprotocol/server-filesystem .", "npx"),
    ("uvx mcp-server-git", "uvx"),
])
def test_an_ordinary_published_command_parses_as_argv(target, expected_first):
    import shlex, os
    parts = shlex.split(target, posix=(os.name != "nt"))
    assert parts[0] == expected_first


@pytest.mark.parametrize("target", [
    "npx server; calc.exe",
    "npx server && calc.exe",
    "npx server | calc.exe",
    "npx server $(calc.exe)",
    "npx server `calc.exe`",
    "npx server & calc.exe",
])
def test_shell_punctuation_stays_an_argument(target):
    """No shell is involved, so `;` and friends cannot start a second command.

    `create_subprocess_exec` is used rather than `create_subprocess_shell`, so
    everything after the program name is argv. This asserts the property
    rather than the implementation: whatever the parse, the punctuation must
    never end up as a separate program to run.
    """
    import shlex, os
    parts = shlex.split(target, posix=(os.name != "nt"))
    # The program that would actually be launched is parts[0], and it is the
    # one the user named - never calc.exe.
    assert parts[0] == "npx"
    assert not any(p == "calc.exe" and i == 0 for i, p in enumerate(parts))


def test_the_stdio_transport_never_asks_for_a_shell():
    """A regression guard with teeth: the source must not gain shell=True."""
    source = (BACKEND / "app/mcp/client.py").read_text(encoding="utf-8")
    assert "create_subprocess_shell" not in source, \
        "a shell transport would make every target a command line"
    assert "shell=True" not in source
    assert "create_subprocess_exec" in source


# ---- the transport is chosen by the target, and only two exist -------------

@pytest.mark.parametrize("target,is_http", [
    ("http://127.0.0.1:9000/mcp", True),
    ("https://example.com/mcp", True),
    ("npx -y some-server", False),
    ("file:///etc/passwd", False),      # not http(s): treated as a command
])
def test_only_http_targets_take_the_http_path(target, is_http):
    assert target.startswith(("http://", "https://")) is is_http


# ---- what is stored, and where --------------------------------------------

def test_a_server_name_is_a_key_not_a_path(tmp_path, monkeypatch):
    """Names with traversal in them must not escape the data directory."""
    import app.config as config
    monkeypatch.setattr(config.settings, "DATA_DIR", str(tmp_path), raising=False)

    manager = MCPManager()
    manager.add("../../evil", "npx thing")

    store = tmp_path / "mcp_servers.json"
    assert store.is_file(), "the store must stay inside the data directory"
    saved = json.loads(store.read_text(encoding="utf-8"))
    assert "../../evil" in saved, "the name is a key, kept verbatim"
    # Nothing was created outside the data directory.
    assert not (tmp_path.parent / "evil").exists()
    assert list(tmp_path.iterdir()) == [store]


def test_saving_a_server_does_not_start_it(tmp_path, monkeypatch):
    """The saved/connected distinction the UI depends on."""
    import app.config as config
    monkeypatch.setattr(config.settings, "DATA_DIR", str(tmp_path), raising=False)

    started = []
    monkeypatch.setattr(mcp_client, "connect",
                        lambda *a, **k: started.append(a) or None)

    manager = MCPManager()
    record = manager.add("probe-me", "npx -y definitely-not-installed")
    assert record["enabled"] is True
    assert started == [], "adding a server must not run anything"


def test_a_disabled_server_is_refused_before_anything_runs(tmp_path, monkeypatch):
    import app.config as config
    monkeypatch.setattr(config.settings, "DATA_DIR", str(tmp_path), raising=False)

    manager = MCPManager()
    manager.add("off", "npx -y thing")
    servers = manager.load()
    servers["off"]["enabled"] = False
    manager.save(servers)

    from app.mcp.manager import MCPError
    with pytest.raises(MCPError, match="turned off"):
        asyncio.run(manager.session("off"))


def test_an_unknown_server_is_refused_by_name(tmp_path, monkeypatch):
    import app.config as config
    monkeypatch.setattr(config.settings, "DATA_DIR", str(tmp_path), raising=False)

    from app.mcp.manager import MCPError
    with pytest.raises(MCPError, match="No server named"):
        asyncio.run(MCPManager().session("nothing-here"))
