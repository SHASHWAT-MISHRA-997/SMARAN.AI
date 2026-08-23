from deep_translator import GoogleTranslator
from typing import Optional
import logging

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


def translate_text(text: str, target_lang: str, source_lang: Optional[str] = None) -> str:
    if not text or not target_lang or target_lang == "auto":
        return text
    try:
        translator = GoogleTranslator(source=source_lang or "auto", target=target_lang)
        return translator.translate(text)
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        return text
