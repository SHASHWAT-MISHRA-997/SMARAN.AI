"""Ollama from the app: list, delete for good, the library, and no steerable names."""
import asyncio
import types

import pytest
from fastapi import HTTPException

from app import ollama_manager as om


class Res:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body or {}

    def json(self):
        return self._body


def fake_ollama(calls, models, delete_status=200):
    async def _ollama(method, path, **kwargs):
        calls.append((method, path, kwargs.get("json")))
        if path == "/api/tags":
            return Res(200, {"models": models})
        if path == "/api/ps":
            return Res(200, {"models": [{"name": "qwen2.5-coder:7b", "size_vram": 5_000_000_000}]})
        if path == "/api/delete":
            return Res(delete_status, {"error": "busy"} if delete_status != 200 else {})
        return Res(200)
    return _ollama


MODELS = [
    {"name": "qwen2.5-coder:7b", "size": 4_683_087_561, "details": {"parameter_size": "7.6B", "family": "qwen2",
                                                                    "quantization_level": "Q4_K_M", "format": "gguf"}},
    {"name": "gpt-oss:120b-cloud", "size": 384, "remote_host": "https://ollama.com:443", "details": {}},
]


def test_installed_lists_everything_ollama_has(monkeypatch):
    calls = []
    monkeypatch.setattr(om, "_ollama", fake_ollama(calls, MODELS))
    monkeypatch.setattr(om, "_memory_gb", lambda: {"vram_gb": 6.0, "ram_gb": 16.0})
    out = asyncio.run(om.installed(_user=None))
    names = {m["name"]: m for m in out["models"]}
    assert names["qwen2.5-coder:7b"]["loaded"] and names["qwen2.5-coder:7b"]["quantization"] == "Q4_K_M"
    assert names["gpt-oss:120b-cloud"]["remote"]
    assert out["total_bytes"] == 4_683_087_561      # a cloud model takes no disk


def test_delete_unloads_then_removes_and_reports_space(monkeypatch):
    calls = []
    monkeypatch.setattr(om, "_ollama", fake_ollama(calls, MODELS))
    out = asyncio.run(om.remove(name="qwen2.5-coder:7b", _user=None))
    assert out == {"deleted": "qwen2.5-coder:7b", "freed_bytes": 4_683_087_561}
    paths = [c[1] for c in calls]
    assert paths.index("/api/generate") < paths.index("/api/delete")
    assert ("DELETE", "/api/delete", {"model": "qwen2.5-coder:7b"}) in calls


def test_delete_refuses_what_is_not_installed_and_reports_failure(monkeypatch):
    monkeypatch.setattr(om, "_ollama", fake_ollama([], MODELS))
    with pytest.raises(HTTPException) as missing:
        asyncio.run(om.remove(name="llama3:8b", _user=None))
    assert missing.value.status_code == 404
    monkeypatch.setattr(om, "_ollama", fake_ollama([], MODELS, delete_status=500))
    with pytest.raises(HTTPException) as failed:
        asyncio.run(om.remove(name="qwen2.5-coder:7b", _user=None))
    assert failed.value.status_code == 502 and "busy" in failed.value.detail


@pytest.mark.parametrize("name", ["../x", "a b", "", "x" * 200])
def test_delete_names_are_checked(name, monkeypatch):
    monkeypatch.setattr(om, "_ollama", fake_ollama([], MODELS))
    with pytest.raises(HTTPException):
        asyncio.run(om.remove(name=name, _user=None))


PAGE = '''
<li class="flex"><a href="/library/qwen3" class="group">
  <p class="max-w-lg break-words">Qwen3 &amp; friends.</p>
  <span class="inline-flex bg-indigo-50 px-2">tools</span>
  <span class="inline-flex bg-indigo-50 px-2">thinking</span>
  <span class="inline-flex bg-[#ddf4ff] px-2">4b</span>
  <span class="inline-flex bg-[#ddf4ff] px-2">8b</span>
  <span >37.9M</span><span class="hidden">&nbsp;Pulls</span>
  <span >58</span><span class="hidden">&nbsp;Tags</span>
  <span >11 months ago</span>
</a></li>'''


def test_library_page_is_read():
    [m] = om.parse_library(PAGE)
    assert m["name"] == "qwen3" and m["description"] == "Qwen3 & friends."
    assert m["capabilities"] == ["tools", "thinking"] and m["sizes"] == ["4b", "8b"]
    assert m["pulls"] == "37.9M" and m["tags"] == 58 and m["updated"] == "11 months ago"


def test_approximate_sizes_track_the_registry():
    assert om.approx_q4_gb("8b") == pytest.approx(5.2, abs=0.3)      # registry: 5.2 GB
    assert om.approx_q4_gb("270m") < 1
    assert om.approx_q4_gb("latest") is None


@pytest.mark.parametrize("name", ["../etc", "a/b", "a b", "x" * 100])
def test_library_names_are_checked(name):
    with pytest.raises(HTTPException):
        asyncio.run(om.library_tags(name=name, _user=None))
