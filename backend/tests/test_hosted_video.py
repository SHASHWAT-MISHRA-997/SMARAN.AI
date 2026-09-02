"""Where a video request goes, and what it says when it cannot go anywhere.

The rule this file exists to hold: a hosted run is never a silent fallback.
It costs the person money and sends their prompt to another company, so it
happens only when they have already saved a key, and the reply says so before
it starts.

Nothing here reaches the network. The one test that would is the model check,
and it is exercised through its own refusal instead.
"""

import pytest

from app.video import hosted


@pytest.fixture(autouse=True)
def _no_ambient_key(monkeypatch):
    monkeypatch.delenv(hosted.ENV_KEY, raising=False)
    monkeypatch.delenv(hosted.ENV_MODEL, raising=False)


def test_not_configured_without_a_key():
    assert hosted.configured() is False


def test_configured_when_a_key_is_present(monkeypatch):
    monkeypatch.setenv(hosted.ENV_KEY, "r8_something")
    assert hosted.configured() is True


def test_generating_without_a_key_says_where_to_put_one():
    with pytest.raises(hosted.HostedVideoError) as caught:
        hosted.generate("a cat on a skateboard")
    message = str(caught.value)
    assert "No Replicate key is saved" in message
    # And that it is theirs to pay for - not a detail to discover on a bill.
    assert "billed to" in message


def test_the_model_is_a_setting(monkeypatch):
    assert hosted.model_name() == hosted.DEFAULT_MODEL
    monkeypatch.setenv(hosted.ENV_MODEL, "someone/else-model")
    assert hosted.model_name() == "someone/else-model"


@pytest.mark.parametrize("name", ["nonsense", "too/many/slashes", ""])
def test_a_name_that_is_not_owner_slash_model_is_refused_before_the_network(name):
    with pytest.raises(hosted.HostedVideoError) as caught:
        hosted.check_model(name or "nonsense")
    assert "owner/model" in str(caught.value)


def test_status_describes_it_without_claiming_it_works():
    report = hosted.status()
    assert report["provider"] == "replicate"
    assert report["configured"] is False
    assert report["model"] == hosted.DEFAULT_MODEL
    assert "replicate.com" in report["key_url"]
