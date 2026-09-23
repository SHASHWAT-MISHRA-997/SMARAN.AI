"""No invisible control characters in source.

A backspace (0x08) sat in nine regular expressions in main.py where `\\b` was
meant - written through a tool that turned the two characters into one. Each
pattern looked right in an editor that hides control characters and matched
nothing: every remembered fact was filed as "durable record" whatever it said,
and a model's size could not be read from its tag. Nothing failed; the
features just quietly did not work.
"""
from pathlib import Path

import pytest

from app.main import _categorise_fact

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [
    ROOT / "backend" / "app",
    ROOT / "frontend" / "src",
    ROOT / "frontend" / "android" / "app" / "src" / "main" / "java",
    ROOT / "vscode-extension" / "src",
]
SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".java", ".css", ".html"}
# Tab, newline and carriage return are text. Nothing else below 0x20 is.
ALLOWED = {"\t", "\n", "\r"}


def _files():
    for base in SOURCES:
        if base.exists():
            yield from (p for p in base.rglob("*") if p.suffix in SUFFIXES and p.is_file())


def test_source_holds_no_control_characters():
    offenders = []
    for path in _files():
        text = path.read_text(encoding="utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), 1):
            bad = [c for c in line if ord(c) < 0x20 and c not in ALLOWED]
            if bad:
                offenders.append(f"{path.relative_to(ROOT)}:{number} {[hex(ord(c)) for c in bad]}")
    assert not offenders, "\n".join(offenders[:20])


@pytest.mark.parametrize("fact, category", [
    ("My name is Shashwat", "identity_core"),
    ("He is working on a startup", "active_projects"),
    ("My brother is a doctor", "relationships"),
    ("She usually wakes up at six", "behaviours_habits"),
    ("The meeting moved to Friday", "durable_record"),
])
def test_remembered_facts_are_filed_by_what_they_say(fact, category):
    assert _categorise_fact(fact) == category
