"""An empty request must not launch an Office application.

Found by driving /api/office against a running backend. Excel and PowerPoint
both refused a request with no content. Word did not: it started Word through
COM and left an empty document open on the desktop. The audit run that found
this opened a real Word window on the owner's machine.

Asking for a document is never a request for a blank one. When there are no
paragraphs it means the text meant to fill them never arrived, and opening Word
anyway hides that failure behind a window that looks like success.

These run without Office installed: the COM dispatch and the availability check
are both replaced, so what is tested is the decision to refuse, which is taken
before either is reached.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.office import documents  # noqa: E402


@pytest.fixture
def no_office(monkeypatch):
    """Everything is 'installed', and nothing is ever actually launched."""
    launched = []
    monkeypatch.setattr(documents, "_require", lambda name: None)
    monkeypatch.setattr(documents, "_dispatch",
                        lambda prog_id: launched.append(prog_id))
    return launched


EMPTY = (
    ("word", lambda: documents.write_word("Doc", [], None)),
    ("excel", lambda: documents.write_excel("Book", [], "Sheet1")),
    ("powerpoint", lambda: documents.write_powerpoint("Deck", [])),
)


@pytest.mark.parametrize("name,invoke", EMPTY)
def test_an_empty_request_is_refused(name, invoke, no_office):
    with pytest.raises(documents.OfficeError):
        invoke()


@pytest.mark.parametrize("name,invoke", EMPTY)
def test_nothing_is_launched_when_the_request_is_empty(name, invoke, no_office):
    """The refusal has to happen before the application starts, or the window
    is already on screen by the time the error is raised."""
    with pytest.raises(documents.OfficeError):
        invoke()
    assert no_office == [], (
        "%s started %s before refusing" % (name, no_office)
    )


def test_word_refuses_an_empty_body_but_accepts_a_heading_alone(no_office):
    """A heading with no paragraphs is still a document with content in it."""
    with pytest.raises(documents.OfficeError):
        documents.write_word("Doc", [], None)

    assert no_office == [], "the empty request reached COM"

    # This one must get past the guard. It still fails, because the COM
    # dispatch is replaced - and write_word wraps that in an OfficeError too,
    # so the exception type cannot tell the two apart. What distinguishes them
    # is whether Word was reached at all.
    with pytest.raises(documents.OfficeError):
        documents.write_word("Doc", [], "A heading")
    assert no_office == ["Word.Application"], (
        "a document with a heading was refused as empty instead of being written"
    )


def test_the_three_com_writers_agree_with_each_other():
    """The defect was one of three disagreeing, which is easy to reintroduce
    by adding a fourth writer and forgetting the guard."""
    import inspect
    for name in ("write_word", "write_excel", "write_powerpoint"):
        source = inspect.getsource(getattr(documents, name))
        assert "OfficeError" in source and "if not" in source, (
            "%s has no guard against being asked for an empty document" % name
        )
