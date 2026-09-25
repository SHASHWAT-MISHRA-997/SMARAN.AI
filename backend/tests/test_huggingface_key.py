"""Hugging Face keys: checked with whoami, models from the current router.

The old hf-inference/v1 address refused current tokens, so every Hugging Face
key - fine-grained ones included - failed verification. No request here reaches
Hugging Face: httpx is replaced.
"""
import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app import main


def _run(coro):
    return asyncio.run(coro)


def _fake(who_status=200, who_body=None, models=None):
    async def get(self, url, **kwargs):
        if "whoami" in url:
            return httpx.Response(who_status, json=who_body or {})
        if url.endswith("/v1/models"):
            return httpx.Response(200, json={"data": models or []})
        raise AssertionError("unexpected " + url)
    return get


def test_a_rejected_token_says_so(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake(401))
    with pytest.raises(HTTPException) as err:
        _run(main._fetch_huggingface_models("hf_bad"))
    assert err.value.status_code == 401


def test_fine_grained_without_inference_names_the_checkbox(monkeypatch):
    body = {"auth": {"accessToken": {"role": "fineGrained", "fineGrained": {"global": ["discussion.write"]}}}}
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake(200, body))
    with pytest.raises(HTTPException) as err:
        _run(main._fetch_huggingface_models("hf_x"))
    assert err.value.status_code == 400
    assert "Make calls to Inference Providers" in err.value.detail


def test_a_good_fine_grained_token_lists_text_models(monkeypatch):
    body = {"auth": {"accessToken": {"role": "fineGrained", "fineGrained": {"global": ["inference.serverless.write"]}}}}
    models = [
        {"id": "Qwen/Qwen3.8-27B", "architecture": {"output_modalities": ["text"]}},
        {"id": "black-forest-labs/FLUX", "architecture": {"output_modalities": ["image"]}},
        {"id": "meta-llama/Llama-4"},
    ]
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake(200, body, models))
    assert _run(main._fetch_huggingface_models("hf_ok")) == ["Qwen/Qwen3.8-27B", "meta-llama/Llama-4"]


def test_a_classic_read_token_is_accepted(monkeypatch):
    body = {"auth": {"accessToken": {"role": "read"}}}
    monkeypatch.setattr(httpx.AsyncClient, "get", _fake(200, body, [{"id": "a/b"}]))
    assert _run(main._fetch_huggingface_models("hf_read")) == ["a/b"]
