"""Every tool, against a real folder on disk.

These exist because of a bug that no amount of reading found. read_file and
edit_file asked the workspace for a key called "content"; the workspace calls
it "text". Nothing raised - dict.get returned the empty string - so every file
read as empty and edit_file could never find the text it was asked to replace.
It was caught by watching an agent run: the model was told two files were
empty, did not believe it, and printed them with a shell command instead.

So each test here checks the tool's *result*, not that it ran. A tool that
fails by returning something wrong is exactly the kind this file is for.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.agent import tools as toolbox  # noqa: E402


@pytest.fixture
def project(tmp_path):
    """A small project, and a workspace opened on it."""
    (tmp_path / "hello.py").write_text(
        "def greet(name):\n    return 'hi ' + name\n", encoding="utf-8")
    (tmp_path / "notes.md").write_text("first line\nsecond line\n", encoding="utf-8")
    return toolbox.workspace_for(str(tmp_path))


def test_read_file_returns_the_contents(project):
    result = toolbox.execute("read_file", {"path": "hello.py"}, project)
    assert "def greet(name):" in result
    assert "return 'hi ' + name" in result
    assert "the file is empty" not in result


def test_read_file_numbers_the_lines(project):
    # The model is told it can refer to line numbers; it has to actually see them.
    assert "1  def greet" in toolbox.execute("read_file", {"path": "hello.py"}, project)


def test_edit_file_replaces_and_the_change_reaches_disk(project):
    result = toolbox.execute(
        "edit_file",
        {"path": "hello.py", "find": "'hi ' + name", "replace": "f'hi {name}'"},
        project,
    )
    assert "Wrote" in result
    assert "f'hi {name}'" in (project.root / "hello.py").read_text(encoding="utf-8")


def test_edit_file_says_so_when_the_text_is_not_there(project):
    result = toolbox.execute(
        "edit_file", {"path": "hello.py", "find": "nowhere", "replace": "x"}, project)
    assert "not in hello.py" in result


def test_edit_file_refuses_an_ambiguous_match(project):
    result = toolbox.execute(
        "edit_file", {"path": "notes.md", "find": "line", "replace": "row"}, project)
    assert "appears 2 times" in result
    # And left the file alone rather than editing the first one it found.
    assert (project.root / "notes.md").read_text(encoding="utf-8") == "first line\nsecond line\n"


def test_write_file_creates_and_reports_the_size(project):
    result = toolbox.execute(
        "write_file", {"path": "new.py", "content": "a = 1\nb = 2\n"}, project)
    assert "Wrote new.py" in result
    assert (project.root / "new.py").exists()


def test_list_files_names_what_is_there(project):
    result = toolbox.execute("list_files", {}, project)
    assert "hello.py" in result and "notes.md" in result


def test_search_finds_the_file_and_the_line(project):
    result = toolbox.execute("search", {"query": "greet"}, project)
    assert "hello.py" in result


def test_search_says_so_when_nothing_matches(project):
    assert "No file contains" in toolbox.execute(
        "search", {"query": "zzznotpresent"}, project)


def test_run_command_returns_the_output_and_the_exit_code(project):
    result = toolbox.execute("run_command", {"command": "python -c \"print(6*7)\""}, project)
    assert "exit code 0" in result and "42" in result


def test_run_command_reports_a_failure_rather_than_hiding_it(project):
    result = toolbox.execute("run_command", {"command": "python -c \"raise SystemExit(3)\""}, project)
    assert "exit code 3" in result


def test_nothing_reaches_outside_the_root(project):
    result = toolbox.execute("read_file", {"path": "../../../etc/hosts"}, project)
    assert "outside the open folder" in result


def test_two_workspaces_do_not_touch_each_other(tmp_path):
    """The editor's project and the app's open folder are usually different."""
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "only-in-a.txt").write_text("a", encoding="utf-8")

    workspace_a = toolbox.workspace_for(str(a))
    workspace_b = toolbox.workspace_for(str(b))

    toolbox.execute("write_file", {"path": "made.txt", "content": "x"}, workspace_b)
    assert (b / "made.txt").exists()
    assert not (a / "made.txt").exists()
    assert "only-in-a.txt" not in toolbox.execute("list_files", {}, workspace_b)


def test_an_unknown_tool_is_named_rather_than_ignored(project):
    result = toolbox.execute("delete_everything", {}, project)
    assert "no tool called" in result
    assert "write_file" in result  # it says what does exist


def test_a_missing_argument_is_reported(project):
    assert "needs" in toolbox.execute("edit_file", {"path": "hello.py"}, project)
