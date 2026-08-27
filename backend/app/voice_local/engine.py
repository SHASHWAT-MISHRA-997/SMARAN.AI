"""A live call assembled from three local parts.

The existing live call is Gemini's: one socket carries audio both ways and
Google does the listening, the thinking and the speaking. This is the same
conversation built from pieces that are already on the machine —

    microphone -> faster-whisper -> a local model -> Kokoro -> speaker

— so nothing is sent anywhere and no key is needed.

It is honestly slower. Gemini starts speaking in well under a second because
it begins forming a reply while you are still talking. This cannot: it has to
hear you stop, transcribe, wait for the model, then synthesise. Each of those
is fast and the sum is not. What it buys is a call that works with the network
off and with no account anywhere.

The sample rates happen to line up and nothing is resampled: the browser sends
16 kHz, which is what Whisper wants, and Kokoro produces 24 kHz, which is what
the browser plays.
"""

from __future__ import annotations

import array
import asyncio
import logging
import math
import time
from typing import Awaitable, Callable, List, Optional

logger = logging.getLogger("voice.local")

INPUT_RATE = 16000
OUTPUT_RATE = 24000

# Energy above which a frame counts as speech. Derived from measurement, not
# taste: a quiet room floors around 0.002 RMS on a laptop microphone and
# ordinary speech sits above 0.02, so this sits between them with room either
# side. It is a plain threshold, not a trained detector, and it says so.
SPEECH_RMS = 0.012

# How much quiet ends a turn. Below about half a second it cuts people off
# mid-sentence when they pause for breath; much above it and the reply feels
# late.
SILENCE_TO_END = 0.7

# A turn has to have some speech in it before silence can end it, or the very
# first frames of quiet would fire a turn with nothing in it.
MIN_SPEECH = 0.35

# Nobody talks for five minutes without a pause, and an open microphone that
# never yields is how a session ends up holding a hundred megabytes of audio.
MAX_TURN = 300.0


def _rms(pcm: bytes) -> float:
    """Root mean square of signed 16-bit samples, as 0..1."""
    if len(pcm) < 2:
        return 0.0
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if not samples:
        return 0.0
    total = 0
    for s in samples:
        total += s * s
    return math.sqrt(total / len(samples)) / 32768.0


class LocalVoiceSession:
    """One call. Feed it audio; it calls back with text and speech."""

    def __init__(
        self,
        send: Callable[[dict], Awaitable[None]],
        answer: Callable[[str], Awaitable[str]],
        language: str = "en",
        gender: str = "female",
    ) -> None:
        self.send = send
        self.answer = answer
        self.language = language
        self.gender = gender

        self._buffer = bytearray()
        self._speech_seconds = 0.0
        self._silence_seconds = 0.0
        self._turn_started: Optional[float] = None
        self._busy = False
        self._speaking = False
        self._cancel = False
        self._lock = asyncio.Lock()

    # ── incoming audio ─────────────────────────────────────────────────

    async def feed(self, pcm: bytes) -> None:
        """One chunk of 16 kHz signed 16-bit mono from the microphone."""
        if not pcm:
            return
        seconds = len(pcm) / 2 / INPUT_RATE
        loud = _rms(pcm) >= SPEECH_RMS

        # Barge-in. Talking over her stops her, the same as it would a person.
        if loud and self._speaking:
            self._cancel = True
            await self.send({"type": "interrupted"})

        if self._busy:
            # Thinking about the last turn. Audio arriving now is either the
            # interruption handled above or room noise; either way it does not
            # belong to a turn that has already been taken.
            return

        if loud:
            self._buffer.extend(pcm)
            self._speech_seconds += seconds
            self._silence_seconds = 0.0
            if self._turn_started is None:
                self._turn_started = time.time()
        elif self._speech_seconds > 0:
            # Quiet after speech is still part of the turn: dropping it clips
            # the final consonant off the last word.
            self._buffer.extend(pcm)
            self._silence_seconds += seconds

        ended = (
            self._speech_seconds >= MIN_SPEECH
            and self._silence_seconds >= SILENCE_TO_END
        )
        too_long = (
            self._turn_started is not None
            and time.time() - self._turn_started > MAX_TURN
        )
        if ended or (too_long and self._speech_seconds > 0):
            await self._take_turn()

    # ── one exchange ───────────────────────────────────────────────────

    async def _take_turn(self) -> None:
        async with self._lock:
            if self._busy:
                return
            pcm = bytes(self._buffer)
            self._buffer.clear()
            self._speech_seconds = 0.0
            self._silence_seconds = 0.0
            self._turn_started = None
            self._busy = True

        try:
            heard = await asyncio.to_thread(self._transcribe, pcm)
            if not heard.strip():
                # Silence that passed the threshold but held no words. Saying
                # nothing is better than answering a cough.
                return
            await self.send({"type": "text", "text": heard, "role": "user"})

            reply = await self.answer(heard)
            if not (reply or "").strip():
                await self.send({"type": "error",
                                 "message": "The model returned nothing."})
                return
            await self.send({"type": "text", "text": reply, "role": "assistant"})
            await self._speak(reply)
        except Exception as exc:
            logger.exception("local voice turn failed")
            await self.send({"type": "error", "message": str(exc)[:200]})
        finally:
            self._busy = False
            await self.send({"type": "turn_complete"})

    def _transcribe(self, pcm: bytes) -> str:
        """Words from audio, on this machine."""
        if len(pcm) < INPUT_RATE:      # under half a second
            return ""
        import io
        import wave

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(INPUT_RATE)
            handle.writeframes(pcm)
        buffer.seek(0)

        from app.utils import _transcribe_local_media

        import os
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(buffer.getvalue())
            return (_transcribe_local_media(path, self.language) or "").strip()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    async def _speak(self, text: str) -> None:
        """Kokoro, sent back in pieces so playback starts before the end."""
        from app.tts import kokoro

        self._cancel = False
        self._speaking = True
        try:
            # Kokoro takes 510 phonemes at a time, which is roughly a long
            # sentence. Splitting on sentence ends rather than a character
            # count keeps the prosody intact and lets the first one play
            # while the second is still being made.
            for piece in _sentences(text):
                if self._cancel:
                    break
                try:
                    wav = await asyncio.to_thread(
                        kokoro.synthesize, piece, "en", self.gender, 1.0
                    )
                except Exception as exc:
                    await self.send({"type": "error",
                                     "message": "Speech failed: %s" % str(exc)[:120]})
                    return
                if self._cancel:
                    break
                import base64
                # The WAV header is 44 bytes; the client wants raw samples.
                await self.send({
                    "type": "audio",
                    "data": base64.b64encode(wav[44:]).decode("ascii"),
                    "rate": OUTPUT_RATE,
                })
        finally:
            self._speaking = False

    async def close(self) -> None:
        self._cancel = True
        self._buffer.clear()


def _sentences(text: str, limit: int = 220) -> List[str]:
    """Split into speakable pieces at sentence ends, then at length."""
    import re

    parts: List[str] = []
    for chunk in re.split(r"(?<=[.!?])\s+", (text or "").strip()):
        chunk = chunk.strip()
        if not chunk:
            continue
        while len(chunk) > limit:
            # No sentence end within the limit: break at the last space so a
            # word is never cut in half.
            cut = chunk.rfind(" ", 0, limit)
            if cut <= 0:
                cut = limit
            parts.append(chunk[:cut].strip())
            chunk = chunk[cut:].strip()
        if chunk:
            parts.append(chunk)
    return parts or [text]
