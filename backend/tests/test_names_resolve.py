"""Every name the backend uses is one it can actually find.

Four separate faults of one kind were live at the same time, each in a path
that only runs when something goes wrong or somebody clicks a particular
button, so an import of the module - and every test that imports it - passed:

* `_clean_user_error` was called in five error handlers and never written.
  When a stream failed, the handler raised NameError inside the response body,
  after the headers had gone, and the reply simply stopped with no message.
* `chat_interaction` did `import os` inside one branch. That made `os` local
  to the whole function, so the generator nested in it saw an unbound free
  variable on every turn that did not take that branch - which was every
  local-model chat turn. The error handler above then hid it.
* Deleting a duplicate route took `_download_progress`, `_cancel_events` and
  `import threading` with it; Model Hub's download routes 500'd on every call.
* Deleting a fake video drawer took two constants the real video path used.

The first, third and fourth are undefined names, which pyflakes finds. The
second is not: pyflakes accepts it, because the name *is* defined - just in
the wrong scope. It gets its own check below.
"""

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"


def _sources():
    return sorted(p for p in APP.rglob("*.py") if "__pycache__" not in p.parts)


def test_no_undefined_names_anywhere_in_the_backend():
    checker = pytest.importorskip("pyflakes.api")
    reporter_mod = pytest.importorskip("pyflakes.reporter")
    import io

    out, err = io.StringIO(), io.StringIO()
    reporter = reporter_mod.Reporter(out, err)
    for path in _sources():
        checker.check(path.read_text(encoding="utf-8"), str(path), reporter)
    undefined = [line for line in out.getvalue().splitlines() if "undefined name" in line]
    assert not undefined, "\n".join(undefined)


def _module_level_imports(tree):
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
    return names


@pytest.mark.parametrize("path", _sources(), ids=lambda p: p.relative_to(APP).as_posix())
def test_no_function_reimports_a_module_name_its_inner_functions_use(path):
    """The `import os` trap.

    A function that re-imports a module the file already imported makes that
    name local to itself. Harmless on its own - but any function nested inside
    it now resolves the name through the enclosing scope, where it is unbound
    until the import line has run.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    top = _module_level_imports(tree)
    problems = []

    for outer in ast.walk(tree):
        if not isinstance(outer, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        reimported = {}
        for node in ast.walk(outer):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    name = (alias.asname or alias.name).split(".")[0]
                    if name in top:
                        reimported[name] = node.lineno
        if not reimported:
            continue
        for inner in ast.walk(outer):
            if inner is outer or not isinstance(inner, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            used = {n.id for n in ast.walk(inner) if isinstance(n, ast.Name)}
            for name in sorted(used & set(reimported)):
                problems.append(
                    f"{outer.name}() re-imports {name!r} on line {reimported[name]}, "
                    f"and its inner function on line {inner.lineno} uses it")
    assert not problems, "\n".join(problems)


def test_error_messages_shown_in_chat_have_keys_removed():
    """What `_clean_user_error` is for, now that it exists."""
    import sys
    backend = str(APP.parent)
    if backend not in sys.path:
        sys.path.insert(0, backend)
    from app.main import _clean_user_error

    shown = _clean_user_error(
        "401 from provider: Authorization: Bearer sk-or-v1-abcdef0123456789abcdef "
        "rejected; api_key=gsk_ZZZZZZZZZZZZZZZZZZZZ\n\n   and AIzaSyA1234567890abcdef")
    for secret in ("sk-or-v1-abcdef0123456789abcdef", "gsk_ZZZZZZZZZZZZZZZZZZZZ", "AIzaSyA1234567890abcdef"):
        assert secret not in shown
    assert "401 from provider" in shown
    assert "\n" not in shown
    assert _clean_user_error("") == "The request failed without saying why."
    assert len(_clean_user_error("x" * 5000)) <= 403
