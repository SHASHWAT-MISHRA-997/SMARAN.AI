"""The site builder, exercised against a stand-in for a provider.

Every cloud key on the machine this was written on was dead - an invalid
Anthropic key, an exhausted Gemini free tier, an OpenRouter key its own API
does not recognise, and eighty NVIDIA models that all answer 404 - and the
local Ollama held nothing but an embedding model. So the thing that could not
be shown there was a finished page from a real model.

What can be shown, and is what this checks, is the machinery around it: that
a reply cut off mid-page is finished rather than thrown away, that a polish
pass which loses half the page is refused, that a model which does not answer
is passed over for one that does, and that a date in a model id is not read
as a version number.
"""

from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import site_builder  # noqa: E402


PAGE = (
    "<!doctype html><html><head><title>Chakra Cycle Works</title></head>"
    "<body><h1>Chakra Cycle Works</h1>" + ("<p>Real copy about bicycles.</p>" * 40)
    + "</body></html>"
)


class _Stub(BaseHTTPRequestHandler):
    """An OpenAI-shaped provider whose behaviour the test decides."""

    behaviour = "whole"      # set by each test
    calls: list[dict] = []

    def log_message(self, *args):  # keep the test output readable
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"data": [{"id": "stub-model-a"}, {"id": "stub-model-b"}]})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        request = json.loads(self.rfile.read(length) or b"{}")
        system = request["messages"][0]["content"]
        _Stub.calls.append({"model": request.get("model"), "system": system[:40]})

        polishing = system.startswith("You are a design director")
        continuing = system.startswith("You are continuing")

        if _Stub.behaviour == "refuses":
            self._send(429, {"error": {"message": "no quota left"}})
            return
        if _Stub.behaviour == "truncated" and not polishing:
            reply = PAGE[:-40] if not continuing else PAGE[-40:]
        elif _Stub.behaviour == "polish_ruins_it" and polishing:
            reply = "<!doctype html><html><head><title>Chakra Cycle Works</title>" \
                    "</head><body><h1>Chakra Cycle Works</h1>" + ("<p>x</p>" * 60) \
                    + "</body></html>"
        else:
            reply = PAGE
        self._send(200, {"choices": [{"message": {"content": reply}}]})


@pytest.fixture
def stub(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _Stub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = "http://127.0.0.1:%d/v1" % server.server_port

    monkeypatch.setitem(site_builder._ENDPOINTS, "stub", base)
    monkeypatch.setattr(site_builder, "PROVIDER_ORDER", (("stub", "STUB_KEY"),))
    monkeypatch.setitem(site_builder._PREFERENCES, "stub", ("stub-model",))
    monkeypatch.setenv("STUB_KEY", "a-key")
    # No local server should be consulted during these tests.
    monkeypatch.setattr(site_builder, "_local_models", lambda: [])
    _Stub.calls = []
    yield _Stub
    server.shutdown()


def test_builds_a_page(stub):
    stub.behaviour = "whole"
    document, how = site_builder.build("Chakra Cycle Works", "a bicycle workshop")
    assert document.startswith("<!doctype html")
    assert document.rstrip().endswith("</html>")
    assert "stub-model-a" in how
    assert "refined in a second pass" in how


def test_a_reply_cut_off_mid_page_is_finished_not_discarded(stub):
    """The old code returned nothing at all for a page missing </html>."""
    stub.behaviour = "truncated"
    document, how = site_builder.build("Chakra Cycle Works", "a bicycle workshop")
    assert document is not None, how
    assert document.rstrip().endswith("</html>")
    assert any(c["system"].startswith("You are continuing") for c in stub.calls)


def test_a_polish_pass_that_loses_the_page_is_refused(stub):
    stub.behaviour = "polish_ruins_it"
    document, how = site_builder.build("Chakra Cycle Works", "a bicycle workshop")
    # The long first draft is kept, not the gutted "improvement".
    assert document.count("Real copy about bicycles") == 40
    assert "refined in a second pass" not in how


def test_a_provider_that_refuses_is_reported_not_hidden(stub):
    stub.behaviour = "refuses"
    document, why = site_builder.build("Chakra Cycle Works", "a bicycle workshop")
    assert document is None
    assert "no quota left" in why


def test_nothing_is_generated_without_anything_to_generate_with(monkeypatch):
    monkeypatch.setattr(site_builder, "PROVIDER_ORDER", ())
    monkeypatch.setattr(site_builder, "_local_models", lambda: [])
    monkeypatch.setattr(site_builder, "_reachable_local_server", lambda: True)
    document, why = site_builder.build("Anything", "a brief")
    assert document is None
    assert "embedding models" in why


def test_the_site_name_reaches_the_model(stub):
    """The bug this replaced sent the last installed model id as the name."""
    stub.behaviour = "whole"
    captured = {}
    original = site_builder.ask

    def watching(generator, system, user):
        if user != "Say READY.":          # the probe, not the brief
            captured.setdefault("first_user_message", user)
        return original(generator, system, user)

    site_builder.ask = watching
    try:
        site_builder.build("Chakra Cycle Works", "a bicycle workshop in Pune")
    finally:
        site_builder.ask = original
    assert "Site name: Chakra Cycle Works" in captured["first_user_message"]


def test_a_date_in_a_model_id_is_not_a_version():
    assert site_builder._version_of("gemini-3.1-pro-preview") == 3.1
    assert site_builder._version_of("gemini-2.5-pro") == 2.5
    # December 2025, not version 12.
    assert site_builder._version_of("deep-research-pro-preview-12-2025") == 0.0


def test_the_newer_model_is_preferred():
    ranked = site_builder.rank_models(
        "gemini", ["gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-2.5-flash"])
    assert ranked[0] == "gemini-3.1-pro-preview"


def test_models_that_cannot_write_a_page_are_left_out():
    ranked = site_builder.rank_models(
        "gemini", ["text-embedding-004", "imagen-3.0", "gemini-3.1-pro-preview"])
    assert ranked == ["gemini-3.1-pro-preview"]
