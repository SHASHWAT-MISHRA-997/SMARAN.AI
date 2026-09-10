from deep_translator import GoogleTranslator
from typing import Optional
import logging
import re

logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = {
    "auto": "Auto Detect",
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
    "or": "Odia",
    "as": "Assamese",
    "ur": "Urdu",
    "sa": "Sanskrit",
    "ne": "Nepali",
    "si": "Sinhala",
    "my": "Burmese",
    "th": "Thai",
    "zh-CN": "Chinese (Simplified)",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "ru": "Russian",
    "ar": "Arabic",
    "pt": "Portuguese",
    "it": "Italian",
}

INDIAN_LANGUAGES = {
    "hi": "Hindi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
    "or": "Odia",
    "as": "Assamese",
    "ur": "Urdu",
    "sa": "Sanskrit",
    "ne": "Nepali",
    "si": "Sinhala",
    "doi": "Dogri",
    "kok": "Konkani",
    "mni": "Manipuri",
    "sat": "Santali",
    "ks": "Kashmiri",
    "sd": "Sindhi",
    "brx": "Bodo",
    "mai": "Maithili",
}


def detect_language(text: str) -> Optional[str]:
    """Detect common UI languages locally from their Unicode script.

    ``deep-translator`` does not expose ``GoogleTranslator.detect``.  Script
    detection is deterministic, offline, and sufficient for deciding whether
    an already-generated answer needs a translation fallback.
    """
    if not text or not text.strip():
        return None

    script_ranges = (
        ("pa", 0x0A00, 0x0A7F),
        ("gu", 0x0A80, 0x0AFF),
        ("bn", 0x0980, 0x09FF),
        ("or", 0x0B00, 0x0B7F),
        ("ta", 0x0B80, 0x0BFF),
        ("te", 0x0C00, 0x0C7F),
        ("kn", 0x0C80, 0x0CFF),
        ("ml", 0x0D00, 0x0D7F),
        ("hi", 0x0900, 0x097F),
        ("ur", 0x0600, 0x06FF),
        ("ru", 0x0400, 0x04FF),
        ("ja", 0x3040, 0x30FF),
        ("zh-CN", 0x4E00, 0x9FFF),
        ("ko", 0xAC00, 0xD7AF),
    )
    counts = {code: 0 for code, _, _ in script_ranges}
    latin_count = 0
    for character in text:
        value = ord(character)
        if ("A" <= character <= "Z") or ("a" <= character <= "z"):
            latin_count += 1
        for code, start, end in script_ranges:
            if start <= value <= end:
                counts[code] += 1
                break

    detected, detected_count = max(counts.items(), key=lambda item: item[1])
    if detected_count > 0 and detected_count >= latin_count * 0.2:
        return detected
    return "en" if latin_count else None


# A fenced block, or a span of inline code. Kept in one pattern so the split
# below alternates prose, code, prose, code - the fence is matched first so a
# backtick *inside* a fenced block cannot start an inline span.
_CODE_SPAN = re.compile(r"(```.*?```|~~~.*?~~~|`[^`\n]+`)", re.DOTALL)


def _translate_segment(translator, segment: str) -> str:
    """Translate one prose run, leaving it alone if the service returns nothing."""
    if not segment.strip():
        return segment
    translated = translator.translate(segment)
    return translated if translated else segment


def translate_text(text: str, target_lang: str, source_lang: Optional[str] = None) -> str:
    """Translate prose while leaving code exactly as it was written.

    The whole reply used to go to the translator in one piece, code and all.
    A reply is translated whenever the language picker disagrees with the
    language the model answered in, so asking for a Python function with the
    picker on Hindi sent the source through Google Translate: identifiers
    renamed, keywords translated, string contents rewritten. What came back
    was no longer a program, and pasting it into an editor could not work.

    Code is split out and put back verbatim. Only the prose between the fences
    is translated, which is the part a reader actually wants in their own
    language. Indentation, blank lines and the fences themselves survive
    because the segments are rejoined exactly as they were cut.
    """
    if not text or not target_lang or target_lang == "auto":
        return text
    try:
        translator = GoogleTranslator(source=source_lang or "auto", target=target_lang)
        parts = _CODE_SPAN.split(text)
        if len(parts) == 1:
            return _translate_segment(translator, text)
        # split() with one capturing group yields prose at even indices and the
        # code spans it captured at odd ones.
        return "".join(
            part if index % 2 else _translate_segment(translator, part)
            for index, part in enumerate(parts)
        )
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        return text
