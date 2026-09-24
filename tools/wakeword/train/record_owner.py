"""Record the owner's voice for wake-word training: a window says what to say.

    python record_owner.py OUT_DIR            # the PC's microphone
    python record_owner.py OUT_DIR --phone    # the phone's, over USB (scrcpy)

With --phone, scrcpy records the whole session from the phone's microphone -
the one the wake word actually listens on - and each clip is cut out
afterwards by the time its prompt said SPEAK NOW. Set SCRCPY to scrcpy.exe.

Writes 16 kHz mono WAVs to OUT_DIR/pos (wake phrases) and OUT_DIR/neg
(ordinary speech that must NOT wake it), plus OUT_DIR/room.wav (a stretch of
the room with nobody speaking). Recordings stay on this computer; OUT_DIR is
meant to be under .cache/, which git ignores.
"""
import os
import subprocess
import sys
import threading
import time
import tkinter as tk
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

RATE = 16000
CLIP = 2.6          # seconds per wake phrase
SENTENCE = 3.6      # seconds per ordinary sentence

WAKE = [
    ("Hey SMARAN", "normally"),
    ("Hey SMARAN", "a little faster"),
    ("Hey SMARAN", "a little louder"),
    ("Hey SMARAN", "softly, as if across the room"),
    ("Hey SMARAN", "slowly"),
    ("Hey, SMARAN", "with a short pause after Hey"),
]
ROUNDS = 5          # 6 styles x 5 = 30 wake clips

SENTENCES = [
    "Hey Siri", "Hey Sarah", "Hey Simran", "Hey Suman", "Hey Jarvis", "Hey Myra",
    "SMARAN is my app", "Summer vacation starts next week",
    "Smart phone ka charger kahan hai", "Play some music on Spotify",
    "What time is it", "Kal subah mujhe yaad dilana",
    "Aaj mausam kaisa hai", "Send the report by evening", "Hey, how are you",
]


class Recorder:
    def __init__(self, out: Path, phone: bool = False):
        self.out = out
        self.phone = phone
        self.marks = []          # (name, start seconds into the session, length)
        (out / "pos").mkdir(parents=True, exist_ok=True)
        (out / "neg").mkdir(parents=True, exist_ok=True)
        self.plan = [("room", "Stay quiet for 8 seconds", "(recording the room, nobody speaking)", 8.0)]
        n = 0
        for r in range(ROUNDS):
            for text, how in WAKE:
                self.plan.append((f"pos/{n:03d}", text, how, CLIP))
                n += 1
        for i, s in enumerate(SENTENCES):
            self.plan.append((f"neg/{i:03d}", s, "say this normally", SENTENCE))

        self.root = tk.Tk()
        self.root.title("SMARAN - voice recording")
        self.root.configure(bg="#0b0a0d")
        self.root.geometry("900x520")
        self.root.attributes("-topmost", True)
        self.step = tk.Label(self.root, fg="#9ca3af", bg="#0b0a0d", font=("Segoe UI", 16))
        self.say = tk.Label(self.root, fg="#ffffff", bg="#0b0a0d", font=("Segoe UI", 54, "bold"), wraplength=860)
        self.how = tk.Label(self.root, fg="#fca5a5", bg="#0b0a0d", font=("Segoe UI", 20))
        self.state = tk.Label(self.root, fg="#4ade80", bg="#0b0a0d", font=("Segoe UI", 28, "bold"))
        for w, pad in ((self.step, 24), (self.say, 30), (self.how, 6), (self.state, 30)):
            w.pack(pady=pad)
        self.index = 0
        if phone:
            # scrcpy stops itself at this limit, which finalises the WAV cleanly
            # (killing it on Windows leaves the header unwritten). Each prompt
            # takes about 1.7 s beyond its recording time.
            total = sum(p[3] + 1.8 for p in self.plan) + 12
            self.session = out / "phone_session.wav"
            self.scrcpy = subprocess.Popen(
                [os.environ["SCRCPY"], "--no-video", "--no-window", "--no-audio-playback",
                 "--audio-source=mic", "--audio-codec=raw", f"--record={self.session}",
                 f"--time-limit={int(total)}"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in self.scrcpy.stdout:           # wait until audio is flowing
                if "Recording started" in line:
                    break
            self.t0 = time.monotonic()
            threading.Thread(target=self.scrcpy.stdout.read, daemon=True).start()
        self.root.after(1500, self.next)

    def next(self):
        if self.index >= len(self.plan):
            self.say.config(text="Done - thank you!")
            self.how.config(text="You can close this window.")
            self.state.config(text="")
            self.step.config(text=f"{len(self.plan)} recordings saved")
            print("DONE", flush=True)
            if self.phone:
                import json
                (self.out / "marks.json").write_text(json.dumps(self.marks))
                self.how.config(text="Finishing the recording, a few seconds...")
            self.root.after(4000, self.root.destroy)
            return
        name, text, how, secs = self.plan[self.index]
        self.step.config(text=f"{self.index + 1} / {len(self.plan)}")
        self.say.config(text=text)
        self.how.config(text=how)
        self.state.config(text="Get ready...", fg="#fbbf24")
        self.root.after(1200, lambda: self.record(name, secs))

    def record(self, name, secs):
        self.state.config(text="SPEAK NOW", fg="#4ade80")
        if self.phone:
            self.marks.append((name, time.monotonic() - self.t0, secs))
            self.root.after(int(secs * 1000), self.done)
            return

        def work():
            audio = sd.rec(int(secs * RATE), samplerate=RATE, channels=1, dtype="int16")
            sd.wait()
            sf.write(self.out / f"{name}.wav", audio[:, 0], RATE)
            self.root.after(0, self.done)

        threading.Thread(target=work, daemon=True).start()

    def done(self):
        self.state.config(text="OK", fg="#9ca3af")
        self.index += 1
        self.root.after(500, self.next)


def cut_phone_session(out: Path) -> None:
    """Slice phone_session.wav into the clips by marks.json, as 16 kHz mono."""
    import json
    from math import gcd

    from scipy.signal import resample_poly

    audio, sr = sf.read(out / "phone_session.wav", dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    g = gcd(RATE, sr)
    audio = resample_poly(audio, RATE // g, sr // g).astype(np.float32)
    for name, start, secs in json.loads((out / "marks.json").read_text()):
        # A little before the prompt (people start early) and after (they finish late).
        a = int(max(0.0, start - 0.3) * RATE)
        b = int((start + secs + 0.6) * RATE)
        clip = audio[a:b]
        if len(clip):
            sf.write(out / f"{name}.wav", (np.clip(clip, -1, 1) * 32767).astype(np.int16), RATE)


if __name__ == "__main__":
    target = Path(sys.argv[1])
    use_phone = "--phone" in sys.argv
    recorder = Recorder(target, phone=use_phone)
    recorder.root.mainloop()
    if use_phone:
        recorder.scrcpy.wait()     # ends at its time limit, WAV complete
        cut_phone_session(target)
        print("CUT", flush=True)
