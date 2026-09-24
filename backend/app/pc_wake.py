"""The wake words on the computer, by openWakeWord - the same detector as the phone.

The page streams the microphone here as 16 kHz, 16-bit mono PCM over a
WebSocket, and this answers {"wake": "<name>"} when it hears a wake phrase.
It runs while SMARAN is open or minimised; nothing is recorded or kept - each
80 ms chunk is scored and dropped.

One audio front end (mel spectrogram, then speech embedding) feeds every wake
model, so a second phrase costs one small extra model per chunk:

- "hey jarvis": openWakeWord's model. On test audio it scored 1.00, with
  speech mixed in underneath; no ordinary sentence scored above 0.48.
- "hey smaran": trained for SMARAN (tools/wakeword/train), loaded when
  app/wake_models/hey_smaran.onnx is present.

Licences are in app/wake_models/NOTICE.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

MODELS = Path(__file__).resolve().parent / "wake_models"
CHUNK = 1280            # 80 ms at 16 kHz
CONTEXT = CHUNK + 480   # the mel model needs three frames of overlap

# (name, file, threshold). A model whose file is missing is simply not loaded.
WAKE_MODELS = (
    ("jarvis", "hey_jarvis_v0.1.onnx", 0.6),
    ("smaran", "hey_smaran.onnx", 0.5),
)
THRESHOLD = WAKE_MODELS[0][2]   # "hey jarvis", kept for callers that ask

_sessions = None


def _load():
    """(mel, embedding, {name: (session, threshold)}), loaded once; None if unavailable."""
    global _sessions
    if _sessions is None:
        try:
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1

            def session(name: str):
                return ort.InferenceSession(str(MODELS / name), options, providers=["CPUExecutionProvider"])

            wakes = {
                name: (session(file), threshold)
                for name, file, threshold in WAKE_MODELS
                if (MODELS / file).is_file()
            }
            if not wakes:
                raise FileNotFoundError("no wake model in " + str(MODELS))
            _sessions = (session("melspectrogram.onnx"), session("embedding_model.onnx"), wakes)
        except Exception as exc:  # models missing or onnxruntime absent
            log.warning("wake word unavailable: %s", exc)
            _sessions = False
    return _sessions or None


def available() -> bool:
    return _load() is not None


def names() -> Tuple[str, ...]:
    sessions = _load()
    return tuple(sessions[2]) if sessions else ()


class Detector:
    """One listener's rolling state. Feed it PCM; it says when it hears a phrase."""

    def __init__(self) -> None:
        self._pending = np.zeros(0, dtype=np.int16)
        self.reset()

    def reset(self) -> None:
        self._audio = np.zeros(0, dtype=np.float32)
        self._mel = np.ones((76, 32), dtype=np.float32)
        self._emb = np.zeros((0, 96), dtype=np.float32)

    def scores(self, pcm: bytes) -> Dict[str, float]:
        """Add little-endian int16 samples. Returns each model's best score over the
        full chunks just completed (empty until there is enough audio)."""
        sessions = _load()
        if sessions is None:
            return {}
        mel_s, emb_s, wakes = sessions
        samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2")
        self._pending = np.concatenate([self._pending, samples])
        best: Dict[str, float] = {}
        while len(self._pending) >= CHUNK:
            chunk, self._pending = self._pending[:CHUNK], self._pending[CHUNK:]
            self._audio = np.concatenate([self._audio, chunk.astype(np.float32)])[-CONTEXT:]
            if len(self._audio) < CONTEXT:
                continue
            spec = mel_s.run(None, {"input": self._audio[None, :]})[0]
            spec = np.squeeze(spec) / 10.0 + 2.0          # openWakeWord's own transform
            self._mel = np.vstack([self._mel, spec])[-76:]
            vector = emb_s.run(None, {"input_1": self._mel[None, :, :, None]})[0].reshape(1, 96)
            self._emb = np.vstack([self._emb, vector])[-16:]
            if len(self._emb) < 16:
                continue
            for name, (wake_s, _) in wakes.items():
                score = float(wake_s.run(None, {wake_s.get_inputs()[0].name: self._emb[None, :, :]})[0][0][0])
                best[name] = max(best.get(name, 0.0), score)
        return best

    def heard(self, pcm: bytes) -> Optional[Tuple[str, float]]:
        """Feed PCM; (name, score) of the phrase that crossed its threshold by the
        widest margin, or None."""
        sessions = _load()
        if sessions is None:
            return None
        wakes = sessions[2]
        over = [
            (score - wakes[name][1], name, score)
            for name, score in self.scores(pcm).items()
            if score >= wakes[name][1]
        ]
        if not over:
            return None
        _, name, score = max(over)
        return name, score

    def feed(self, pcm: bytes) -> Optional[float]:
        """The "hey jarvis" score alone, as before: best over full chunks, or None."""
        return self.scores(pcm).get("jarvis")
