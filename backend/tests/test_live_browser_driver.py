"""The live browser, driven against a real Chrome/Edge with no model involved.

Skipped where no Chromium-family browser is installed. The pages are built
in-memory as data: URLs where possible, and the refusals are checked against
the real browser rather than a mock - the point is that the window really does
not go where it is refused.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import live_browser  # noqa: E402
from app.live_browser import LiveBrowser, Refused, check_url  # noqa: E402

pytestmark = pytest.mark.skipif(not live_browser.find_browser(),
                                reason="no Chromium-family browser on this machine")


@pytest.mark.parametrize("url", [
    "http://localhost:8000/api/terminal/run", "http://127.0.0.1", "http://192.168.1.1/admin",
    "http://10.0.0.5", "http://[::1]:8000", "file:///C:/Windows/win.ini", "javascript:alert(1)",
    "chrome://settings", "http://printer.local",
])
def test_local_and_non_web_addresses_are_refused(url):
    with pytest.raises(Refused):
        check_url(url)


def test_a_bare_domain_becomes_https():
    assert check_url("example.com") == "https://example.com"


@pytest.fixture(scope="module")
def browser():
    b = LiveBrowser()
    b.start()
    yield b
    b.close()
    assert not b.profile, "the throwaway profile must be deleted"


def _load(browser, html):
    browser.send("Page.navigate", {"url": "about:blank"})
    browser._settle(5)
    browser.evaluate("document.open(); document.write(%r); document.close();" % html)
    return browser.snapshot()


def test_it_reads_a_page_and_numbers_what_can_be_pressed(browser):
    page = _load(browser, "<title>Fixture</title><h1>Hello</h1><a href='#x'>More info</a>"
                          "<input placeholder='Search here'><button>Go</button>")
    labels = [e["label"] for e in page["elements"]]
    assert "More info" in labels and "Search here" in labels and "Go" in labels
    assert "Hello" in page["text"]


def test_it_types_and_clicks(browser):
    _load(browser, "<input id='q' placeholder='Query'><button onclick=\"document.title='clicked:'+"
                   "document.getElementById('q').value\">Look up</button>")
    field = next(e for e in browser.last["elements"] if e["label"] == "Query")
    button = next(e for e in browser.last["elements"] if e["label"] == "Look up")
    browser.type(field["id"], "smaran")
    browser.click(button["id"])
    assert browser.evaluate("document.title") == "clicked:smaran"


def test_it_will_not_type_a_password(browser):
    _load(browser, "<input type='password' placeholder='Password'>")
    field = browser.last["elements"][0]
    with pytest.raises(Refused, match="never typed"):
        browser.type(field["id"], "hunter2")
    assert browser.evaluate("document.querySelector('input').value") == ""


def test_it_stops_before_an_irreversible_button(browser):
    _load(browser, "<button onclick=\"document.title='ordered'\">Place order</button>")
    with pytest.raises(Refused, match="STOP"):
        browser.click(browser.last["elements"][0]["id"])
    assert browser.evaluate("document.title") != "ordered"


def test_a_redirect_to_this_computer_is_stopped(browser):
    _load(browser, "<a href='http://127.0.0.1:9/'>Innocent link</a>")
    with pytest.raises(Refused, match="local network"):
        browser.click(browser.last["elements"][0]["id"])
    # Refused before loading: the browser never reached 127.0.0.1.
    assert "127.0.0.1" not in str(browser.evaluate("location.href"))
