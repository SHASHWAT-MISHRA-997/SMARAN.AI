# Tuning the phone's wake phrases

`WakeWord.java` recognises "Hey SMARAN / Amarya / Myra / Jarvis" from what the
offline model (vosk-model-small-en-in-0.4) writes down. The model has no words
for SMARAN or Amarya, so the lists there are the spellings it produces instead.

To re-tune (Windows, needs the SAPI voices and `pip install vosk`):

1. Unzip the model next to these scripts as `vosk-model-small-en-in-0.4/`
   (the Android build caches the zip in `frontend/android/.vosk-cache/`).
2. `python probe.py "Hey Smaran" "Hey Amarya"` shows what the model hears.
3. `python evaluate.py` reports hits on wake phrases and false alarms on
   ordinary sentences. Keep false alarms at zero; copy any change to
   `NAMES`/`GREETING` into WakeWord.java and add the transcript to WakeWordTest.

Synthetic US voices are a stand-in. Transcripts from real Indian-accented
speech are the better source - add them to WakeWordTest as they are found.
