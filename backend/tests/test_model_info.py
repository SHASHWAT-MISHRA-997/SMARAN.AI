"""Model details: real figures shaped for the panel, and no request that can be steered elsewhere."""
import pytest
from fastapi import HTTPException

from app import model_info as mi


def test_fit_is_measured_against_this_machine():
    assert mi.fit(4_000_000_000, 6.0, 16.0)["status"] == "fits"
    assert mi.fit(6_000_000_000, 6.0, 16.0)["status"] == "partial"
    assert mi.fit(20_000_000_000, 6.0, 16.0)["status"] == "too_large"
    assert mi.fit(None, 6.0, 16.0)["status"] == "unknown"
    assert mi.fit(4_000_000_000, None, None)["status"] == "unknown"


@pytest.mark.parametrize("name,quant", [
    ("Qwen2.5-7B-Instruct-Q4_K_M.gguf", "Q4_K_M"),
    ("model-IQ3_XS.gguf", "IQ3_XS"),
    ("Llama-3.2-1B-Instruct-f16.gguf", "F16"),
    ("weird.gguf", ""),
])
def test_quant_is_read_from_the_file_name(name, quant):
    assert mi.quant_of(name) == quant


def test_gguf_build_is_the_same_model_only():
    candidates = [
        {"id": "unsloth/Qwen3.5-4B-GGUF", "downloads": 9},
        {"id": "unsloth/Qwen3-4B-GGUF", "downloads": 5},
        {"id": "Qwen/Qwen3-4B-GGUF", "downloads": 4},
        {"id": "bartowski/Qwen_Qwen3-4B-GGUF", "downloads": 3},
    ]
    assert mi.pick_gguf_repo("Qwen/Qwen3-4B-AWQ", candidates) == "Qwen/Qwen3-4B-GGUF"
    assert mi.pick_gguf_repo("someone/Qwen3-4B", candidates) == "unsloth/Qwen3-4B-GGUF"
    assert mi.pick_gguf_repo("vikhyatk/moondream2", candidates) is None


def test_hf_shape_lists_quants_with_ollama_names():
    data = {"id": "o/M-GGUF", "downloads": 10, "likes": 2, "tags": ["license:mit"],
            "gguf": {"architecture": "llama", "context_length": 8192, "total": 8_000_000_000,
                     "chat_template": "{% if tools %}"},
            "siblings": [{"rfilename": "M-Q4_K_M.gguf", "size": 4_900_000_000},
                         {"rfilename": "M-Q8_0.gguf", "size": 8_500_000_000},
                         {"rfilename": "mmproj-f16.gguf", "size": 1},
                         {"rfilename": "M-Q8_0-00001-of-00002.gguf", "size": 1}]}
    out = mi.shape_hf(data, "# Card", {"vram_gb": 6.0, "ram_gb": 16.0})
    assert [f["quant"] for f in out["downloads_options"]] == ["Q4_K_M", "Q8_0"]
    assert out["downloads_options"][0]["ollama_name"] == "hf.co/o/M-GGUF:Q4_K_M"
    assert out["params"] == "8B" and out["architecture"] == "llama" and out["license"] == "mit"
    assert "Tool Use" in out["capabilities"] and out["formats"] == ["GGUF"]


def test_front_matter_is_removed_from_the_card():
    assert mi.strip_front_matter("---\nlicense: mit\n---\n# Title\nBody") == "# Title\nBody"


def test_cloud_lookup_tolerates_prefixes_and_other_providers():
    directory = {
        "google": {"id": "google", "name": "Google", "models": {"gemini-2.5-flash": {"name": "Gemini 2.5 Flash",
                   "tool_call": True, "modalities": {"input": ["text", "image"]}, "cost": {"input": 0.3}}}},
        "openai": {"id": "openai", "name": "OpenAI", "models": {"gpt-5": {"name": "GPT-5"}}},
    }
    entry = mi.find_cloud(directory, "gemini", "models/gemini-2.5-flash")
    shaped = mi.shape_cloud(entry, "gemini", "models/gemini-2.5-flash")
    assert shaped["name"] == "Gemini 2.5 Flash" and shaped["price_input_per_mtok"] == 0.3
    assert {"Vision", "Tool Use"} <= set(shaped["capabilities"])
    assert mi.find_cloud(directory, "openrouter", "openai/gpt-5")["name"] == "GPT-5"
    assert mi.find_cloud(directory, "groq", "nope") is None


@pytest.mark.parametrize("repo", ["../etc/passwd", "a", "evil.com/x/y", "a/b/../c", "a/b?x=1", "http://x/y"])
def test_repository_names_cannot_steer_the_request(repo):
    with pytest.raises(HTTPException):
        import asyncio
        asyncio.run(mi.huggingface(repo=repo, _user=None))
