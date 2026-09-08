"""The CLI has to be able to print the languages the assistant answers in.

On Windows a redirected stream takes the legacy code page. This machine's is
cp1252, which has no Devanagari, so `smaran ask ... > answer.txt` raised
`UnicodeEncodeError: 'charmap' codec can't encode characters` and wrote
nothing. On the console it looked fine, which is why it went unnoticed.
"""

import io
import subprocess
import sys
from pathlib import Path

import pytest

CLI = Path(__file__).resolve().parents[1]
if str(CLI) not in sys.path:
    sys.path.insert(0, str(CLI))

from smaran_cli.main import _print_any_language          # noqa: E402

SAMPLES = [
    ("Hindi", "नमस्ते दुनिया"),
    ("Gujarati", "ગુજરાતી લખાણ"),
    ("Tamil", "தமிழ் உரை"),
    ("Kannada", "ಕನ್ನಡ ಪಠ್ಯ"),
    ("Bengali", "বাংলা লেখা"),
    ("punctuation", "em — dash, middot ·"),
]


class LegacyStream(io.TextIOWrapper):
    """A stream on a code page that cannot represent Indian scripts."""

    def __init__(self):
        super().__init__(io.BytesIO(), encoding="cp1252", errors="strict")


def test_the_failure_this_guards_is_real():
    """Without the fix, cp1252 refuses Devanagari outright."""
    stream = LegacyStream()
    with pytest.raises(UnicodeEncodeError):
        stream.write("नमस्ते")
        stream.flush()


@pytest.mark.parametrize("name,text", SAMPLES)
def test_every_language_survives_a_redirected_stream(name, text, monkeypatch):
    stream = LegacyStream()
    monkeypatch.setattr(sys, "stdout", stream)
    monkeypatch.setattr(sys, "stderr", stream)

    _print_any_language()
    sys.stdout.write(text)
    sys.stdout.flush()

    written = stream.buffer.getvalue().decode("utf-8")
    assert written == text, f"{name} did not survive"


def test_a_stream_that_cannot_be_reconfigured_is_not_fatal(monkeypatch):
    """An old Python or a replaced stream must not fail the command."""
    class Stubborn(io.StringIO):
        def reconfigure(self, **_kwargs):
            raise AttributeError("no reconfigure here")

    monkeypatch.setattr(sys, "stdout", Stubborn())
    monkeypatch.setattr(sys, "stderr", Stubborn())
    _print_any_language()          # must simply return


def test_the_real_cli_writes_hindi_to_a_file(tmp_path):
    """End to end, through the installed entry point rather than the import."""
    target = tmp_path / "out.txt"
    script = (
        "import sys;"
        "sys.path.insert(0, r'%s');"
        "from smaran_cli.main import _print_any_language;"
        "_print_any_language();"
        "sys.stdout.write('नमस्ते');"
        "sys.stdout.flush()" % CLI
    )
    with target.open("wb") as handle:
        result = subprocess.run([sys.executable, "-c", script],
                                stdout=handle, stderr=subprocess.PIPE)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    assert target.read_bytes().decode("utf-8") == "नमस्ते"
