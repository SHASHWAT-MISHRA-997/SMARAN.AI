"""'Hey Jarvis' on the computer, by openWakeWord - the same detector as the phone.

The page streams the microphone here as 16 kHz, 16-bit mono PCM over a
WebSocket, and this answers {"wake": "jarvis"} when it hears the phrase. It
runs while SMARAN is open or minimised; nothing is recorded or kept - each
80 ms chunk is scored and dropped.

The models are openWakeWord's (app/wake_models, see NOTICE there). On test
audio "hey jarvis" scored 1.00, with speech mixed in underneath, and no
ordinary sentence scored above 0.48; the threshold is 0.6.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

MODELS = Path(__file__).resolve().parent / "wake_models"
CHUNK = 1280            # 80 ms at 16 kHz
CONTEXT = CHUNK + 480   # the mel model needs three frames of overlap
THRESHOLD = 0.6

_sessions = None


def _load():
    """The three ONNX sessions, loaded once; None if they cannot be."""
    global _sessions
    if _sessions is None:
        try:
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            _sessions = tuple(
                ort.InferenceSession(str(MODELS / name), options, providers=["CPUExecutionProvider"])
                for name in ("melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx")
            )
        except Exception as exc:  # models missing or onnxruntime absent
            log.warning("wake word unavailable: %s", exc)
            _sessions = False
    return _sessions or None


def available() -> bool:
    return _load() is not None


class Detector:
    """One listener's rolling state. Feed it PCM; it says when it hears the phrase."""

    def __init__(self) -> None:
        self._pending = np.zeros(0, dtype=np.int16)
        self.reset()

    def reset(self) -> None:
        self._audio = np.zeros(0, dtype=np.float32)
        self._mel = np.ones((76, 32), dtype=np.float32)
        self._emb = np.zeros((0, 96), dtype=np.float32)

    def feed(self, pcm: bytes) -> Optional[float]:
        """Add little-endian int16 samples. Returns the best score of any full chunk, or None."""
        sessions = _load()
        if sessions is None:
            return None
        mel_s, emb_s, wake_s = sessions
        samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2")
        self._pending = np.concatenate([self._pending, samples])
        best = None
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
            score = float(wake_s.run(None, {wake_s.get_inputs()[0].name: self._emb[None, :, :]})[0][0][0])
            best = score if best is None else max(best, score)
        return best
