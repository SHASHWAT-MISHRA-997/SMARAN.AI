"""Write down what the offline Vosk model hears in each owner recording, to
check the words are actually in the audio. Usage: transcribe_owner.py OWNER_DIR"""
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
from vosk import KaldiRecognizer, Model, SetLogLevel

ROOT = Path(__file__).resolve().parents[3]
ZIP = ROOT / "frontend" / "android" / ".vosk-cache" / "vosk-model-small-en-in-0.4.zip"
CACHE = ROOT / ".cache" / "vosk"


def model_dir():
    target = CACHE / "vosk-model-small-en-in-0.4"
    if not target.exists():
        with zipfile.ZipFile(ZIP) as z:
            z.extractall(CACHE)
    return target


def main(owner):
    SetLogLevel(-1)
    model = Model(str(model_dir()))
    for kind in ("pos", "neg"):
        for f in sorted((Path(owner) / kind).glob("*.wav")):
            a, sr = sf.read(f, dtype="float32")
            peak = max(float(np.abs(a).max()), 1e-4)
            pcm = (np.clip(a / peak * 0.5, -1, 1) * 32767).astype("<i2").tobytes()
            rec = KaldiRecognizer(model, sr)
            rec.AcceptWaveform(pcm)
            print(kind, f.stem, repr(json.loads(rec.FinalResult()).get("text", "")))


if __name__ == "__main__":
    main(sys.argv[1])
