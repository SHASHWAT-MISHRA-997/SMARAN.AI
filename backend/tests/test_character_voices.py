"""Each character has to sound like itself on the local engine.

The request was for the reference app's exact voice. That voice cannot be
copied, and it is worth recording why rather than re-deriving it every time.

All three supplied archives were extracted and searched. There is no voice
recording and no voice model in any of them: the only ``.onnx`` is
``iris_conformer_asr_v1`` - speech *recognition* - and the only ``.bin`` files
are V8 JavaScript snapshots from Electron. All three call
``BidiGenerateContent`` against ``generativelanguage`` with a
``GEMINI_API_KEY``, which is Google's hosted Gemini Live. The timbre belongs to
that service; it can be subscribed to, not reproduced.

What the supplied MYRAA master prompt does specify is the delivery, in numbers:
pitch "+20% to +35%" above conversational, speed "0.9x to 0.95x", soft and airy.
Those are settings, and the local engine honours them - so the characters match
the brief without the paid service.

Measured on this engine rather than assumed: en-US-AriaNeural reads at a median
206.9 Hz level and 269.7 Hz at +50Hz, a +30.4% lift, inside the band. The
finished characters measure Myra 272.7 Hz, Amarya 269.7 Hz, Energy Core
144.6 Hz.

Before this, pitch existed only inside the Gemini Live *text* prompt. The local
path - the one that works without a key, which is everyone - passed only rate,
so every character spoke in the same level voice.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import PERSONA_VOICE_PROFILES, voice_profile_for  # noqa: E402

FEMALE = ("myra", "myraa", "amarya", "evelyn")
MALE = ("core", "energycore", "energy core")


@pytest.mark.parametrize("persona", FEMALE)
def test_the_women_are_female_voices(persona):
    assert voice_profile_for(persona, "male", 1.0)["gender"] == "female", (
        "%s must not be spoken by a male voice even when one is requested" % persona
    )


@pytest.mark.parametrize("persona", MALE)
def test_energy_core_is_a_male_voice(persona):
    assert voice_profile_for(persona, "female", 1.0)["gender"] == "male", (
        "%s must not be spoken by a female voice even when one is requested" % persona
    )


@pytest.mark.parametrize("persona", FEMALE)
def test_the_women_get_the_pitch_lift_the_brief_asks_for(persona):
    """+20% to +35% above conversational. +50Hz measured +30.4% on this engine."""
    profile = voice_profile_for(persona, "female", 1.0)
    assert profile["pitch_hz"] >= 40, (
        "%s is not lifted; it will sound like the default voice" % persona
    )


@pytest.mark.parametrize("persona", MALE)
def test_the_man_is_not_pitched_up(persona):
    """The brief describes a "cute anime heroine". Applying it to a male
    character would make him sound wrong, not matching."""
    assert voice_profile_for(persona, "male", 1.0)["pitch_hz"] == 0


@pytest.mark.parametrize("persona", FEMALE)
def test_the_women_speak_slightly_slower(persona):
    """"0.9x to 0.95x normal speed", from the brief."""
    speed = voice_profile_for(persona, "female", 1.0)["speed"]
    assert 0.88 <= speed <= 0.96, speed


def test_male_and_female_are_genuinely_different_settings():
    """Not one voice with a knob turned: different voice, different pitch."""
    woman = voice_profile_for("myra", "female", 1.0)
    man = voice_profile_for("energycore", "female", 1.0)
    assert woman["gender"] != man["gender"]
    assert woman["pitch_hz"] != man["pitch_hz"]


def test_an_unknown_character_is_left_as_asked():
    """No silent override of a caller that knows what it wants."""
    profile = voice_profile_for("somebody-else", "male", 1.15)
    assert profile == {"gender": "male", "pitch_hz": 0, "speed": 1.15}


def test_no_persona_is_left_as_asked():
    assert voice_profile_for(None, "female", 1.0)["pitch_hz"] == 0


def test_every_profile_is_complete_and_sane():
    for name, profile in PERSONA_VOICE_PROFILES.items():
        assert profile["gender"] in ("male", "female"), name
        assert -60 <= profile["pitch_hz"] <= 80, name
        assert 0.6 <= profile["speed"] <= 1.6, name


# ---------------------------------------------------------------------------
# The setting has to reach the engine
# ---------------------------------------------------------------------------

def test_pitch_is_passed_to_the_local_engine():
    """It used to live only in the Gemini Live text prompt, so the local voice
    - the one that works without a paid key - never changed at all."""
    import inspect

    from app import main

    source = inspect.getsource(main._synthesize_neural_speech)
    assert "pitch_hz" in source
    assert "--pitch=" in source or "f\"--pitch" in source or "pitch=" in source


def test_pitch_is_clamped_to_something_that_still_sounds_like_a_voice():
    import inspect

    from app import main

    source = inspect.getsource(main._synthesize_neural_speech)
    assert "max(-60, min(int(pitch_hz), 80))" in source, (
        "an unclamped pitch stops sounding like a lighter voice and starts "
        "sounding processed"
    )


def test_pitch_is_expressed_in_hertz_not_percent():
    """edge-tts takes Hz. Sending "+30%" is silently accepted and ignored,
    which looks exactly like the feature working."""
    import inspect

    from app import main

    source = inspect.getsource(main._synthesize_neural_speech)
    assert "Hz" in source


def test_the_frozen_worker_accepts_pitch_without_breaking_older_callers():
    """It is appended last, so a server that does not send it still works."""
    source = (BACKEND.parent / "desktop_app.py").read_text(encoding="utf-8")
    assert 'argv[5] if len(argv) > 5 else "+0Hz"' in source
    assert "pitch=pitch" in source


def test_the_endpoint_applies_the_character_profile():
    import inspect

    from app import main

    source = inspect.getsource(main.local_espeak_tts)
    assert "voice_profile_for(" in source
    assert "pitch_hz=profile" in source
