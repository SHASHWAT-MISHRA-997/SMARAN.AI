"""Voice identity and delivery must stay stable across clients."""

from app.main import _live_voice_for_persona, _live_voice_system_prompt


def test_reference_characters_use_the_reference_gemini_voice():
    assert _live_voice_for_persona("myra", "Kore") == "Aoede"
    assert _live_voice_for_persona("myraa", "Leda") == "Aoede"
    assert _live_voice_for_persona("amarya", "Kore") == "Aoede"
    assert _live_voice_for_persona("evelyn", "Leda") == "Aoede"
    assert _live_voice_for_persona("core", "Charon") == "Orus"


def test_unknown_voice_is_rejected_before_it_reaches_gemini():
    assert _live_voice_for_persona("unknown", "made-up-voice") == "Aoede"
    assert _live_voice_for_persona("unknown", "Orus") == "Orus"


def test_female_prompts_share_reference_delivery_and_gendered_grammar():
    myra = _live_voice_system_prompt("auto", "myra")
    amarya = _live_voice_system_prompt("auto", "myraa")
    assert "20% to 35% above" in myra
    assert "0.9x to 0.95x" in amarya
    assert "Never 'मैं कर सकता हूँ'." in myra
    assert "Never 'मैं कर सकता हूँ'." in amarya


def test_energy_core_prompt_is_masculine_and_grounded():
    prompt = _live_voice_system_prompt("auto", "core")
    assert "adult Indian man" in prompt
    assert "use the masculine forms" in prompt
    assert "मैं कर सकता हूँ" in prompt
