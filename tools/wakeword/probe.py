"""Synthesise phrases with the Windows voices and show what the Vosk model hears."""
import json
import os
import subprocess
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = Model(os.path.join(HERE, 'vosk-model-small-en-in-0.4'))
OUT = os.path.join(HERE, 'wav')
os.makedirs(OUT, exist_ok=True)


def synth(text, voice, rate=0):
    name = f"{voice.split()[1]}_{rate}_{abs(hash(text)) % 10**8}.wav"
    path = os.path.join(OUT, name)
    if not os.path.exists(path):
        ps = (
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            f"$s.SelectVoice('{voice}');$s.Rate={rate};"
            "$f=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,"
            "[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,"
            "[System.Speech.AudioFormat.AudioChannel]::Mono);"
            f"$s.SetOutputToWaveFile('{path}',$f);$s.Speak('{text}');$s.Dispose()"
        )
        subprocess.run(['powershell', '-NoProfile', '-Command', ps], check=True)
    return path


def hear(path, grammar=None):
    rec = KaldiRecognizer(MODEL, 16000, json.dumps(grammar)) if grammar else KaldiRecognizer(MODEL, 16000)
    with wave.open(path, 'rb') as w:
        while True:
            data = w.readframes(4000)
            if not data:
                break
            rec.AcceptWaveform(data)
    return json.loads(rec.FinalResult()).get('text', '')


VOICES = ['Microsoft David Desktop', 'Microsoft Zira Desktop']

if __name__ == '__main__':
    phrases = sys.argv[1:] or ['Hey Smaran', 'Hey Smuh run', 'Hey Amarya', 'Hey Myra', 'Hey Jarvis']
    for text in phrases:
        for voice in VOICES:
            print(f"{text!r:28} {voice.split()[1]:6} -> {hear(synth(text, voice))!r}")
