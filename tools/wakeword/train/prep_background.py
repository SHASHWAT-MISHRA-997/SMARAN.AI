"""Turn an AudioSet parquet shard into 16 kHz mono WAV clips for background
noise during augmentation. Usage: prep_background.py SHARD.parquet OUT_DIR
"""
import io
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from scipy.signal import resample_poly


def main(shard: str, out: str) -> None:
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    table = pq.ParquetFile(shard)
    written = 0
    for batch in table.iter_batches(batch_size=64):
        rows = batch.to_pylist()
        for row in rows:
            audio = row.get("audio") or {}
            data = audio.get("bytes") if isinstance(audio, dict) else None
            if not data:
                continue
            try:
                wav, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
            except Exception:
                continue
            wav = wav.mean(axis=1)
            if sr != 16000:
                wav = resample_poly(wav, 16000, sr).astype(np.float32)
            if len(wav) < 16000:
                continue
            peak = float(np.max(np.abs(wav))) or 1.0
            sf.write(out_dir / f"as_{written:05d}.wav", (wav / peak * 0.9 * 32767).astype(np.int16), 16000)
            written += 1
    print(f"{written} background clips in {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
