"""The computer's wake words: real speech audio through the real socket."""
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import pc_wake
from app.main import app

AUDIO = Path(__file__).parent / "audio"


def _pcm(name: str) -> bytes:
    with wave.open(str(AUDIO / name)) as w:
        assert w.getframerate() == 16000 and w.getsampwidth() == 2 and w.getnchannels() == 1
        speech = w.readframes(w.getnframes())
    silence = np.zeros(16000, dtype=np.int16).tobytes()
    return silence + speech + silence


pytestmark = pytest.mark.skipif(not pc_wake.available(), reason="onnxruntime or models missing")


def _stream(ws, pcm: bytes):
    """Send in 4096-sample frames, the size the page sends."""
    for i in range(0, len(pcm), 8192):
        ws.send_bytes(pcm[i:i + 8192])


def test_hey_jarvis_wakes_it_over_the_socket():
    # As this computer: the socket refuses callers that are not local or paired.
    client = TestClient(app, client=("127.0.0.1", 50123))
    with client.websocket_connect("/ws/wake") as ws:
        # First the detector says it is live, so the page can stop its
        # transcription fallback.
        assert ws.receive_json() == {"ready": True, "phrases": ["smaran", "jarvis"]}
        _stream(ws, _pcm("hey_jarvis.wav"))
        message = ws.receive_json()
    assert message["wake"] == "jarvis" and message["score"] >= pc_wake.THRESHOLD


def test_hey_smaran_wakes_it_over_the_socket():
    # SMARAN's own model (tools/wakeword/train), on a voice it was not trained on.
    client = TestClient(app, client=("127.0.0.1", 50125))
    with client.websocket_connect("/ws/wake") as ws:
        assert ws.receive_json()["ready"] is True
        _stream(ws, _pcm("hey_smaran.wav"))
        message = ws.receive_json()
    assert message["wake"] == "smaran", message


def test_both_models_are_loaded():
    assert set(pc_wake.names()) == {"jarvis", "smaran"}


# "Hey Sarah" and "Hey Siri" woke the first "Hey SMARAN" model; they must not.
@pytest.mark.parametrize("name", ["travis.wav", "weather.wav", "mirror.wav", "hey_sarah.wav", "hey_siri.wav"])
def test_ordinary_speech_does_not(name):
    detector = pc_wake.Detector()
    assert detector.heard(_pcm(name)) is None, (name, detector.scores(b""))


def test_a_detector_that_has_woken_starts_afresh():
    detector = pc_wake.Detector()
    assert detector.feed(_pcm("hey_jarvis.wav")) >= pc_wake.THRESHOLD
    detector.reset()
    assert (detector.feed(_pcm("weather.wav")) or 0.0) < pc_wake.THRESHOLD


def test_a_stranger_on_the_network_is_refused():
    from starlette.websockets import WebSocketDisconnect
    client = TestClient(app, client=("192.168.1.77", 50124))
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/wake") as ws:
            ws.receive_json()
