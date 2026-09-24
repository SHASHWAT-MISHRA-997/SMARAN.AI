"""Score a trained wake model on voices it never heard (Windows SAPI).

Speaks wake phrases and ordinary / near-miss sentences with each installed
Windows voice at three speeds, adds room noise at two levels, and runs the
same openWakeWord pipeline the app uses (backend/app/pc_wake.py) with the
given model. Prints the hit rate on wake phrases and every false alarm.

    python eval_sapi.py path/to/hey_smaran.onnx [threshold]

Windows only (System.Speech). Needs numpy, onnxruntime, soundfile.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

MODELS = Path(__file__).resolve().parents[3] / "backend" / "app" / "wake_models"

WAKE = ["Hey Smaran", "Hey Smaran.", "Hey, Smaran!", "Hey Smuh run", "Hey Smarun", "Hey Smarn"]
OTHER = [
    "Hey Sarah", "Hey summer", "Hey Siri", "Hey Google", "Hey Myra", "Hey Jarvis", "Hey Amarya",
    "Hey man", "Hey Karan", "Hey Sharan", "Smart one", "Samaran", "Hey, how are you",
    "Play some music on Spotify", "What time is it", "Open the calculator",
    "The weather is nice today", "I will call you tomorrow morning",
    "Remind me to buy milk", "Summer vacation starts next week",
    "She gave a long sermon", "Turn off the lights in the kitchen",
    "Can you send the report by evening", "Let us meet at the station",
]
RATES = [-2, 0, 2]


def speak(texts, folder: Path):
    """Write one 16 kHz mono WAV per (voice, rate, text) with PowerShell SAPI."""
    lines = "\n".join(t.replace("'", "''") for t in texts)
    script = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$texts = @'
{lines}
'@ -split "`n"
$i = 0
foreach ($v in $s.GetInstalledVoices()) {{
  $s.SelectVoice($v.VoiceInfo.Name)
  foreach ($r in @({",".join(map(str, RATES))})) {{
    $s.Rate = $r
    for ($t = 0; $t -lt $texts.Length; $t++) {{
      $s.SetOutputToWaveFile((Join-Path '{folder}' ("{{0:D5}}_{{1}}.wav" -f $i, $t)), $fmt)
      $s.Speak($texts[$t].Trim())
      $i++
    }}
  }}
}}
$s.SetOutputToNull()
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)
    return sorted(folder.glob("*.wav"))


class Scorer:
    def __init__(self, model: str):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.mel = ort.InferenceSession(str(MODELS / "melspectrogram.onnx"), opts)
        self.emb = ort.InferenceSession(str(MODELS / "embedding_model.onnx"), opts)
        self.wake = ort.InferenceSession(model, opts)

    def peak(self, audio: np.ndarray) -> float:
        """Stream 80 ms chunks exactly like pc_wake.Detector; return the top score."""
        pad = np.zeros(16000, dtype=np.float32)
        audio = np.concatenate([pad, audio.astype(np.float32), pad])
        buf = np.zeros(0, dtype=np.float32)
        mel = np.ones((76, 32), dtype=np.float32)
        emb = np.zeros((0, 96), dtype=np.float32)
        best = 0.0
        for i in range(0, len(audio) - 1280 + 1, 1280):
            buf = np.concatenate([buf, audio[i:i + 1280]])[-1760:]
            if len(buf) < 1760:
                continue
            spec = np.squeeze(self.mel.run(None, {"input": buf[None, :]})[0]) / 10.0 + 2.0
            mel = np.vstack([mel, spec])[-76:]
            vec = self.emb.run(None, {"input_1": mel[None, :, :, None]})[0].reshape(1, 96)
            emb = np.vstack([emb, vec])[-16:]
            if len(emb) < 16:
                continue
            name = self.wake.get_inputs()[0].name
            best = max(best, float(self.wake.run(None, {name: emb[None]})[0][0][0]))
        return best


def with_noise(clean: np.ndarray, snr_db: float, rng) -> np.ndarray:
    if snr_db is None:
        return clean
    noise = rng.normal(0, 1, len(clean)).astype(np.float32)
    # Pinkish: smooth white noise so it sounds like a room, not hiss.
    noise = np.convolve(noise, np.ones(8) / 8, mode="same")
    p_sig = np.mean(clean ** 2) + 1e-9
    p_noise = np.mean(noise ** 2) + 1e-9
    return clean + noise * np.sqrt(p_sig / (p_noise * 10 ** (snr_db / 10)))


def main():
    model = sys.argv[1]
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    scorer = Scorer(model)
    rng = np.random.default_rng(7)
    texts = WAKE + OTHER
    with tempfile.TemporaryDirectory() as tmp:
        files = speak(texts, Path(tmp))
        hits = total_wake = false = total_other = 0
        misses, alarms = [], []
        for f in files:
            idx = int(f.stem.split("_")[1])
            clean, _ = sf.read(f, dtype="float32")
            clean = clean * 32767          # the models take int16-scaled floats
            for snr in (None, 10):
                score = scorer.peak(with_noise(clean, snr, rng))
                if idx < len(WAKE):
                    total_wake += 1
                    if score >= threshold:
                        hits += 1
                    else:
                        misses.append((texts[idx], f.stem, snr, round(score, 2)))
                else:
                    total_other += 1
                    if score >= threshold:
                        false += 1
                        alarms.append((texts[idx], f.stem, snr, round(score, 2)))
    print(f"threshold {threshold}")
    print(f"wake phrases detected: {hits}/{total_wake} ({100 * hits / total_wake:.0f}%)")
    print(f"false alarms: {false}/{total_other}")
    for a in alarms:
        print("  FALSE ALARM", a)
    for m in misses[:20]:
        print("  missed", m)


if __name__ == "__main__":
    main()
