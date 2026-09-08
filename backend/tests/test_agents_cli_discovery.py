"""The agents-cli plugin's command list has to come from the CLI.

It used to be typed out by hand, and had drifted: `grade` was offered as a
tool long after grading moved under `eval`, so calling it could only ever
return "No such command 'grade'".
"""

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.plugins.google_agents_cli import GoogleAgentsCLIPlugin as Plugin


# Real `agents-cli --help` output, v1.4.2.
REAL_HELP = """Usage: agents-cli [OPTIONS] COMMAND [ARGS]...

  Agents CLI - Agent Development Lifecycle toolchain.

  Quick start:
    agents-cli setup                 Install skills to your coding agent
    agents-cli create my-agent       Create a new agent project

Options:
  --version  Show the version and exit.
  --help     Show this message and exit.

Commands:
  create          Create GCP-based AI agent projects from templates.
  data-ingestion  Removed: RAG is now a clone-and-study recipe.
  deploy          Deploy the agent.
  eval            Evaluate agents and compare results.
  info            Show project configuration, paths, and CLI version.
  run             Run the agent with a single prompt (non-interactive).
"""


def names(help_text):
    return [c["name"] for c in Plugin._parse_commands(help_text)]


def test_commands_come_from_help_output():
    assert names(REAL_HELP) == ["create", "deploy", "eval", "info", "run"]


def test_grade_is_not_invented():
    """The old hard-coded list advertised a command the CLI does not have."""
    assert "grade" not in names(REAL_HELP)


def test_retired_commands_are_not_offered_as_tools():
    assert "data-ingestion" not in names(REAL_HELP)


def test_descriptions_are_the_real_ones():
    described = {c["name"]: c["description"] for c in Plugin._parse_commands(REAL_HELP)}
    assert described["deploy"] == "Deploy the agent."


def test_options_section_after_commands_is_not_read_as_commands():
    trailing = REAL_HELP + "\nOptions:\n  --verbose  Chatty.\n"
    assert "--verbose" not in names(trailing)
    assert names(trailing) == names(REAL_HELP)


def test_wrapped_descriptions_are_joined():
    wrapped = """Commands:
  scaffold        Scaffold, enhance, and upgrade agent projects so that
                  they can be deployed.
  info            Show project configuration.
"""
    parsed = {c["name"]: c["description"] for c in Plugin._parse_commands(wrapped)}
    assert parsed["scaffold"] == (
        "Scaffold, enhance, and upgrade agent projects so that they can be deployed."
    )
    assert parsed["info"] == "Show project configuration."


def test_non_ascii_help_output_survives():
    """Windows consoles cannot encode what this CLI prints.

    The subprocess reads as UTF-8 with errors='replace', so the parser has to
    cope with both real non-ASCII text and the replacement characters left
    where decoding gave up.
    """
    non_ascii = """Commands:
  create    Créer un projet d'agent - — dash, box │ bar.
  deploy    �� mangled bytes survived decoding.
  info      सेटिंग्स दिखाएं
"""
    parsed = {c["name"]: c["description"] for c in Plugin._parse_commands(non_ascii)}
    assert set(parsed) == {"create", "deploy", "info"}
    assert parsed["create"].startswith("Créer")
    assert parsed["info"] == "सेटिंग्स दिखाएं"


def test_no_commands_section_yields_nothing():
    """An unparseable help page must produce no tools, not guesses."""
    assert Plugin._parse_commands("Usage: agents-cli [OPTIONS]\n") == []
    assert Plugin._parse_commands("") == []


def _plugin():
    plugin = Plugin.__new__(Plugin)
    plugin.agents_cli_path = "/nonexistent/agents-cli"
    plugin._commands = Plugin._parse_commands(REAL_HELP)
    return plugin


def test_tools_are_named_for_discovered_commands():
    tools = {t["name"] for t in _plugin().get_tools()}
    assert tools == {
        "agents_cli_create", "agents_cli_deploy", "agents_cli_eval",
        "agents_cli_info", "agents_cli_run",
    }
    assert "agents_cli_grade" not in tools


@pytest.mark.parametrize("command", [
    "--config=/etc/passwd",   # an option, not a command
    "../../bin/sh",           # a path
    "eval; rm -rf /",         # shell punctuation
    "",
])
def test_command_names_that_are_not_command_names_are_refused(command):
    with pytest.raises(ValueError):
        asyncio.run(_plugin().execute_tool("agents_cli_run", {"command": command}))


def test_run_without_a_command_does_not_become_agents_cli_run():
    """`agents-cli run` starts an agent; reaching it by omission is wrong."""
    with pytest.raises(ValueError):
        asyncio.run(_plugin().execute_tool("agents_cli_run", {"command": ""}))


def test_non_string_args_are_refused():
    with pytest.raises(ValueError):
        asyncio.run(_plugin().execute_tool("agents_cli_info", {"args": [1, 2]}))


def test_unavailable_cli_reports_rather_than_runs():
    plugin = _plugin()
    plugin.agents_cli_path = None
    with pytest.raises(RuntimeError):
        asyncio.run(plugin.execute_tool("agents_cli_info", {}))
