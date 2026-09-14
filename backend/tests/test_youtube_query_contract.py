"""Every matcher that opens YouTube must search for the right thing.

There are three of them, which is two more than anybody wants:

  * ``app/desktop_agent.py`` - spoken and typed commands on the desktop
  * ``app/web_intents.py``   - the browser-opening path behind /api/desktop/voice-command
  * ``frontend/src/utils/deviceCommands.js`` - the phone, which has no backend
    to ask when it is not paired with a desktop

They exist separately for real reasons, and they drifted for exactly that
reason too. The same gap - Hinglish naming the song *before* the site - has now
been found in all three, one at a time, months apart.

The third was the worst, because it did not fail. Asked to play "ganpati bappa
song youtube par play karo", web_intents let its optional locative go unmatched
and captured it as the query, so YouTube opened and searched for **"par"** - a
postposition. The command reported success and returned the wrong thing, which
is harder to notice than an outright failure and is what "YouTube opens but
nothing plays" actually felt like from the outside.

The first version of this contract would not have caught it: it asserted only
that the query was non-empty and did not contain "youtube", and "par" passes
both. So the expected query is written down now, per phrase, in
shared/device-intents.json - which the phone's suite reads too.
"""

import json
import sys
import urllib.parse
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

SHARED = json.loads(
    (BACKEND.parent / "shared" / "device-intents.json").read_text(encoding="utf-8")
)
PHRASES = SHARED["play_on_youtube"]
EXPECTED = SHARED["expected_query"]


def _query_from_url(url):
    return urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get(
        "search_query", [""]
    )[0]


# ---------------------------------------------------------------------------
# The browser path - where the "par" bug lived
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase", PHRASES)
def test_web_intents_searches_for_the_right_thing(phrase):
    from app.web_intents import detect_browser_command

    result = detect_browser_command(phrase)
    assert result, "%r reached nothing" % phrase
    assert result.get("url"), "%r produced no url" % phrase
    assert _query_from_url(result["url"]) == EXPECTED[phrase], phrase


@pytest.mark.parametrize("phrase", PHRASES)
def test_the_search_is_never_a_grammatical_particle(phrase):
    """The specific failure. "par", "pe", "on" are where the song was, not the
    song."""
    from app.web_intents import detect_browser_command

    query = _query_from_url(detect_browser_command(phrase)["url"])
    assert query.strip().lower() not in {"par", "pe", "on", "mein", "me", "youtube"}


# ---------------------------------------------------------------------------
# The desktop agent path
# ---------------------------------------------------------------------------

def _route(text):
    from app.desktop_agent import INTENT_PATTERNS

    for pattern, action_id, template in INTENT_PATTERNS:
        match = pattern.search(text)
        if match:
            query = None
            if template.get("query") == "$1" and match.groups():
                query = match.group(1)
            return action_id, query
    return None, None


@pytest.mark.parametrize("phrase", PHRASES)
def test_the_desktop_agent_extracts_the_right_thing(phrase):
    action, query = _route(phrase)
    assert action == "search_youtube", "%r routed to %r" % (phrase, action)
    assert query and query.strip() == EXPECTED[phrase], (
        "%r extracted %r, expected %r" % (phrase, query, EXPECTED[phrase])
    )


# ---------------------------------------------------------------------------
# Both paths agree, and both leave questions alone
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase", PHRASES)
def test_the_two_backend_paths_agree(phrase):
    """Two matchers that disagree mean the answer depends on which screen the
    user happened to be on."""
    from app.web_intents import detect_browser_command

    _, agent_query = _route(phrase)
    web_query = _query_from_url(detect_browser_command(phrase)["url"])
    assert agent_query.strip() == web_query, (
        "desktop agent says %r, browser path says %r" % (agent_query, web_query)
    )


@pytest.mark.parametrize("phrase", SHARED["not_a_device_command"])
def test_talking_about_youtube_opens_nothing(phrase):
    from app.web_intents import detect_browser_command

    assert detect_browser_command(phrase) is None, (
        "%r was treated as a command to open YouTube" % phrase
    )


def test_the_contract_covers_every_phrase():
    """A phrase added without an expected query would be checked for nothing."""
    assert set(EXPECTED) == set(PHRASES)
    for phrase, query in EXPECTED.items():
        assert query and len(query) > 2, phrase
