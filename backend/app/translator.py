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
    try:
        translator = GoogleTranslator(source="auto", target="en")
        detected = translator.detect(text)
        if detected and detected.lang:
            return detected.lang.lower()
    except Exception as e:
        logger.error(f"Language detection failed: {e}")
    return None


def translate_text(text: str, target_lang: str, source_lang: Optional[str] = None) -> str:
    if not text or not target_lang or target_lang == "auto":
        return text
    try:
        translator = GoogleTranslator(source=source_lang or "auto", target=target_lang)
        return translator.translate(text)
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        return text
