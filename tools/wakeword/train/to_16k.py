"""Resample generated clips to 16 kHz in place.

piper-sample-generator 3.x writes the voice's native rate (22050 Hz for the
LibriTTS-R generator); the old version resampled for openWakeWord, whose
augmentation refuses anything but 16 kHz. Usage: to_16k.py DIR [DIR ...]
"""
import sys
from concurrent.futures import ProcessPoolExecutor
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly


def convert(path: str) -> bool:
    data, sr = sf.read(path, dtype="float32")
    if sr == 16000:
        return False
    if data.ndim > 1:
        data = data.mean(axis=1)
    g = gcd(16000, sr)
    out = resample_poly(data, 16000 // g, sr // g)
    sf.write(path, np.clip(out * 32767, -32768, 32767).astype(np.int16), 16000)
    return True


def main(dirs):
    files = [str(p) for d in dirs for p in Path(d).glob("*.wav")]
    with ProcessPoolExecutor() as pool:
        done = sum(pool.map(convert, files, chunksize=64))
    print(f"{done} of {len(files)} clips resampled to 16 kHz")


if __name__ == "__main__":
    main(sys.argv[1:])
