"""Code has to come out of the translator exactly as it went in.

A reply gets translated whenever the language picker disagrees with the
language the model answered in. That ran over the whole message, code
included: asking for a Python function with the picker set to Hindi sent the
source to Google Translate, which renames identifiers, translates keywords and
rewrites the contents of strings. What came back looked like a program and was
not one - pasting it into an editor could not work.

These pin the contract the user asked for: whatever language the prose is in,
the code block can be copied into any editor and run.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import translator as translator_module  # noqa: E402


class _FakeTranslator:
    """Stands in for Google Translate, and mangles anything it is given.

    Deliberately destructive: if a test still finds intact code afterwards,
    that code genuinely never reached the translator.
    """

    def __init__(self, *_args, **_kwargs):
        self.seen = []

    def translate(self, text):
        self.seen.append(text)
        return "<<TRANSLATED>>"


@pytest.fixture
def fake(monkeypatch):
    made = {}

    def factory(*args, **kwargs):
        made["instance"] = _FakeTranslator(*args, **kwargs)
        return made["instance"]

    monkeypatch.setattr(translator_module, "GoogleTranslator", factory)
    return made


PROGRAM = '''def is_palindrome(s: str) -> bool:
    cleaned = "".join(c.lower() for c in s if not c.isspace())
    return cleaned == cleaned[::-1]
'''


def test_a_fenced_block_is_returned_byte_for_byte(fake):
    message = f"Here is the function:\n\n```python\n{PROGRAM}```\n\nHope it helps."
    result = translator_module.translate_text(message, "hi")
    assert f"```python\n{PROGRAM}```" in result, (
        "the code block came back altered; it must survive verbatim"
    )


def test_the_code_never_reaches_the_translator_at_all(fake):
    message = f"Explanation.\n\n```python\n{PROGRAM}```\n"
    translator_module.translate_text(message, "hi")
    sent = "".join(fake["instance"].seen)
    assert "is_palindrome" not in sent
    assert "cleaned" not in sent, "identifiers were handed to the translator"


def test_the_prose_around_it_is_still_translated(fake):
    message = f"Here is the function:\n\n```python\n{PROGRAM}```\n\nHope it helps."
    result = translator_module.translate_text(message, "hi")
    assert "<<TRANSLATED>>" in result, "prose should still be translated"
    assert "Hope it helps" not in result


def test_inline_code_is_protected_too(fake):
    result = translator_module.translate_text("Call `os.path.join(a, b)` first.", "hi")
    assert "`os.path.join(a, b)`" in result


def test_indentation_inside_the_block_is_preserved(fake):
    message = f"```python\n{PROGRAM}```"
    result = translator_module.translate_text(message, "hi")
    assert "    cleaned = " in result, "leading whitespace was lost"
    assert "    return cleaned" in result


def test_several_blocks_all_survive(fake):
    message = "One:\n```py\nx = 1\n```\nTwo:\n```py\ny = 2\n```\n"
    result = translator_module.translate_text(message, "hi")
    assert "```py\nx = 1\n```" in result
    assert "```py\ny = 2\n```" in result


def test_a_message_with_no_code_is_unaffected_by_the_split(fake):
    result = translator_module.translate_text("Just a sentence.", "hi")
    assert result == "<<TRANSLATED>>"


def test_tilde_fences_count_as_code(fake):
    message = "Text\n~~~\nnot prose\n~~~\n"
    result = translator_module.translate_text(message, "hi")
    assert "~~~\nnot prose\n~~~" in result


def test_an_empty_translation_leaves_the_prose_alone(fake, monkeypatch):
    """A service that answers with nothing must not blank the message."""
    class _Empty(_FakeTranslator):
        def translate(self, text):
            self.seen.append(text)
            return ""

    monkeypatch.setattr(translator_module, "GoogleTranslator", lambda *a, **k: _Empty())
    result = translator_module.translate_text("Keep me.", "hi")
    assert result == "Keep me."
