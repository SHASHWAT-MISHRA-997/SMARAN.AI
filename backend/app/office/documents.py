"""Writing Word, Excel, PowerPoint and plain text files.

Office is driven through COM, which is how Office is meant to be driven on
Windows: it is the same interface its own macros use, so a document made this
way is an ordinary document, not something that had text typed into it by a
robot pressing keys. Sending keystrokes at a window is the fragile approach —
it depends on which window has focus, breaks if anything steals it, and
cannot tell you whether it worked.

Every document is left **open and visible**. Nothing is saved silently in the
background and nothing is emailed or shared. The file appears, the app comes
to the front, and what happens next is the person's.

Office is not installed on every machine, and this refuses with that fact
rather than raising something from deep inside COM.
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("office")


class OfficeError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def _output_dir() -> Path:
    """Where documents land: Documents/SMARAN.AI, created on first use."""
    base = Path.home() / "Documents" / "SMARAN.AI"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _unique(name: str, suffix: str) -> Path:
    """A path that does not already exist, so nothing is ever overwritten."""
    safe = "".join(c for c in name if c.isalnum() or c in " -_").strip() or "Document"
    path = _output_dir() / f"{safe}{suffix}"
    n = 2
    while path.exists():
        path = _output_dir() / f"{safe} ({n}){suffix}"
        n += 1
    return path


def available() -> dict:
    """Which of these can actually run here, asked of the registry.

    Checked rather than assumed: Word being absent is the normal case on a
    machine that never had Office, and finding out by crashing is no way to
    tell someone.
    """
    import winreg

    def registered(prog_id: str) -> bool:
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{prog_id}\\CurVer"):
                return True
        except OSError:
            return False

    try:
        import win32com.client  # noqa: F401
        com = True
    except ImportError:
        com = False

    result = {
        "com": com,
        # Registered means the program id exists. It does not mean the app
        # will run: on this machine Word is registered and answers
        # "the licence to use this application has expired", while Excel on
        # the same install works. Registration alone was reported as working
        # and that was wrong, so it is labelled for what it is.
        "word_registered": com and registered("Word.Application"),
        "excel_registered": com and registered("Excel.Application"),
        "powerpoint_registered": com and registered("PowerPoint.Application"),
        # Notepad needs neither COM nor Office: it is a text file and a
        # process, so it works on any Windows.
        "notepad": os.name == "nt",
    }
    result["word"] = result["word_registered"]
    result["excel"] = result["excel_registered"]
    result["powerpoint"] = result["powerpoint_registered"]

    # There was a probe here that started each app and read a collection
    # to decide whether it really worked. It was measured against the real
    # thing and it lied in both directions: Word passed the probe and then
    # failed to write with "the licence has expired", while Excel failed the
    # probe and wrote a file perfectly. Whether Office will do the job cannot
    # be known without asking it to do the job, so nothing here pretends
    # otherwise - the attempt returns Office's own sentence instead.

    return result


def _readable(exc: Exception) -> str:
    """The sentence Office actually returned, rather than the COM tuple."""
    text = str(exc)
    if "licence" in text or "license" in text:
        return "Office reports its licence has expired for this application."
    marker = text.find("Microsoft")
    return text[marker:marker + 120] if marker >= 0 else text[:120]


def _require(app: str) -> None:
    have = available()
    if not have["com"]:
        raise OfficeError(
            "pywin32 is not installed, so Office cannot be driven from here."
        )
    if not have.get(app):
        raise OfficeError(
            "%s is not installed on this machine. The document was not created; "
            "nothing pretends to have written it."
            % app.capitalize()
        )


def _dispatch(prog_id: str):
    """Start or attach to an Office application, made visible."""
    import pythoncom
    import win32com.client

    # Each request may arrive on a different worker thread, and COM has to be
    # initialised per thread. Doing it here rather than at import is what
    # keeps this working under a threaded server.
    pythoncom.CoInitialize()
    try:
        app = win32com.client.Dispatch(prog_id)
    except Exception as exc:
        raise OfficeError("Could not start %s: %s" % (prog_id, exc)) from exc
    try:
        app.Visible = True
    except Exception:
        # PowerPoint refuses Visible = False and some builds refuse the
        # assignment entirely; it is already visible by default.
        pass
    return app


# ── Word ───────────────────────────────────────────────────────────────

def write_word(title: str, paragraphs: List[str],
               heading: Optional[str] = None) -> dict:
    """A Word document with a heading and paragraphs, left open on screen."""
    _require("word")
    path = _unique(title, ".docx")

    app = _dispatch("Word.Application")
    try:
        document = app.Documents.Add()

        # Text goes in with InsertAfter on the document's content, not by
        # assigning to a new paragraph's Range. A paragraph's Range includes
        # its paragraph mark, and writing over that is what Word rejects with
        # "The character position is not valid" - which is exactly what the
        # first version of this did.
        content = document.Content
        blocks = ([heading] if heading else []) + list(paragraphs)
        for text in blocks:
            # Word ends a paragraph with a carriage return, not a newline.
            content.InsertAfter(str(text) + chr(13))

        # Styled afterwards, by index, now that the paragraphs exist. Style
        # names are localised, so a failure here is cosmetic and must not be
        # allowed to lose the document.
        try:
            if heading:
                first = document.Paragraphs(1).Range
                try:
                    first.Style = document.Styles("Heading 1")
                except Exception:
                    first.Font.Size = 18
                    first.Font.Bold = True
        except Exception:
            pass

        document.SaveAs2(str(path))
    except OfficeError:
        raise
    except Exception as exc:
        raise OfficeError("Word could not write the document: %s" % exc) from exc

    return {"path": str(path), "app": "Word", "paragraphs": len(paragraphs)}


# ── Excel ──────────────────────────────────────────────────────────────

def write_excel(title: str, rows: List[List], sheet_name: str = "Sheet1") -> dict:
    """A spreadsheet from a list of rows, the first treated as the header."""
    _require("excel")
    if not rows:
        raise OfficeError("There are no rows to write.")
    path = _unique(title, ".xlsx")

    app = _dispatch("Excel.Application")
    try:
        book = app.Workbooks.Add()
        sheet = book.Worksheets(1)
        try:
            sheet.Name = sheet_name[:31]   # Excel's own limit
        except Exception:
            pass

        for r, row in enumerate(rows, start=1):
            for c, value in enumerate(row, start=1):
                sheet.Cells(r, c).Value = value

        try:
            header = sheet.Range(sheet.Cells(1, 1), sheet.Cells(1, len(rows[0])))
            header.Font.Bold = True
            sheet.Columns.AutoFit()
        except Exception:
            pass

        book.SaveAs(str(path))
    except OfficeError:
        raise
    except Exception as exc:
        raise OfficeError("Excel could not write the workbook: %s" % exc) from exc

    return {"path": str(path), "app": "Excel",
            "rows": len(rows), "columns": len(rows[0])}


# ── PowerPoint ─────────────────────────────────────────────────────────

def write_powerpoint(title: str, slides: List[dict]) -> dict:
    """A deck. Each slide is {"title": str, "bullets": [str]}."""
    _require("powerpoint")
    if not slides:
        raise OfficeError("There are no slides to write.")
    path = _unique(title, ".pptx")

    app = _dispatch("PowerPoint.Application")
    try:
        deck = app.Presentations.Add()
        # 2 is ppLayoutText: a title with a body placeholder underneath.
        for index, slide_spec in enumerate(slides, start=1):
            slide = deck.Slides.Add(index, 2)
            slide.Shapes(1).TextFrame.TextRange.Text = slide_spec.get("title", "")
            bullets = slide_spec.get("bullets") or []
            if bullets:
                slide.Shapes(2).TextFrame.TextRange.Text = "\r".join(bullets)
        deck.SaveAs(str(path))
    except OfficeError:
        raise
    except Exception as exc:
        raise OfficeError("PowerPoint could not write the deck: %s" % exc) from exc

    return {"path": str(path), "app": "PowerPoint", "slides": len(slides)}


# ── Notepad ────────────────────────────────────────────────────────────

def write_notepad(title: str, text: str) -> dict:
    """A text file, opened in Notepad.

    No COM and no Office: the file is written and Notepad is asked to open
    it, which is both simpler and more reliable than typing into a window.
    """
    if os.name != "nt":
        raise OfficeError("Notepad is a Windows program.")
    path = _unique(title, ".txt")
    path.write_text(text, encoding="utf-8")

    try:
        subprocess.Popen(["notepad.exe", str(path)])
    except OSError as exc:
        raise OfficeError(
            "The file was written to %s but Notepad would not open: %s"
            % (path, exc)
        ) from exc

    # Popen returns the moment the process is created, which is before the
    # window exists. A short wait makes the result honest about it being open.
    time.sleep(0.4)
    return {"path": str(path), "app": "Notepad", "characters": len(text)}
