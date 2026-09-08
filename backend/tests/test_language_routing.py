"""Answering in the language the question was asked in.

The reported fault was that only English and Hindi worked. Detection was
gated behind the language picker, which defaults to English, so a question
typed in Gujarati produced no language instruction at all and came back in
English. Hindi hid the problem because models follow a general "reply in the
user's language" line for Hindi without being told twice.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.translator import SUPPORTED_LANGUAGES, detect_language   # noqa: E402


SAMPLES = {
    "hi": "मुझे इसके बारे में बताइए",
    "gu": "મને આ વિશે કહો",
    "bn": "আমাকে এটি সম্পর্কে বলুন",
    "ta": "இதைப் பற்றி எனக்குச் சொல்லுங்கள்",
    "te": "దీని గురించి నాకు చెప్పండి",
    "kn": "ಇದರ ಬಗ್ಗೆ ನನಗೆ ಹೇಳಿ",
    "ml": "ഇതിനെക്കുറിച്ച് എന്നോട് പറയൂ",
    "pa": "ਮੈਨੂੰ ਇਸ ਬਾਰੇ ਦੱਸੋ",
}


@pytest.mark.parametrize("code,text", sorted(SAMPLES.items()))
def test_each_script_is_recognised(code, text):
    assert detect_language(text) == code


def test_english_is_recognised():
    assert detect_language("Tell me about this") == "en"


def test_hinglish_in_latin_script_reads_as_english():
    """Romanised Hindi has no Devanagari to count, so it cannot be told apart.

    Recorded because it decides behaviour: 'mujhe iske baare mein batao' is
    routed as English and answered by the general language-matching rule
    rather than by an explicit instruction.
    """
    assert detect_language("mujhe iske baare mein batao") == "en"


def test_marathi_reads_as_hindi_because_the_script_is_shared():
    """Devanagari cannot separate them; only the picker can."""
    assert detect_language("मला याबद्दल सांगा") == "hi"


def test_a_mixed_sentence_follows_its_script():
    assert detect_language("Please मुझे यह समझाइए विस्तार से") == "hi"


def test_empty_input_is_not_guessed():
    assert detect_language("") is None
    assert detect_language("   ") is None


# ---- naming ---------------------------------------------------------------

def language_name():
    from app.main import _language_name
    return _language_name


@pytest.mark.parametrize("code,name", [
    ("gu", "Gujarati"), ("ta", "Tamil"), ("te", "Telugu"), ("kn", "Kannada"),
    ("ml", "Malayalam"), ("bn", "Bengali"), ("pa", "Punjabi"), ("mr", "Marathi"),
    ("hi", "Hindi"),
])
def test_every_offered_language_has_a_name(code, name):
    """A code reaching the prompt would read 'Respond entirely in gu'."""
    assert language_name()(code) == name


def test_english_and_auto_produce_no_instruction():
    assert language_name()("en") == ""
    assert language_name()("auto") == ""
    assert language_name()("") == ""


def test_a_language_with_no_name_is_not_pasted_in_as_a_code():
    assert language_name()("xx") == ""


def test_scripts_the_detector_can_report_are_all_nameable():
    """Anything detection can return must be sayable, or say nothing."""
    for code in ("ru", "ja", "ko", "zh-CN"):
        assert language_name()(code) not in ("", code), code


def test_every_language_the_picker_offers_is_supported_by_the_translator():
    # The ten in the interface, kept in step with the backend's own table.
    offered = ["en", "hi", "gu", "pa", "mr", "bn", "ta", "te", "ml", "kn"]
    missing = [c for c in offered if c not in SUPPORTED_LANGUAGES]
    assert not missing, f"offered in the UI but unknown to the backend: {missing}"
