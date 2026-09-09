"""Stopping control of the machine, and what "stopped" is allowed to mean.

Desktop actions had no session and no stop. Once a multi-step task was running,
stopping it meant closing the application - while it carried on opening and
typing into things. These pin the behaviour that makes stop real, and the
places where an easy shortcut would quietly make it fake.
"""

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import control_session                      # noqa: E402
from app.desktop_agent import DesktopAgent           # noqa: E402


@pytest.fixture(autouse=True)
def clean_sessions():
    control_session.reset_for_tests()
    yield
    control_session.reset_for_tests()


# ---- the session itself ----------------------------------------------------

def test_a_new_session_is_running():
    token = control_session.begin("open some apps")
    assert control_session.is_running(token)


def test_stopping_a_session_stops_it():
    token = control_session.begin()
    control_session.stop(token)
    assert not control_session.is_running(token)


def test_no_token_means_not_in_a_session_and_is_allowed():
    # Ordinary single actions must keep working. This is a scope for
    # multi-step control, not a new gate on everything.
    assert control_session.is_running(None)
    assert control_session.is_running("")


def test_an_unknown_token_is_refused_rather_than_allowed():
    # The tempting shortcut is `not stopped`, which treats an unknown token as
    # running - and makes the stop control bypassable by inventing a token.
    assert not control_session.is_running("never-issued")


def test_stopping_one_session_leaves_another_running():
    first = control_session.begin("first")
    second = control_session.begin("second")
    control_session.stop(first)
    assert not control_session.is_running(first)
    assert control_session.is_running(second)


def test_stopping_everything_takes_no_token():
    # The moment somebody wants control to stop is not the moment to ask them
    # which session they meant.
    first = control_session.begin()
    second = control_session.begin()
    outcome = control_session.stop()
    assert outcome["stopped"] == 2
    assert not control_session.is_running(first)
    assert not control_session.is_running(second)


def test_stopping_twice_is_not_an_error():
    token = control_session.begin()
    assert control_session.stop(token)["stopped"] == 1
    # The second press reports no *newly* stopped session, and does not fail.
    assert control_session.stop(token)["known"] is True


def test_tokens_are_unguessable_and_distinct():
    tokens = {control_session.begin() for _ in range(50)}
    assert len(tokens) == 50
    assert all(len(token) >= 24 for token in tokens)


def test_the_listing_never_hands_out_a_token():
    # The token authorises control of the machine. A status panel is not a
    # place to give one away.
    token = control_session.begin("open chrome")
    listed = control_session.active()
    assert len(listed) == 1
    assert token not in str(listed)
    assert listed[0]["reason"] == "open chrome"


def test_a_stopped_session_disappears_from_the_listing():
    token = control_session.begin()
    control_session.stop(token)
    assert control_session.active() == []


# ---- and what that means for a real action ---------------------------------

def _run(action, params):
    return asyncio.run(DesktopAgent.execute(action, params))


def test_an_action_in_a_stopped_session_is_refused_before_it_acts():
    token = control_session.begin("open things")
    control_session.stop(token)
    result = _run("open_url", {"url": "https://example.com",
                               "control_session": token})
    assert result["success"] is False
    assert result["stopped"] is True
    assert "not taken" in result["error"]


def test_a_refused_action_never_reaches_its_handler(monkeypatch):
    # The check has to sit before dispatch. Placed after, the step would run
    # and only its result would be discarded - which is not stopping.
    reached = []
    monkeypatch.setattr(DesktopAgent, "_action_open_url",
                        staticmethod(lambda params: reached.append(params) or {"success": True}))
    token = control_session.begin()
    control_session.stop(token)
    _run("open_url", {"url": "https://example.com", "control_session": token})
    assert reached == []


def test_steps_are_counted_so_a_session_can_say_what_it_did(monkeypatch):
    monkeypatch.setattr(DesktopAgent, "_action_open_url",
                        staticmethod(lambda params: {"success": True}))
    token = control_session.begin("two steps")
    _run("open_url", {"url": "https://example.com", "control_session": token})
    _run("open_url", {"url": "https://example.org", "control_session": token})
    assert control_session.active()[0]["steps"] == 2


def test_an_action_with_no_session_is_unaffected_by_a_stop(monkeypatch):
    # Stopping a control session must not disable the app's ordinary actions.
    monkeypatch.setattr(DesktopAgent, "_action_open_url",
                        staticmethod(lambda params: {"success": True}))
    control_session.begin()
    control_session.stop()
    assert _run("open_url", {"url": "https://example.com"})["success"] is True
