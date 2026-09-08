"""Speech must not turn a complaint or negation into a desktop command."""
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.desktop_agent import DesktopAgent, detect_desktop_intent
from app import windows_audio


@pytest.mark.parametrize('text', [
    'do not mute', "don't mute", 'why does it mute itself',
    'how do I unmute', 'explain mute', 'please do not mute',
    'the word mute is in this sentence', 'please never mute',
])
def test_discussing_mute_does_not_change_system_audio(text):
    assert detect_desktop_intent(text) is None


@pytest.mark.parametrize('text,muted', [
    ('mute', 'true'), ('unmute', 'false'), ('Please unmute the speakers.', 'false'),
    ('awaz band karo', 'true'), ('awaaz chalu karo', 'false'),
])
def test_explicit_audio_commands_set_a_state(text, muted):
    assert detect_desktop_intent(text) == {'action':'toggle_mute', 'params':{'muted':muted}}


def test_negative_startup_request_disables_startup():
    result = detect_desktop_intent('do not start smaran ai with windows startup')
    assert result == {'action':'set_launch_at_startup', 'params':{'enabled':'false'}}


def test_volume_reports_measured_value_and_errors(monkeypatch):
    monkeypatch.setattr(windows_audio, 'set_volume', lambda value: 42)
    assert DesktopAgent._action_set_volume({'level':43})['level'] == 42
    def fail(value):
        raise OSError('no endpoint')
    monkeypatch.setattr(windows_audio, 'set_volume', fail)
    assert DesktopAgent._action_set_volume({'level':43})['success'] is False


def test_unmute_passes_false_instead_of_toggling(monkeypatch):
    calls = []
    monkeypatch.setattr(windows_audio, 'set_mute', lambda value: calls.append(value) or False)
    for _ in range(2):
        assert DesktopAgent._action_toggle_mute({'muted':'false'})['muted'] is False
    assert calls == [False, False]


def test_clipboard_text_is_data_and_process_failure_is_reported(monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'win32')
    payload = "Hindi: नमस्ते'; throw 'injected"
    def run(command, **kwargs):
        assert payload not in command[-1]
        assert kwargs['input'] == payload
        assert kwargs['encoding'] == 'utf-8'
        assert kwargs['check'] is True
        raise subprocess.CalledProcessError(1, command)
    monkeypatch.setattr(subprocess, 'run', run)
    assert DesktopAgent._action_set_clipboard({'text':payload})['success'] is False
