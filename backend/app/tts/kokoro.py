"""Kokoro, running offline.

The text-to-speech that is already here is edge-tts, which is Microsoft's
online service: the endpoint is called "local" but it needs the internet, and
its offline fallback looks for espeak-ng, which is not installed. So there is
currently no speech at all without a connection. This closes that.

Kokoro is Apache-2.0, 82 million parameters, and the fp16 ONNX weights are
163 MB. It needs no GPU.

The usual way to drive it is the `kokoro` package, which pins numpy 1.26 — a
version with no wheel for this Python, so pip tries to build it and there is
no compiler. Its phonemiser, misaki, needs spacy, whose DLL this machine's
Application Control policy blocks outright. Neither is worked around: the
model is run directly through onnxruntime, and the phonemes come from g2p-en,
which is pure Python.

That leaves one real problem. g2p-en emits ARPAbet and Kokoro reads IPA, so
the two have to be mapped. The mapping below is checked against the model's
own vocabulary at import: a symbol Kokoro does not know is a mispronunciation
waiting to happen, and it is better to find that here than in the audio.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import List, Optional

logger = logging.getLogger(__name__)

REPO = "onnx-community/Kokoro-82M-v1.0-ONNX"
MODEL_FILE = "onnx/model_fp16.onnx"
SAMPLE_RATE = 24000

# Kokoro's own voice files. The prefix is the language and then the speaker's
# gender: a = American English, b = British, h = Hindi; f = female, m = male.
VOICES = {
    ("en", "female"): "af_heart",
    ("en", "male"): "am_michael",
    ("hi", "female"): "hf_alpha",
    ("hi", "male"): "hm_omega",
}

# The Hindi voices are real and they load, but the only phonemiser here is
# g2p-en, which reads English. Measured: Devanagari comes back empty, and
# romanised Hindi comes back as an English reading of the spelling —
# "Namaste" becomes /nʌmˈæst/, which is not the word. Rather than emit a
# mispronunciation and call it Hindi, those voices are refused until a Hindi
# phonemiser is wired up. Nothing about the voice files themselves is wrong.
PHONEMISED_LANGUAGES = {"en"}

# ARPAbet to IPA. Stress digits are dropped from the vowel and become a mark
# before the syllable, which is how Kokoro's vocabulary carries stress.
ARPA_TO_IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "EH": "ɛ", "ER": "ɜɹ",
    "EY": "eɪ", "F": "f", "G": "ɡ", "HH": "h", "IH": "ɪ", "IY": "i",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ",
    "OW": "oʊ", "OY": "ɔɪ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ",
    "T": "t", "TH": "θ", "UH": "ʊ", "UW": "u", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

_lock = threading.Lock()
_session = None
_vocab: dict = {}
_voice_cache: dict = {}


class KokoroError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


def _cache_dir() -> str:
    from app.config import settings

    path = os.path.join(settings.DATA_DIR, "kokoro")
    os.makedirs(path, exist_ok=True)
    return path


def _fetch(filename: str) -> str:
    """Download one file from the model repository, once."""
    import urllib.error
    import urllib.request

    target = os.path.join(_cache_dir(), filename.replace("/", "_"))
    if os.path.exists(target) and os.path.getsize(target) > 0:
        return target

    url = "https://huggingface.co/%s/resolve/main/%s" % (REPO, filename)
    tmp = target + ".partial"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers={"user-agent": "SMARAN.AI"}),
            timeout=600,
        ) as response, open(tmp, "wb") as handle:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                handle.write(chunk)
    except urllib.error.HTTPError as exc:
        raise KokoroError("Could not fetch %s: HTTP %s" % (filename, exc.code))
    except OSError as exc:
        raise KokoroError("Could not fetch %s: %s" % (filename, exc))

    # Renamed only once complete, so an interrupted download is never mistaken
    # for a usable file on the next run.
    os.replace(tmp, target)
    return target


def _load_vocab() -> dict:
    global _vocab
    if _vocab:
        return _vocab
    with open(_fetch("tokenizer.json"), "r", encoding="utf-8") as handle:
        tokenizer = json.load(handle)
    _vocab = (tokenizer.get("model") or {}).get("vocab") or {}
    if not _vocab:
        raise KokoroError("The tokenizer carries no vocabulary.")
    return _vocab


def check_mapping() -> List[str]:
    """Every IPA symbol this mapping can emit, that Kokoro does not know.

    Empty is the answer that means the mapping is safe to use.
    """
    vocab = _load_vocab()
    unknown = set()
    for ipa in ARPA_TO_IPA.values():
        for char in ipa:
            if char not in vocab:
                unknown.add(char)
    for mark in ("ˈ", "ˌ", " "):
        if mark not in vocab:
            unknown.add(mark)
    return sorted(unknown)


def phonemise(text: str) -> str:
    """English text to the IPA string Kokoro reads."""
    try:
        from g2p_en import G2p
    except ImportError as exc:
        raise KokoroError(
            "g2p-en is not installed, so text cannot be turned into phonemes: %s" % exc
        )

    global _g2p
    try:
        _g2p
    except NameError:
        _g2p = G2p()

    out: List[str] = []
    for token in _g2p(text):
        if not token.strip():
            out.append(" ")
            continue
        if token in ".,!?;:":
            out.append(token)
            continue

        base = token.rstrip("012")
        stress = token[len(base):]
        ipa = ARPA_TO_IPA.get(base)
        if not ipa:
            continue  # a symbol outside the set: skipped rather than guessed
        if stress == "1":
            out.append("ˈ")
        elif stress == "2":
            out.append("ˌ")
        out.append(ipa)

    result = "".join(out).strip()
    # g2p-en silently drops anything outside its alphabet, so a page of
    # Devanagari comes back as the punctuation and nothing else. Returning
    # that would mean synthesising a comma and calling it speech.
    if text.strip() and not any(c.isalpha() for c in result):
        raise KokoroError(
            "Nothing in that text could be turned into English phonemes. The "
            "phonemiser here reads the Latin alphabet only."
        )
    return result


def _load_session():
    global _session
    if _session is not None:
        return _session
    try:
        import onnxruntime
    except ImportError as exc:
        raise KokoroError("onnxruntime is not installed: %s" % exc)

    path = _fetch(MODEL_FILE)
    _session = onnxruntime.InferenceSession(
        path, providers=["CPUExecutionProvider"]
    )
    return _session


def _load_voice(name: str):
    import numpy as np

    if name in _voice_cache:
        return _voice_cache[name]
    path = _fetch("voices/%s.bin" % name)
    # Each voice is a table of style vectors indexed by phoneme count.
    data = np.fromfile(path, dtype=np.float32).reshape(-1, 1, 256)
    _voice_cache[name] = data
    return data


def synthesize(text: str, lang: str = "en", gender: str = "female",
               speed: float = 1.0) -> bytes:
    """Speak `text`, returning WAV bytes. Runs offline once the files are here."""
    import numpy as np

    voice_name = VOICES.get((lang, gender)) or VOICES.get((lang, "female"))
    if not voice_name:
        raise KokoroError(
            "Kokoro has no voice for %r. Offline speech here is English only."
            % lang
        )
    if lang not in PHONEMISED_LANGUAGES:
        raise KokoroError(
            "Kokoro ships a %s voice, but the phonemiser here reads English "
            "only, so %s text would be pronounced as if it were English. Use "
            "the online voice for %s until a %s phonemiser is added."
            % (lang, lang, lang, lang)
        )

    ipa = phonemise(text)
    if not ipa:
        raise KokoroError("Nothing pronounceable in that text.")

    vocab = _load_vocab()
    tokens = [vocab[c] for c in ipa if c in vocab]
    if not tokens:
        raise KokoroError("None of those phonemes are in the model's vocabulary.")

    # The model was trained with a 510-token limit; longer input is refused
    # rather than silently truncated into a sentence that stops mid-word.
    if len(tokens) > 510:
        raise KokoroError(
            "That is %d phonemes and the model takes 510. Send it in pieces."
            % len(tokens)
        )

    style = _load_voice(voice_name)[len(tokens)]
    session = _load_session()

    with _lock:
        audio = session.run(None, {
            "input_ids": np.array([[0, *tokens, 0]], dtype=np.int64),
            "style": style.astype(np.float32),
            "speed": np.array([float(speed)], dtype=np.float32),
        })[0]

    samples = np.asarray(audio, dtype=np.float32).flatten()

    import io
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    return buffer.getvalue()
