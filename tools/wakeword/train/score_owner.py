"""Score the owner's recordings with a wake model: level over the room, where the
loudest moment is, and the model's peak score raw and loudness-normalised.

    python score_owner.py MODEL.onnx OWNER_DIR
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
import eval_sapi  # noqa: E402


def level(a):
    frames = a[: len(a) // 320 * 320].reshape(-1, 320)
    return np.sqrt((frames ** 2).mean(1))


def main(model, owner):
    owner = Path(owner)
    scorer = eval_sapi.Scorer(model)
    room, _ = sf.read(owner / "room.wav", dtype="float32")
    room_rms = np.sqrt(np.mean(room ** 2))
    for kind in ("pos", "neg"):
        print(kind, "  file      dB  peak@ms  raw   normalised")
        hits = 0
        files = sorted((owner / kind).glob("*.wav"))
        for f in files:
            a, _ = sf.read(f, dtype="float32")
            e = level(a)
            snr = 20 * np.log10(e.max() / room_rms)
            raw = scorer.peak(a * 32767)
            norm = scorer.peak(np.clip(a / max(np.abs(a).max(), 1e-4) * 0.5, -1, 1) * 32767)
            hits += max(raw, norm) >= 0.5
            print(f"  {f.stem}  {snr:5.1f}  {int(np.argmax(e)) * 20:6d}  {raw:4.2f}  {norm:4.2f}")
        print(f"  {kind}: {hits}/{len(files)} at or above 0.5\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
