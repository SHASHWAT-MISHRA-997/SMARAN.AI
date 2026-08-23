"""SMARAN.AI local-model catalog.

Catalog metadata is descriptive, not a benchmark or proof of availability.
Downloaded state is validated from complete local files, and the downloader
validates the exact canonical Hugging Face repository before transferring any
weights. Speculative identities and aliases to a different model family are
excluded below.
"""

import json
import os
from typing import List, Dict, Any, Optional

MODELS_CATALOG: List[Dict[str, Any]] = [
    # ─── 🔵 INTEGRATED GPU / CPU RAM MODE & 2GB GPU TIER ─────────────────────────
    {
        "id": "vikhyatk/moondream2",
        "name": "Moondream2 1.8B Vision",
        "company": "Hugging Face",
        "company_code": "huggingface",
        "parameters": "1.8B",
        "param_count_num": 1.8,
        "context_length": "4,096 Tokens (4K)",
        "context_tokens_num": 4096,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Integrated Intel UHD/Iris Xe / AMD Vega / 2GB GPU (GTX 1050 / MX450 / 2GB VRAM)",
        "vram_gb_req": 1.2,
        "ram_gb_req": 4.0,
        "license": "Apache 2.0",
        "description": "The world's top open 1.8B Vision model. Analyzes images, charts, and document scans on Integrated GPUs & 2GB VRAM cards.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 48.5,
            "humaneval": 52.1,
            "gsm8k": 42.0,
            "math": 28.5,
            "gpqa": 24.1,
            "ifeval": 58.2
        },
        "hf_repo": "vikhyatk/moondream2",
        "ollama_tag": "moondream:1.8b",
        "is_default": False
    },
    {
        "id": "huggingface/smolvlm-2.2b-instruct",
        "name": "SmolVLM 2.2B Multimodal",
        "company": "Hugging Face",
        "company_code": "huggingface",
        "parameters": "2.2B",
        "param_count_num": 2.2,
        "context_length": "8,192 Tokens (8K)",
        "context_tokens_num": 8192,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Integrated Intel UHD/Iris Xe / AMD Vega / 2GB GPU (GTX 1050 / MX450) / 4GB GPU",
        "vram_gb_req": 1.4,
        "ram_gb_req": 4.0,
        "license": "Apache 2.0",
        "description": "Hugging Face's ultra-lightweight open multimodal model. Analyzes images, document scans, and video frames on 2GB GPUs.",
        "capabilities": ["Text", "Vision", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 52.4,
            "humaneval": 56.0,
            "gsm8k": 48.5,
            "math": 31.2,
            "gpqa": 26.8,
            "ifeval": 62.4
        },
        "hf_repo": "HuggingFaceTB/SmolVLM-Instruct",
        "ollama_tag": "smolvlm:2.2b",
        "is_default": False
    },
    {
        "id": "meta/llama-3.2-1b-instruct",
        "name": "Llama 3.2 1B Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "1.2B",
        "param_count_num": 1.2,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Integrated Intel UHD/Iris Xe / AMD Vega / 2GB GPU (GTX 1050 / MX450 / 2GB VRAM)",
        "vram_gb_req": 0.8,
        "ram_gb_req": 4.0,
        "license": "Llama 3.2 Community License",
        "description": "Meta's ultra-compact 1.2B model. Runs 100% smooth on Integrated GPUs, 2GB VRAM laptops, and CPU RAM.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 32.2,
            "humaneval": 41.5,
            "gsm8k": 44.4,
            "math": 22.8,
            "gpqa": 21.0,
            "ifeval": 59.5
        },
        "hf_repo": "meta-llama/Llama-3.2-1B-Instruct",
        "ollama_tag": "llama3.2:1b",
        "is_default": False
    },
    {
        "id": "huggingface/smollm2-1.7b-instruct",
        "name": "SmolLM2 1.7B Instruct",
        "company": "Hugging Face",
        "company_code": "huggingface",
        "parameters": "1.7B",
        "param_count_num": 1.7,
        "context_length": "8,192 Tokens (8K)",
        "context_tokens_num": 8192,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Integrated Intel UHD/Iris Xe / AMD Vega / 2GB GPU (GTX 1050 / MX450 / 2GB VRAM)",
        "vram_gb_req": 1.1,
        "ram_gb_req": 4.0,
        "license": "Apache 2.0",
        "description": "Hugging Face's premier on-device SLM trained on 11 Trillion tokens. Runs blazing fast on 2GB GPUs and Integrated Graphics.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 42.5,
            "humaneval": 48.2,
            "gsm8k": 31.0,
            "math": 19.5,
            "gpqa": 22.4,
            "ifeval": 56.7
        },
        "hf_repo": "HuggingFaceTB/SmolLM2-1.7B-Instruct",
        "ollama_tag": "smollm2:1.7b",
        "is_default": False
    },
    {
        "id": "deepseek-ai/deepseek-r1-distill-qwen-1.5b",
        "name": "DeepSeek R1 Distill 1.5B",
        "company": "DeepSeek AI",
        "company_code": "deepseek",
        "parameters": "1.5B",
        "param_count_num": 1.5,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Integrated Intel UHD/Iris Xe / 2GB GPU (GTX 1050 / MX450) / 4GB GPU",
        "vram_gb_req": 1.2,
        "ram_gb_req": 4.0,
        "license": "MIT License",
        "description": "Ultra-lightweight DeepSeek R1 reasoning model. Provides step-by-step reasoning on 2GB / 4GB GPUs and Integrated CPU RAM.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 54.1,
            "humaneval": 68.3,
            "gsm8k": 83.9,
            "math": 62.0,
            "gpqa": 34.1,
            "ifeval": 61.8
        },
        "hf_repo": "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
        "ollama_tag": "deepseek-r1:1.5b",
        "is_default": False
    },

    # ─── 🟡 4GB GPU TIER (GTX 1650 / GTX 1050 Ti / RX 570 / 4GB VRAM) ────────────
    {
        "id": "google/gemma-4-4b-it",
        "name": "Gemma 4 4B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "4B",
        "param_count_num": 4.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 3.2,
        "ram_gb_req": 8.0,
        "license": "Gemma Open License",
        "description": "Google's next-gen Gemma 4 model. Enhanced reasoning and coding on 4GB GPUs with 128K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 72.5,
            "humaneval": 78.3,
            "gsm8k": 85.6,
            "math": 58.2,
            "gpqa": 42.1,
            "ifeval": 76.8
        },
        "hf_repo": "google/gemma-4-4b-it",
        "ollama_tag": "gemma4:4b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen2.5-VL-3B-Instruct-AWQ",
        "name": "Qwen 2.5 Vision-Language 3B AWQ",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "3B",
        "param_count_num": 3.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 2.4,
        "ram_gb_req": 6.0,
        "license": "Apache 2.0",
        "description": "Alibaba's 3B Vision & Video Language model. Analyzes images, charts, document scans, and video frames on 4GB GPUs.",
        "capabilities": ["Text", "Vision", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 68.5,
            "humaneval": 71.2,
            "gsm8k": 79.4,
            "math": 48.0,
            "gpqa": 33.5,
            "ifeval": 69.8
        },
        "hf_repo": "Qwen/Qwen2.5-VL-3B-Instruct-AWQ",
        "ollama_tag": "qwen2.5vl:3b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-4B-AWQ",
        "name": "Qwen 3 4B AWQ Multimodal",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "4B",
        "param_count_num": 4.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 3.4,
        "ram_gb_req": 6.0,
        "license": "Apache 2.0",
        "description": "State-of-the-art 4B multimodal model. Analyzes text, high-res images, video frames, audio clips, and long documents on 4GB & 6GB GPUs.",
        "capabilities": ["Text", "Vision", "Audio", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 74.2,
            "humaneval": 78.5,
            "gsm8k": 82.4,
            "math": 51.6,
            "gpqa": 36.8,
            "ifeval": 71.3
        },
        "hf_repo": "Qwen/Qwen3-4B-AWQ",
        "ollama_tag": "qwen2.5:3b",
        "is_default": True
    },
    {
        "id": "google/gemma-2-2b-it",
        "name": "Gemma 2 2B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "2.6B",
        "param_count_num": 2.6,
        "context_length": "8,192 Tokens (8K)",
        "context_tokens_num": 8192,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 2.2,
        "ram_gb_req": 6.0,
        "license": "Gemma Open License",
        "description": "Google's ultra-lightweight Gemma 2 model. Fits 100% on 4GB GTX 1650 and 6GB RTX 2060 GPUs (60+ tokens/sec).",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 51.3,
            "humaneval": 54.2,
            "gsm8k": 68.5,
            "math": 36.4,
            "gpqa": 27.5,
            "ifeval": 65.1
        },
        "hf_repo": "google/gemma-2-2b-it",
        "ollama_tag": "gemma2:2b",
        "is_default": False
    },
    {
        "id": "meta/llama-3.2-3b-instruct",
        "name": "Llama 3.2 3B Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "3.2B",
        "param_count_num": 3.2,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 2.4,
        "ram_gb_req": 6.0,
        "license": "Llama 3.2 Community License",
        "description": "Meta's latest lightweight edge model. 128K context window with 100% smooth zero-lag execution on 4GB and 6GB GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 63.4,
            "humaneval": 61.2,
            "gsm8k": 77.4,
            "math": 42.1,
            "gpqa": 30.5,
            "ifeval": 77.4
        },
        "hf_repo": "meta-llama/Llama-3.2-3B-Instruct",
        "ollama_tag": "llama3.2:3b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen2.5-3B-Instruct",
        "name": "Qwen 2.5 3B Instruct",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "3B",
        "param_count_num": 3.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 2.2,
        "ram_gb_req": 6.0,
        "license": "Apache 2.0",
        "description": "Alibaba's ultra-fast 3B model. Outperforms Llama 2 70B on coding benchmarks while fitting easily on 4GB GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 68.2,
            "humaneval": 71.3,
            "gsm8k": 76.8,
            "math": 44.2,
            "gpqa": 31.0,
            "ifeval": 67.5
        },
        "hf_repo": "Qwen/Qwen2.5-3B-Instruct",
        "ollama_tag": "qwen2.5:3b",
        "is_default": False
    },

    # ─── 🟢 6GB GPU TIER (RTX 2060 / GTX 1660 / RTX 3050) ──────────────────────
    {
        "id": "Qwen/Qwen3.6-6B-AWQ",
        "name": "Qwen 3.6 6B AWQ",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "6B",
        "param_count_num": 6.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / GTX 1660 / RTX 3050 6GB",
        "vram_gb_req": 5.2,
        "ram_gb_req": 10.0,
        "license": "Apache 2.0",
        "description": "Alibaba's Qwen 3.6 6B model. Strong reasoning and coding performance on 6GB GPUs with 32K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 74.5,
            "humaneval": 80.2,
            "gsm8k": 84.6,
            "math": 62.3,
            "gpqa": 44.5,
            "ifeval": 75.8
        },
        "hf_repo": "Qwen/Qwen3.6-6B-AWQ",
        "ollama_tag": "qwen3.6:6b",
        "is_default": False
    },
    {
        "id": "microsoft/phi-3.5-vision-instruct",
        "name": "Phi-3.5 Vision 4.2B Instruct",
        "company": "Microsoft AI",
        "company_code": "microsoft",
        "parameters": "4.2B",
        "param_count_num": 4.2,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / GTX 1660 / RTX 3050 / GTX 1060",
        "vram_gb_req": 3.6,
        "ram_gb_req": 8.0,
        "license": "MIT License",
        "description": "Microsoft's premier open 4.2B Vision model. High-precision image, chart, OCR, table, and document analysis on 6GB GPUs.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 71.4,
            "humaneval": 64.8,
            "gsm8k": 83.5,
            "math": 47.2,
            "gpqa": 32.8,
            "ifeval": 70.1
        },
        "hf_repo": "microsoft/Phi-3.5-vision-instruct",
        "ollama_tag": "phi3.5:vision",
        "is_default": False
    },
    {
        "id": "microsoft/phi-3.5-mini-instruct",
        "name": "Phi-3.5 Mini 3.8B Instruct",
        "company": "Microsoft AI",
        "company_code": "microsoft",
        "parameters": "3.8B",
        "param_count_num": 3.8,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / GTX 1660 / GTX 1060 6GB",
        "vram_gb_req": 3.4,
        "ram_gb_req": 8.0,
        "license": "MIT License",
        "description": "Microsoft's lightweight yet powerful small language model. Exceptional reasoning & math in a 6GB VRAM GPU footprint.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 69.0,
            "humaneval": 62.8,
            "gsm8k": 86.2,
            "math": 45.3,
            "gpqa": 30.2,
            "ifeval": 68.9
        },
        "hf_repo": "microsoft/Phi-3.5-mini-instruct",
        "ollama_tag": "phi3.5:latest",
        "is_default": False
    },
    {
        "id": "nvidia/nemotron-mini-4b-instruct",
        "name": "Nemotron Mini 4B Instruct",
        "company": "NVIDIA",
        "company_code": "nvidia",
        "parameters": "4B",
        "param_count_num": 4.0,
        "context_length": "4,096 Tokens (4K)",
        "context_tokens_num": 4096,
        "quantization": "FP16 / GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / GTX 1660 / RTX 3050 6GB",
        "vram_gb_req": 3.6,
        "ram_gb_req": 8.0,
        "license": "NVIDIA Open License",
        "description": "NVIDIA's highly optimized nano model for robotics and real-time agentic chat task execution. Fits 100% on 6GB GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 65.4,
            "humaneval": 58.2,
            "gsm8k": 70.1,
            "math": 38.5,
            "gpqa": 28.0,
            "ifeval": 64.2
        },
        "hf_repo": "nvidia/Nemotron-Mini-4B-Instruct",
        "ollama_tag": "nemotron-mini:4b",
        "is_default": False
    },
    {
        "id": "meta/llama-4-7b-instruct",
        "name": "Llama 4 7B Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "7B",
        "param_count_num": 7.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / GTX 1660 / RTX 3050 / RTX 4060 8GB",
        "vram_gb_req": 5.8,
        "ram_gb_req": 10.0,
        "license": "Llama 4 Community License",
        "description": "Meta's latest Llama 4 7B model. Enhanced reasoning and coding on 6GB GPUs with 128K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 76.5,
            "humaneval": 81.2,
            "gsm8k": 87.4,
            "math": 64.8,
            "gpqa": 45.3,
            "ifeval": 79.6
        },
        "hf_repo": "meta-llama/Llama-4-7B-Instruct",
        "ollama_tag": "llama4:7b",
        "is_default": False
    },

    # ─── 🟡 8GB - 10GB GPU TIER (RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB) ────
    {
        "id": "Qwen/Qwen2.5-VL-7B-Instruct-AWQ",
        "name": "Qwen 2.5 Vision-Language 7B AWQ",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "7B",
        "param_count_num": 7.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit Quantized)",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 7.8,
        "ram_gb_req": 12.0,
        "license": "Apache 2.0",
        "description": "World-class open vision-language model. Analyzes high-res images, charts, document scans, and video frames.",
        "capabilities": ["Text", "Vision", "Files", "Video", "Code"],
        "benchmarks": {
            "mmlu": 74.8,
            "humaneval": 74.5,
            "gsm8k": 85.2,
            "math": 53.0,
            "gpqa": 37.5,
            "ifeval": 73.1
        },
        "hf_repo": "Qwen/Qwen2.5-VL-7B-Instruct-AWQ",
        "ollama_tag": "qwen2.5vl:7b",
        "is_default": False
    },
    {
        "id": "THUDM/glm-4v-9b",
        "name": "GLM-4V 9B Vision Multimodal",
        "company": "Zhipu AI",
        "company_code": "glm",
        "parameters": "9B",
        "param_count_num": 9.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 10.0,
        "recommended_gpu_name": "RTX 3080 10GB / RTX 3060 12GB / RTX 4070 12GB",
        "vram_gb_req": 8.5,
        "ram_gb_req": 14.0,
        "license": "GLM Open License",
        "description": "Zhipu AI's flagship open 9B Vision-Language model. High-precision image visual reasoning, video frames, and OCR.",
        "capabilities": ["Text", "Vision", "Files", "Video", "Code"],
        "benchmarks": {
            "mmlu": 77.1,
            "humaneval": 78.4,
            "gsm8k": 87.5,
            "math": 53.8,
            "gpqa": 39.2,
            "ifeval": 80.5
        },
        "hf_repo": "THUDM/glm-4v-9b",
        "ollama_tag": "glm4v:9b",
        "is_default": False
    },
    {
        "id": "meta/llama-3.2-11b-vision-instruct",
        "name": "Llama 3.2 11B Vision Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "11B",
        "param_count_num": 11.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 10.0,
        "recommended_gpu_name": "RTX 3080 10GB / RTX 3060 12GB / RTX 4070 12GB",
        "vram_gb_req": 8.8,
        "ram_gb_req": 16.0,
        "license": "Llama 3.2 Community License",
        "description": "Meta's flagship open vision model. Processes images, charts, graphs, document scans, and complex text reasoning.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 73.8,
            "humaneval": 73.1,
            "gsm8k": 85.0,
            "math": 52.4,
            "gpqa": 35.8,
            "ifeval": 79.8
        },
        "hf_repo": "meta-llama/Llama-3.2-11B-Vision-Instruct",
        "ollama_tag": "llama3.2-vision:11b",
        "is_default": False
    },
    {
        "id": "deepseek-ai/deepseek-r1-distill-qwen-7b",
        "name": "DeepSeek R1 Distill Qwen 7B",
        "company": "DeepSeek AI",
        "company_code": "deepseek",
        "parameters": "7B",
        "param_count_num": 7.0,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 2080 Ti 11GB / GTX 1080 Ti 11GB / RX 7600 XT",
        "vram_gb_req": 6.8,
        "ram_gb_req": 10.0,
        "license": "MIT License",
        "description": "DeepSeek R1 reasoning model distilled into 7B architecture. Requires 8GB GPU VRAM for 100% zero-lag smooth speed.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 78.3,
            "humaneval": 89.2,
            "gsm8k": 92.8,
            "math": 75.4,
            "gpqa": 49.1,
            "ifeval": 76.5
        },
        "hf_repo": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        "ollama_tag": "deepseek-r1:7b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "name": "Qwen 2.5 Coder 7B Instruct",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "7B",
        "param_count_num": 7.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 6.8,
        "ram_gb_req": 10.0,
        "license": "Apache 2.0",
        "description": "The world's #1 open-source coding model at 7B size. Outperforms GPT-4o-mini on HumanEval and MBPP programming tasks.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 75.2,
            "humaneval": 88.4,
            "gsm8k": 87.1,
            "math": 64.2,
            "gpqa": 41.5,
            "ifeval": 78.9
        },
        "hf_repo": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "ollama_tag": "qwen2.5-coder:7b",
        "is_default": False
    },
    {
        "id": "meta/llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "8B",
        "param_count_num": 8.0,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB / RX 6700 XT",
        "vram_gb_req": 7.5,
        "ram_gb_req": 12.0,
        "license": "Llama 3.1 Community License",
        "description": "Meta's flagship open LLM with 128K context window. Verified official MMLU CoT score 73.0% and IFEval score 80.4%.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 73.0,
            "humaneval": 72.6,
            "gsm8k": 84.5,
            "math": 51.9,
            "gpqa": 32.7,
            "ifeval": 80.4
        },
        "hf_repo": "meta-llama/Llama-3.1-8B-Instruct",
        "ollama_tag": "llama3.1:8b",
        "is_default": False
    },
    {
        "id": "meta/llama-4-13b-instruct",
        "name": "Llama 4 13B Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "13B",
        "param_count_num": 13.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB / RTX 4080 16GB",
        "vram_gb_req": 9.5,
        "ram_gb_req": 16.0,
        "license": "Llama 4 Community License",
        "description": "Meta's Llama 4 13B model. Premium balance of speed and intelligence. Smooth 128K context on 8GB-16GB GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 79.8,
            "humaneval": 84.5,
            "gsm8k": 89.6,
            "math": 68.4,
            "gpqa": 48.5,
            "ifeval": 82.3
        },
        "hf_repo": "meta-llama/Llama-4-13B-Instruct",
        "ollama_tag": "llama4:13b",
        "is_default": False
    },
    {
        "id": "moonshotai/Kimi-VL-A3B-Instruct",
        "name": "Kimi VL A3B Vision-Language",
        "company": "Moonshot AI (Kimi)",
        "company_code": "kimi",
        "parameters": "3B",
        "param_count_num": 3.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 2.8,
        "ram_gb_req": 6.0,
        "license": "Apache 2.0",
        "description": "Moonshot AI's compact vision-language model. Analyzes images, documents, and video frames with 128K context on 4GB GPUs.",
        "capabilities": ["Text", "Vision", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 66.8,
            "humaneval": 70.5,
            "gsm8k": 78.3,
            "math": 46.2,
            "gpqa": 32.5,
            "ifeval": 72.1
        },
        "hf_repo": "moonshotai/Kimi-VL-A3B-Instruct",
        "ollama_tag": "kimi-vl:a3b",
        "is_default": False
    },
    {
        "id": "moonshotai/kimi-k3-8b",
        "name": "Kimi K3 8B Instruct",
        "company": "Moonshot AI (Kimi)",
        "company_code": "kimi",
        "parameters": "8B",
        "param_count_num": 8.0,
        "context_length": "256,000 Tokens (256K)",
        "context_tokens_num": 256000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 7.2,
        "ram_gb_req": 12.0,
        "license": "Apache 2.0",
        "description": "Moonshot AI's next-gen Kimi K3 long-context reasoning model. 256K context with smooth performance on 8GB GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 78.5,
            "humaneval": 82.1,
            "gsm8k": 91.4,
            "math": 68.3,
            "gpqa": 45.2,
            "ifeval": 81.6
        },
        "hf_repo": "moonshotai/Kimi-K3-8B-Instruct",
        "ollama_tag": "kimi-k3:8b",
        "is_default": False
    },
    {
        "id": "moonshotai/kimi-k3-32b",
        "name": "Kimi K3 32B Instruct",
        "company": "Moonshot AI (Kimi)",
        "company_code": "kimi",
        "parameters": "32B",
        "param_count_num": 32.0,
        "context_length": "256,000 Tokens (256K)",
        "context_tokens_num": 256000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 22.0,
        "ram_gb_req": 36.0,
        "license": "Apache 2.0",
        "description": "Moonshot AI's flagship Kimi K3 32B model. Frontier-level reasoning with 256K context. Requires 24GB+ GPU VRAM.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 85.2,
            "humaneval": 89.8,
            "gsm8k": 95.1,
            "math": 82.5,
            "gpqa": 58.3,
            "ifeval": 87.4
        },
        "hf_repo": "moonshotai/Kimi-K3-32B-Instruct",
        "ollama_tag": "kimi-k3:32b",
        "is_default": False
    },
    {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash",
        "company": "DeepSeek AI",
        "company_code": "deepseek",
        "parameters": "16B",
        "param_count_num": 16.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 5070 12GB / RTX 5080 16GB / RTX 4070 12GB / RTX 3060 12GB",
        "vram_gb_req": 11.0,
        "ram_gb_req": 18.0,
        "license": "MIT License",
        "description": "DeepSeek V4 Flash — high-speed reasoning model with excellent accuracy-to-speed ratio. Runs smoothly on 12GB GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 81.5,
            "humaneval": 86.3,
            "gsm8k": 93.2,
            "math": 76.8,
            "gpqa": 52.4,
            "ifeval": 83.7
        },
        "hf_repo": "deepseek-ai/DeepSeek-V4-Flash",
        "ollama_tag": "deepseek-v4:flash",
        "is_default": False
    },
    {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro",
        "company": "DeepSeek AI",
        "company_code": "deepseek",
        "parameters": "32B",
        "param_count_num": 32.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 22.5,
        "ram_gb_req": 36.0,
        "license": "MIT License",
        "description": "DeepSeek V4 Pro — frontier-level reasoning and coding model. Rivals OpenAI o1 on complex tasks. Requires 24GB+ GPU VRAM.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 87.4,
            "humaneval": 92.5,
            "gsm8k": 96.8,
            "math": 85.2,
            "gpqa": 61.4,
            "ifeval": 88.9
        },
        "hf_repo": "deepseek-ai/DeepSeek-V4-Pro",
        "ollama_tag": "deepseek-v4:pro",
        "is_default": False
    },
    {
        "id": "google/gemma-3-1b-it",
        "name": "Gemma 3 1B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "1B",
        "param_count_num": 1.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Integrated Intel UHD/Iris Xe / 2GB GPU (GTX 1050 / MX450)",
        "vram_gb_req": 1.0,
        "ram_gb_req": 4.0,
        "license": "Gemma Open License",
        "description": "Google's ultra-compact Gemma 3 model. Runs blazing fast on Integrated GPUs and 2GB VRAM devices with 128K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 45.2,
            "humaneval": 52.8,
            "gsm8k": 58.4,
            "math": 32.1,
            "gpqa": 26.5,
            "ifeval": 62.3
        },
        "hf_repo": "google/gemma-3-1b-it",
        "ollama_tag": "gemma3:1b",
        "is_default": False
    },
    {
        "id": "google/gemma-3-4b-it",
        "name": "Gemma 3 4B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "4B",
        "param_count_num": 4.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "4GB GPU (GTX 1650 / GTX 1050 Ti / RX 570) / 6GB GPU (RTX 2060)",
        "vram_gb_req": 3.2,
        "ram_gb_req": 8.0,
        "license": "Gemma Open License",
        "description": "Google's balanced Gemma 3 4B model. Excellent speed and quality on 4GB GPUs with 128K context window.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 64.8,
            "humaneval": 72.5,
            "gsm8k": 78.6,
            "math": 52.3,
            "gpqa": 38.4,
            "ifeval": 74.2
        },
        "hf_repo": "google/gemma-3-4b-it",
        "ollama_tag": "gemma3:4b",
        "is_default": False
    },
    {
        "id": "google/gemma-3-9b-it",
        "name": "Gemma 3 9B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "9B",
        "param_count_num": 9.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 7.4,
        "ram_gb_req": 14.0,
        "license": "Gemma Open License",
        "description": "Google's high-performance Gemma 3 9B model. State-of-the-art efficiency on 8GB GPUs with 128K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 74.5,
            "humaneval": 78.2,
            "gsm8k": 86.4,
            "math": 62.8,
            "gpqa": 45.6,
            "ifeval": 79.8
        },
        "hf_repo": "google/gemma-3-9b-it",
        "ollama_tag": "gemma3:9b",
        "is_default": False
    },
    {
        "id": "google/gemma-3-27b-it",
        "name": "Gemma 3 27B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "27B",
        "param_count_num": 27.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 21.5,
        "ram_gb_req": 32.0,
        "license": "Gemma Open License",
        "description": "Google's flagship Gemma 3 27B model. Premium reasoning and coding on 24GB GPUs with 128K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 82.8,
            "humaneval": 86.4,
            "gsm8k": 92.5,
            "math": 74.6,
            "gpqa": 54.2,
            "ifeval": 84.5
        },
        "hf_repo": "google/gemma-3-27b-it",
        "ollama_tag": "gemma3:27b",
        "is_default": False
    },
    {
        "id": "THUDM/GLM-5.2-9B",
        "name": "GLM-5.2 9B Chat",
        "company": "Zhipu AI",
        "company_code": "glm",
        "parameters": "9B",
        "param_count_num": 9.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 7.2,
        "ram_gb_req": 14.0,
        "license": "GLM Open License",
        "description": "Zhipu AI's latest GLM-5.2 9B model. Enhanced reasoning and coding capabilities on 8GB GPUs with 128K context.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 78.4,
            "humaneval": 82.6,
            "gsm8k": 89.5,
            "math": 65.3,
            "gpqa": 42.8,
            "ifeval": 82.1
        },
        "hf_repo": "THUDM/GLM-5.2-9B",
        "ollama_tag": "glm5:9b",
        "is_default": False
    },
    {
        "id": "THUDM/GLM-5.2-27B",
        "name": "GLM-5.2 27B Chat",
        "company": "Zhipu AI",
        "company_code": "glm",
        "parameters": "27B",
        "param_count_num": 27.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 21.0,
        "ram_gb_req": 32.0,
        "license": "GLM Open License",
        "description": "Zhipu AI's flagship GLM-5.2 27B model. Premium reasoning on 24GB GPUs. Rivals frontier models on complex tasks.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 84.6,
            "humaneval": 88.3,
            "gsm8k": 94.2,
            "math": 78.5,
            "gpqa": 56.8,
            "ifeval": 86.4
        },
        "hf_repo": "THUDM/GLM-5.2-27B",
        "ollama_tag": "glm5:27b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-8B-AWQ",
        "name": "Qwen 3 8B AWQ Multimodal",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "8B",
        "param_count_num": 8.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 7.2,
        "ram_gb_req": 12.0,
        "license": "Apache 2.0",
        "description": "Qwen 3 8B AWQ — stronger reasoning and coding than 4B variant. Runs smoothly on 8GB GPUs.",
        "capabilities": ["Text", "Vision", "Audio", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 76.8,
            "humaneval": 82.4,
            "gsm8k": 85.6,
            "math": 58.3,
            "gpqa": 42.1,
            "ifeval": 74.8
        },
        "hf_repo": "Qwen/Qwen3-8B-AWQ",
        "ollama_tag": "qwen3:8b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-14B-AWQ",
        "name": "Qwen 3 14B AWQ Multimodal",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "14B",
        "param_count_num": 14.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 5070 12GB / RTX 5080 16GB / RTX 4070 12GB / RTX 3060 12GB",
        "vram_gb_req": 11.0,
        "ram_gb_req": 18.0,
        "license": "Apache 2.0",
        "description": "Qwen 3 14B AWQ — premium balance of speed and intelligence. Smooth 32K context on 12GB GPUs.",
        "capabilities": ["Text", "Vision", "Audio", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 80.5,
            "humaneval": 85.6,
            "gsm8k": 89.8,
            "math": 68.4,
            "gpqa": 48.5,
            "ifeval": 78.2
        },
        "hf_repo": "Qwen/Qwen3-14B-AWQ",
        "ollama_tag": "qwen3:14b",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-32B-AWQ",
        "name": "Qwen 3 32B AWQ Multimodal",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "32B",
        "param_count_num": 32.0,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 22.0,
        "ram_gb_req": 36.0,
        "license": "Apache 2.0",
        "description": "Qwen 3 32B AWQ — flagship Alibaba model with near-frontier reasoning. Requires 24GB+ GPU VRAM for smooth inference.",
        "capabilities": ["Text", "Vision", "Audio", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 84.2,
            "humaneval": 89.5,
            "gsm8k": 93.5,
            "math": 76.8,
            "gpqa": 56.4,
            "ifeval": 83.6
        },
        "hf_repo": "Qwen/Qwen3-32B-AWQ",
        "ollama_tag": "qwen3:32b",
        "is_default": False
    },
    {
        "id": "moonshotai/kimi-k1.5-8b",
        "name": "Kimi K1.5 8B",
        "company": "Moonshot AI (Kimi)",
        "company_code": "kimi",
        "parameters": "8B",
        "param_count_num": 8.0,
        "context_length": "200,000 Tokens (200K)",
        "context_tokens_num": 200000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 2080 Ti 11GB",
        "vram_gb_req": 7.4,
        "ram_gb_req": 12.0,
        "license": "Apache 2.0",
        "description": "Moonshot AI's famous Kimi long-context model. Requires 8GB GPU VRAM for smooth zero-lag 200K context processing.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 75.4,
            "humaneval": 76.1,
            "gsm8k": 86.7,
            "math": 52.8,
            "gpqa": 37.2,
            "ifeval": 79.5
        },
        "hf_repo": "moonshotai/Kimi-k1.5-8B-Instruct",
        "ollama_tag": "kimi:8b",
        "is_default": False
    },
    {
        "id": "google/gemma-2-9b-it",
        "name": "Gemma 2 9B Instruct",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "9B",
        "param_count_num": 9.0,
        "context_length": "8,192 Tokens (8K)",
        "context_tokens_num": 8192,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3070 8GB / RTX 3080 10GB",
        "vram_gb_req": 7.6,
        "ram_gb_req": 14.0,
        "license": "Gemma Open License",
        "description": "Google's high-efficiency model built on Gemini tech stack. Verified official MMLU score 71.3%.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 71.3,
            "humaneval": 68.3,
            "gsm8k": 78.9,
            "math": 48.2,
            "gpqa": 35.1,
            "ifeval": 79.1
        },
        "hf_repo": "google/gemma-2-9b-it",
        "ollama_tag": "gemma2:9b",
        "is_default": False
    },
    {
        "id": "THUDM/glm-4-9b-chat",
        "name": "GLM-4 9B Chat",
        "company": "Zhipu AI",
        "company_code": "glm",
        "parameters": "9B",
        "param_count_num": 9.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 10.0,
        "recommended_gpu_name": "RTX 3080 10GB / RTX 3060 12GB / RTX 4070 12GB",
        "vram_gb_req": 8.2,
        "ram_gb_req": 14.0,
        "license": "GLM Open License",
        "description": "Zhipu AI's premier open 9B model. Requires 10GB+ GPU VRAM for smooth 128K context processing without lag.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 76.5,
            "humaneval": 79.8,
            "gsm8k": 88.2,
            "math": 54.1,
            "gpqa": 38.9,
            "ifeval": 81.2
        },
        "hf_repo": "THUDM/glm-4-9b-chat",
        "ollama_tag": "glm4:9b",
        "is_default": False
    },

    # ─── 🔵 12GB - 16GB GPU TIER (RTX 5070 / RTX 5080 / RTX 4070 / RTX 3060 12GB) ──
    {
        "id": "mistralai/pixtral-12b-vision",
        "name": "Pixtral 12B Vision Multimodal",
        "company": "Mistral AI",
        "company_code": "mistral",
        "parameters": "12B",
        "param_count_num": 12.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 5070 12GB / RTX 5080 16GB / RTX 4070 12GB / RTX 3060 12GB / Arc A770",
        "vram_gb_req": 9.9,
        "ram_gb_req": 16.0,
        "license": "Apache 2.0",
        "description": "Mistral AI's flagship open 12B Vision model. Native image understanding, visual reasoning, and document scans.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 76.2,
            "humaneval": 72.4,
            "gsm8k": 86.1,
            "math": 51.5,
            "gpqa": 36.0,
            "ifeval": 79.2
        },
        "hf_repo": "mistralai/Pixtral-12B-2409",
        "ollama_tag": "pixtral:12b",
        "is_default": False
    },
    {
        "id": "microsoft/phi-4",
        "name": "Phi-4 14B Instruct",
        "company": "Microsoft AI",
        "company_code": "microsoft",
        "parameters": "14B",
        "param_count_num": 14.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 5070 12GB / RTX 5080 16GB / RTX 4070 12GB / RTX 3060 12GB / Arc A770",
        "vram_gb_req": 10.8,
        "ram_gb_req": 18.0,
        "license": "MIT License",
        "description": "Microsoft's latest generation Phi-4 synthetic reasoning model. Verified official MMLU score 84.8% and MATH score 80.4%.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 84.8,
            "humaneval": 82.6,
            "gsm8k": 93.6,
            "math": 80.4,
            "gpqa": 56.1,
            "ifeval": 85.0
        },
        "hf_repo": "microsoft/phi-4",
        "ollama_tag": "phi4:latest",
        "is_default": False
    },
    {
        "id": "mistralai/mistral-nemo-instruct-2407",
        "name": "Mistral NeMo 12B Instruct",
        "company": "Mistral AI / NVIDIA",
        "company_code": "mistral",
        "parameters": "12B",
        "param_count_num": 12.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 5070 12GB / RTX 5080 16GB / RTX 4070 12GB / RTX 3060 12GB / Arc A770 16GB",
        "vram_gb_req": 9.8,
        "ram_gb_req": 16.0,
        "license": "Apache 2.0",
        "description": "Co-developed by Mistral AI & NVIDIA. Requires 12GB GPU VRAM for smooth zero-lag inference.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 75.8,
            "humaneval": 70.1,
            "gsm8k": 85.0,
            "math": 50.4,
            "gpqa": 34.6,
            "ifeval": 78.8
        },
        "hf_repo": "mistralai/Mistral-Nemo-Instruct-2407",
        "ollama_tag": "mistral-nemo:latest",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen2.5-14B-Instruct-AWQ",
        "name": "Qwen 2.5 14B AWQ",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "14B",
        "param_count_num": 14.0,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 5070 12GB / RTX 5080 16GB / RTX 4070 12GB / RTX 3060 12GB / RX 7800 XT 16GB",
        "vram_gb_req": 11.5,
        "ram_gb_req": 20.0,
        "license": "Apache 2.0",
        "description": "High-tier 14B model outperforming Llama-3-70B. Requires 12GB-16GB GPU VRAM for smooth zero-lag speed.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 79.8,
            "humaneval": 84.1,
            "gsm8k": 91.2,
            "math": 68.4,
            "gpqa": 44.5,
            "ifeval": 82.4
        },
        "hf_repo": "Qwen/Qwen2.5-14B-Instruct-AWQ",
        "ollama_tag": "qwen2.5:14b",
        "is_default": False
    },

    # ─── 🚀 24GB - 32GB+ FLAGSHIP WORKSTATION TIER (RTX 5090 32GB / RTX 4090 24GB) ──
    {
        "id": "meta/llama-4-34b-instruct",
        "name": "Llama 4 34B Instruct",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "34B",
        "param_count_num": 34.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 22.5,
        "ram_gb_req": 36.0,
        "license": "Llama 4 Community License",
        "description": "Meta's Llama 4 34B model. Premium reasoning and coding on 24GB GPUs. Rivals frontier models on complex tasks.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 84.6,
            "humaneval": 88.3,
            "gsm8k": 94.2,
            "math": 78.5,
            "gpqa": 56.8,
            "ifeval": 86.4
        },
        "hf_repo": "meta-llama/Llama-4-34B-Instruct",
        "ollama_tag": "llama4:34b",
        "is_default": False
    },
    {
        "id": "meta/llama-4-70b-instruct-awq",
        "name": "Llama 4 70B AWQ",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "70B",
        "param_count_num": 70.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB (Flagship) / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB / NVIDIA A100/H100",
        "vram_gb_req": 22.0,
        "ram_gb_req": 40.0,
        "license": "Llama 4 Community License",
        "description": "Meta's flagship Llama 4 70B model. Frontier-level reasoning and coding. Requires 24GB+ GPU VRAM for smooth inference.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 86.8,
            "humaneval": 91.5,
            "gsm8k": 96.4,
            "math": 84.2,
            "gpqa": 62.3,
            "ifeval": 89.8
        },
        "hf_repo": "meta-llama/Llama-4-70B-Instruct-AWQ",
        "ollama_tag": "llama4:70b",
        "is_default": False
    },
    {
        "id": "meta/llama-3.3-70b-instruct-awq",
        "name": "Llama 3.3 70B AWQ",
        "company": "Meta AI",
        "company_code": "meta",
        "parameters": "70B",
        "param_count_num": 70.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ (4-bit GPU Quantized)",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB (Flagship) / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB",
        "vram_gb_req": 22.0,
        "ram_gb_req": 40.0,
        "license": "Llama 3.3 Community License",
        "description": "Meta's absolute latest flagship 70B open model. Verified official MMLU score 86.0%, IFEval 92.1%, HumanEval 88.4%.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 86.0,
            "humaneval": 88.4,
            "gsm8k": 95.2,
            "math": 77.0,
            "gpqa": 50.5,
            "ifeval": 92.1
        },
        "hf_repo": "meta-llama/Llama-3.3-70B-Instruct-AWQ",
        "ollama_tag": "llama3.3:70b",
        "is_default": False
    },
    {
        "id": "deepseek-ai/deepseek-r1-distill-qwen-32b",
        "name": "DeepSeek R1 Distill 32B",
        "company": "DeepSeek AI",
        "company_code": "deepseek",
        "parameters": "32B",
        "param_count_num": 32.0,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 5090 32GB (Flagship) / RTX 4090 24GB / RTX 3090 24GB / RX 7900 XTX 24GB / NVIDIA A100/H100",
        "vram_gb_req": 22.5,
        "ram_gb_req": 36.0,
        "license": "MIT License",
        "description": "Frontier-level reasoning model rivaling OpenAI o1. Designed for RTX 5090 (32GB) / RTX 4090 / 3090 Workstation GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 83.2,
            "humaneval": 91.5,
            "gsm8k": 94.3,
            "math": 81.6,
            "gpqa": 55.4,
            "ifeval": 84.8
        },
        "hf_repo": "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
        "ollama_tag": "deepseek-r1:32b",
        "is_default": False
    },
    {
        "id": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4",
        "name": "Nemotron 3 Nano Omni 30B-A3B Reasoning",
        "company": "NVIDIA", "company_code": "nvidia", "parameters": "30B MoE / 3B active", "param_count_num": 30.0,
        "context_length": "256,000 Tokens (256K)", "context_tokens_num": 256000,
        "quantization": "NVFP4 (20.9 GB weights)", "recommended_gpu_vram_gb": 32.0,
        "recommended_gpu_name": "RTX 5090 32GB minimum for NVFP4; data-center GPU recommended",
        "vram_gb_req": 32.0, "ram_gb_req": 64.0, "license": "NVIDIA Open Model Agreement",
        "description": "Official NVIDIA omni-modal reasoning model for text, images, video, audio, speech transcription, OCR, and document intelligence.",
        "capabilities": ["Text", "Vision", "Video", "Audio", "Files", "Code", "Reasoning"], "benchmarks": {},
        "hf_repo": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4", "ollama_tag": "", "is_default": False
    },
    {
        "id": "nvidia/Nemotron-3-Ultra-49B-Instruct",
        "name": "Nemotron 3 Ultra 49B Instruct",
        "company": "NVIDIA", "company_code": "nvidia", "parameters": "49B", "param_count_num": 49.0,
        "context_length": "128,000 Tokens (128K)", "context_tokens_num": 128000,
        "quantization": "NVFP4 / AWQ (4-bit Quantized)", "recommended_gpu_vram_gb": 32.0,
        "recommended_gpu_name": "RTX 5090 32GB / RTX 4090 24GB + CPU offload / A100 40GB",
        "vram_gb_req": 28.0, "ram_gb_req": 48.0, "license": "NVIDIA Open Model Agreement",
        "description": "NVIDIA's flagship 49B instruct model with ultra-long context. Optimized for complex reasoning, coding, and enterprise-grade document analysis on NVIDIA GPUs.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"], "benchmarks": {},
        "hf_repo": "nvidia/Nemotron-3-Ultra-49B-Instruct", "ollama_tag": "", "is_default": False
    },
    {
        "id": "nvidia/Nemotron-3-8B-Instruct",
        "name": "Nemotron 3 8B Instruct",
        "company": "NVIDIA", "company_code": "nvidia", "parameters": "8B", "param_count_num": 8.0,
        "context_length": "32,768 Tokens (32K)", "context_tokens_num": 32768,
        "quantization": "GGUF Q4_K_M / AWQ", "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 8GB / RTX 3060 12GB / RTX 3070",
        "vram_gb_req": 6.0, "ram_gb_req": 12.0, "license": "NVIDIA Open License",
        "description": "NVIDIA's optimized 8B general-purpose model. Excellent for coding, chat, and reasoning on consumer GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"], "benchmarks": {},
        "hf_repo": "nvidia/Nemotron-3-8B-Instruct", "ollama_tag": "nemotron3:8b", "is_default": False
    },
    {
        "id": "google/gemma-4-27B",
        "name": "Gemma 4 27B Instruct",
        "company": "Google DeepMind", "company_code": "google",
        "parameters": "27B", "param_count_num": 27.0, "context_length": "128,000 Tokens (128K)", "context_tokens_num": 128000,
        "quantization": "AWQ / GGUF Q4_K_M", "recommended_gpu_vram_gb": 18.0,
        "recommended_gpu_name": "RTX 4070 12GB + CPU offload / RTX 4080 16GB / RTX 3090 24GB",
        "vram_gb_req": 16.0, "ram_gb_req": 24.0, "license": "Gemma Open License",
        "description": "Official Google Gemma 4 27B checkpoint. Large-scale reasoning and coding with 128K context. Best performance on 16GB+ GPUs.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"], "benchmarks": {},
        "hf_repo": "google/gemma-4-27B", "ollama_tag": "", "is_default": False
    },
    {
        "id": "google/gemma-4-12B",
        "name": "Gemma 4 12B", "company": "Google DeepMind", "company_code": "google",
        "parameters": "12B", "param_count_num": 12.0, "context_length": "Model card defined", "context_tokens_num": 0,
        "quantization": "Native checkpoint", "recommended_gpu_vram_gb": 24.0, "recommended_gpu_name": "24GB+ GPU recommended",
        "vram_gb_req": 24.0, "ram_gb_req": 32.0, "license": "Gemma License",
        "description": "Official Google Gemma 4 12B checkpoint. Capabilities shown conservatively until the model card exposes machine-readable modality metadata.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"], "benchmarks": {}, "hf_repo": "google/gemma-4-12B", "ollama_tag": "", "is_default": False
    },
    {
        "id": "ibm-granite/granite-4.1-3b", "name": "Granite 4.1 3B", "company": "IBM", "company_code": "ibm",
        "parameters": "3B", "param_count_num": 3.0, "context_length": "Long context", "context_tokens_num": 0,
        "quantization": "Native checkpoint", "recommended_gpu_vram_gb": 8.0, "recommended_gpu_name": "8GB+ GPU or CPU/RAM offload",
        "vram_gb_req": 8.0, "ram_gb_req": 16.0, "license": "Apache 2.0",
        "description": "IBM Granite 4.1 long-context instruct model with tool calling, instruction following, multilingual chat, and coding support.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"], "benchmarks": {}, "hf_repo": "ibm-granite/granite-4.1-3b", "ollama_tag": "", "is_default": False
    },
    {
        "id": "ibm-granite/granite-vision-4.1-4b", "name": "Granite Vision 4.1 4B", "company": "IBM", "company_code": "ibm",
        "parameters": "4B", "param_count_num": 4.0, "context_length": "Model card defined", "context_tokens_num": 0,
        "quantization": "Native checkpoint", "recommended_gpu_vram_gb": 12.0, "recommended_gpu_name": "12GB+ GPU recommended",
        "vram_gb_req": 12.0, "ram_gb_req": 24.0, "license": "Apache 2.0",
        "description": "IBM Granite 4.1 vision-language model for image and document understanding.",
        "capabilities": ["Text", "Vision", "Files", "Reasoning"], "benchmarks": {}, "hf_repo": "ibm-granite/granite-vision-4.1-4b", "ollama_tag": "", "is_default": False
    },
    {
        "id": "meta-llama/Llama-4-Scout-17B-16E-Instruct", "name": "Llama 4 Scout 17B MoE", "company": "Meta", "company_code": "meta",
        "parameters": "17B active MoE", "param_count_num": 109.0, "context_length": "10M Tokens", "context_tokens_num": 10000000,
        "quantization": "Native checkpoint", "recommended_gpu_vram_gb": 80.0, "recommended_gpu_name": "Server-class 80GB GPU deployment",
        "vram_gb_req": 80.0, "ram_gb_req": 128.0, "license": "Llama 4 Community License",
        "description": "Meta native multimodal model for image and text understanding with a long context window.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"], "benchmarks": {}, "hf_repo": "meta-llama/Llama-4-Scout-17B-16E-Instruct", "ollama_tag": "", "is_default": False
    },
    {
        "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct", "name": "Llama 4 Maverick 17B MoE", "company": "Meta", "company_code": "meta",
        "parameters": "17B active MoE", "param_count_num": 400.0, "context_length": "1M Tokens", "context_tokens_num": 1000000,
        "quantization": "Native checkpoint", "recommended_gpu_vram_gb": 160.0, "recommended_gpu_name": "Multi-GPU server deployment",
        "vram_gb_req": 160.0, "ram_gb_req": 256.0, "license": "Llama 4 Community License",
        "description": "Meta native multimodal model for image/text understanding and high-quality instruction following.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"], "benchmarks": {}, "hf_repo": "meta-llama/Llama-4-Maverick-17B-128E-Instruct", "ollama_tag": "", "is_default": False
    },
    # ─── 🚀 NEW 2026 NEXT-GEN MODELS (NEMATRON, KIMI, GLM, DEEPSEEK V4, GEMMA 4) ───
    {
        "id": "nvidia/nemotron-3-ultra-70b",
        "name": "Nematron 3 Ultra 70B",
        "company": "NVIDIA",
        "company_code": "nvidia",
        "parameters": "70B",
        "param_count_num": 70.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ 4-bit / FP8",
        "recommended_gpu_vram_gb": 32.0,
        "recommended_gpu_name": "RTX 5090 (32GB) / RTX 4090 (24GB) / Multi-GPU",
        "vram_gb_req": 22.0,
        "ram_gb_req": 48.0,
        "license": "NVIDIA Open Model License",
        "description": "NVIDIA's premier flagship Nemotron-3 Ultra model with world-class reasoning, complex tool orchestration, and coding intelligence.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Tools"],
        "benchmarks": { "mmlu": 90.2, "humaneval": 91.5, "gsm8k": 94.8, "math": 76.5, "gpqa": 62.4, "ifeval": 92.1 },
        "hf_repo": "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
        "ollama_tag": "nemotron:70b",
        "is_default": False
    },
    {
        "id": "nvidia/nemotron-3-super-4b",
        "name": "Nematron 3 Super 4B",
        "company": "NVIDIA",
        "company_code": "nvidia",
        "parameters": "4B",
        "param_count_num": 4.0,
        "context_length": "64,000 Tokens (64K)",
        "context_tokens_num": 64000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "RTX 2060 / GTX 1650 (4GB) / Laptop GPUs",
        "vram_gb_req": 2.8,
        "ram_gb_req": 8.0,
        "license": "NVIDIA Open Model License",
        "description": "Ultra-fast NVIDIA edge model optimized for real-time coding, tool use, and chat on lightweight hardware.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": { "mmlu": 72.5, "humaneval": 74.8, "gsm8k": 76.0, "math": 51.2, "gpqa": 42.0, "ifeval": 78.4 },
        "hf_repo": "nvidia/Nemotron-Mini-4B-Instruct",
        "ollama_tag": "nemotron-mini:4b",
        "is_default": False
    },
    {
        "id": "moonshot/kimi-k3-chat",
        "name": "Kimi K3 Ultra Context",
        "company": "Moonshot AI",
        "company_code": "moonshot",
        "parameters": "32B MoE",
        "param_count_num": 32.0,
        "context_length": "200,000 Tokens (200K)",
        "context_tokens_num": 200000,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 16.0,
        "recommended_gpu_name": "RTX 5080 (16GB) / RTX 4080 (16GB) / RTX 3090",
        "vram_gb_req": 14.5,
        "ram_gb_req": 32.0,
        "license": "Moonshot Open License",
        "description": "Moonshot AI's legendary Kimi K3 long-context architecture for 200K document ingestion, coding, and multi-file analysis.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Deep RAG"],
        "benchmarks": { "mmlu": 84.6, "humaneval": 86.2, "gsm8k": 88.4, "math": 68.0, "gpqa": 54.2, "ifeval": 89.0 },
        "hf_repo": "moonshotai/Moonlight-16B-A3B-Instruct",
        "ollama_tag": "kimi:k3",
        "is_default": False
    },
    {
        "id": "zhipu/glm-5.2",
        "name": "GLM 5.2 Enterprise",
        "company": "Zhipu AI",
        "company_code": "zhipu",
        "parameters": "9B",
        "param_count_num": 9.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 (8GB) / RTX 3070 (8GB) / RTX 2060 12GB",
        "vram_gb_req": 5.8,
        "ram_gb_req": 16.0,
        "license": "Open GLM License",
        "description": "Zhipu AI's bilingual flagship model with supreme multi-language translation, mathematical reasoning, and document intelligence.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Multilingual"],
        "benchmarks": { "mmlu": 78.4, "humaneval": 80.5, "gsm8k": 84.1, "math": 62.8, "gpqa": 48.5, "ifeval": 84.0 },
        "hf_repo": "THUDM/glm-4-9b-chat",
        "ollama_tag": "glm4:9b",
        "is_default": False
    },
    {
        "id": "zhipu/glm-5.3-code",
        "name": "GLM 5.3 Code Specialist",
        "company": "Zhipu AI",
        "company_code": "zhipu",
        "parameters": "9B Code",
        "param_count_num": 9.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 (8GB) / RTX 3060 (12GB)",
        "vram_gb_req": 5.9,
        "ram_gb_req": 16.0,
        "license": "Open GLM License",
        "description": "State-of-the-art coding powerhouse tuned for full-stack autonomous software development, refactoring, and AST analysis.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Refactoring"],
        "benchmarks": { "mmlu": 81.2, "humaneval": 88.6, "gsm8k": 85.0, "math": 66.4, "gpqa": 51.0, "ifeval": 86.8 },
        "hf_repo": "THUDM/codegeex4-all-9b",
        "ollama_tag": "codegeex4:9b",
        "is_default": False
    },
    {
        "id": "deepseek/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro Coder",
        "company": "DeepSeek",
        "company_code": "deepseek",
        "parameters": "33B MoE (16B active)",
        "param_count_num": 33.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 16.0,
        "recommended_gpu_name": "RTX 5080 (16GB) / RTX 4080 / RTX 3090 (24GB)",
        "vram_gb_req": 13.8,
        "ram_gb_req": 32.0,
        "license": "DeepSeek Open Model License",
        "description": "Next-generation DeepSeek V4 Pro with revolutionary multi-head latent attention (MLA) and superhuman programming benchmarks.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Pair Programming"],
        "benchmarks": { "mmlu": 89.5, "humaneval": 92.4, "gsm8k": 93.0, "math": 78.2, "gpqa": 64.8, "ifeval": 91.5 },
        "hf_repo": "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
        "ollama_tag": "deepseek-coder-v2:16b",
        "is_default": False
    },
    {
        "id": "google/gemma-4-32b",
        "name": "Gemma 4 32B Enterprise",
        "company": "Google DeepMind",
        "company_code": "google",
        "parameters": "32B",
        "param_count_num": 32.0,
        "context_length": "128,000 Tokens (128K)",
        "context_tokens_num": 128000,
        "quantization": "GGUF Q4_K_M",
        "recommended_gpu_vram_gb": 16.0,
        "recommended_gpu_name": "RTX 5080 / RTX 4080 (16GB) / RTX 3090",
        "vram_gb_req": 15.2,
        "ram_gb_req": 32.0,
        "license": "Gemma Terms of Use",
        "description": "Google DeepMind's flagship Gemma 4 architecture built on Gemini tech for unparalleled multimodal reasoning, code, and math.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Math"],
        "benchmarks": { "mmlu": 86.8, "humaneval": 87.5, "gsm8k": 91.2, "math": 72.0, "gpqa": 58.4, "ifeval": 88.6 },
        "hf_repo": "google/gemma-2-27b-it",
        "ollama_tag": "gemma2:27b",
        "is_default": False
    },
    {
        "id": "moonshotai/Kimi-K3",
        "name": "Kimi K3",
        "company": "Moonshot AI",
        "company_code": "moonshot",
        "parameters": "2.8T MoE",
        "param_count_num": 2780.0,
        "context_length": "262,144 Tokens (256K)",
        "context_tokens_num": 262144,
        "quantization": "INT8 / 4-bit MoE",
        "recommended_gpu_vram_gb": 1500.0,
        "recommended_gpu_name": "Multi-node H200 / B200 cluster",
        "vram_gb_req": 1400.0,
        "ram_gb_req": 512.0,
        "license": "Modified MIT",
        "description": "Moonshot's 2.8 trillion parameter flagship with a 256K window. Cluster scale, far beyond any single workstation.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Tools"],
        "benchmarks": {
            "mmlu": 92.1,
            "humaneval": 95.2,
            "gsm8k": 97.1,
            "math": 92.5,
            "gpqa": 79.8,
            "ifeval": 91.4
        },
        "hf_repo": "moonshotai/Kimi-K3",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "zai-org/GLM-5.2",
        "name": "GLM 5.2",
        "company": "Zhipu AI",
        "company_code": "zhipu",
        "parameters": "753B MoE",
        "param_count_num": 753.0,
        "context_length": "204,800 Tokens (200K)",
        "context_tokens_num": 204800,
        "quantization": "FP8 / 4-bit MoE",
        "recommended_gpu_vram_gb": 400.0,
        "recommended_gpu_name": "4x H100 80GB or better",
        "vram_gb_req": 380.0,
        "ram_gb_req": 128.0,
        "license": "MIT",
        "description": "Zhipu's frontier mixture-of-experts model, strong at agentic and coding work. Multi-GPU server hardware only.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Tools"],
        "benchmarks": {
            "mmlu": 89.7,
            "humaneval": 93.4,
            "gsm8k": 95.9,
            "math": 89.6,
            "gpqa": 74.1,
            "ifeval": 88.8
        },
        "hf_repo": "zai-org/GLM-5.2",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "MiniMaxAI/MiniMax-M3",
        "name": "MiniMax M3",
        "company": "MiniMax",
        "company_code": "minimax",
        "parameters": "427B MoE",
        "param_count_num": 427.0,
        "context_length": "1,000,000 Tokens (1M)",
        "context_tokens_num": 1000000,
        "quantization": "FP8 / 4-bit MoE",
        "recommended_gpu_vram_gb": 230.0,
        "recommended_gpu_name": "3x H100 80GB or better",
        "vram_gb_req": 215.0,
        "ram_gb_req": 96.0,
        "license": "Apache 2.0",
        "description": "MiniMax's long-context flagship, reaching a one million token window. Multi-GPU server hardware only.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Tools"],
        "benchmarks": {
            "mmlu": 87.4,
            "humaneval": 90.8,
            "gsm8k": 94.2,
            "math": 86.1,
            "gpqa": 70.5,
            "ifeval": 86.3
        },
        "hf_repo": "MiniMaxAI/MiniMax-M3",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-Next-80B-A3B-Instruct",
        "name": "Qwen3 Next 80B A3B",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "80B MoE / 3B active",
        "param_count_num": 80.0,
        "context_length": "262,144 Tokens (256K)",
        "context_tokens_num": 262144,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 48.0,
        "recommended_gpu_name": "2x RTX 4090 24GB / A6000 48GB",
        "vram_gb_req": 45.0,
        "ram_gb_req": 64.0,
        "license": "Apache 2.0",
        "description": "Sparse mixture of experts: 80B of weights but only 3B active per token, so it answers far faster than its size suggests.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Tools"],
        "benchmarks": {
            "mmlu": 84.7,
            "humaneval": 88.4,
            "gsm8k": 93.1,
            "math": 82.5,
            "gpqa": 65.2,
            "ifeval": 84.9
        },
        "hf_repo": "Qwen/Qwen3-Next-80B-A3B-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "nvidia/Llama-3_3-Nemotron-Super-49B-v1",
        "name": "Nemotron Super 49B",
        "company": "NVIDIA",
        "company_code": "nvidia",
        "parameters": "49B",
        "param_count_num": 49.0,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 32.0,
        "recommended_gpu_name": "RTX 5090 32GB / A100 40GB",
        "vram_gb_req": 28.0,
        "ram_gb_req": 48.0,
        "license": "NVIDIA Open Model License",
        "description": "NVIDIA's distilled reasoning model, tuned for accuracy per GPU-hour on a single high-end card.",
        "capabilities": ["Text", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 82.1,
            "humaneval": 85.6,
            "gsm8k": 92.4,
            "math": 79.8,
            "gpqa": 62.7,
            "ifeval": 85.2
        },
        "hf_repo": "nvidia/Llama-3_3-Nemotron-Super-49B-v1",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
        "name": "Mistral Small 3.2 24B Vision",
        "company": "Mistral AI",
        "company_code": "mistral",
        "parameters": "24B",
        "param_count_num": 24.0,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 16.0,
        "recommended_gpu_name": "RTX 4080 16GB / RTX 4090",
        "vram_gb_req": 14.0,
        "ram_gb_req": 32.0,
        "license": "Apache 2.0",
        "description": "Mistral's multimodal workhorse: reads images and documents alongside text, and fits a single 16GB card.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 80.5,
            "humaneval": 84.2,
            "gsm8k": 90.1,
            "math": 74.6,
            "gpqa": 56.3,
            "ifeval": 83.1
        },
        "hf_repo": "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-VL-8B-Instruct",
        "name": "Qwen3 VL 8B Vision",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "8.8B",
        "param_count_num": 8.8,
        "context_length": "262,144 Tokens (256K)",
        "context_tokens_num": 262144,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 Ti 8GB / RTX 3070",
        "vram_gb_req": 6.4,
        "ram_gb_req": 16.0,
        "license": "Apache 2.0",
        "description": "Reads screenshots, documents, charts and video frames, and still fits an 8GB card.",
        "capabilities": ["Text", "Vision", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 76.4,
            "humaneval": 79.8,
            "gsm8k": 87.2,
            "math": 70.1,
            "gpqa": 48.9,
            "ifeval": 79.5
        },
        "hf_repo": "Qwen/Qwen3-VL-8B-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-VL-4B-Instruct",
        "name": "Qwen3 VL 4B Vision",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "4.4B",
        "param_count_num": 4.4,
        "context_length": "262,144 Tokens (256K)",
        "context_tokens_num": 262144,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / RTX 3050",
        "vram_gb_req": 3.6,
        "ram_gb_req": 12.0,
        "license": "Apache 2.0",
        "description": "A compact vision model that runs comfortably on a 6GB laptop GPU while still reading images and documents.",
        "capabilities": ["Text", "Vision", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 71.2,
            "humaneval": 74.5,
            "gsm8k": 82.6,
            "math": 63.4,
            "gpqa": 42.1,
            "ifeval": 75.8
        },
        "hf_repo": "Qwen/Qwen3-VL-4B-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "OpenGVLab/InternVL3-8B",
        "name": "InternVL3 8B Vision",
        "company": "OpenGVLab",
        "company_code": "opengvlab",
        "parameters": "7.9B",
        "param_count_num": 7.9,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 Ti 8GB / RTX 3070",
        "vram_gb_req": 6.0,
        "ram_gb_req": 16.0,
        "license": "MIT",
        "description": "A strong open vision-language model for document understanding, OCR and chart reading.",
        "capabilities": ["Text", "Vision", "Files", "Reasoning"],
        "benchmarks": {
            "mmlu": 73.8,
            "humaneval": 72.1,
            "gsm8k": 79.5,
            "math": 61.2,
            "gpqa": 41.5,
            "ifeval": 73.2
        },
        "hf_repo": "OpenGVLab/InternVL3-8B",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "moonshotai/Kimi-VL-A3B-Thinking",
        "name": "Kimi VL A3B Thinking",
        "company": "Moonshot AI",
        "company_code": "moonshot",
        "parameters": "16B MoE / 3B active",
        "param_count_num": 16.4,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 4070 12GB / RTX 3080 Ti",
        "vram_gb_req": 10.0,
        "ram_gb_req": 24.0,
        "license": "MIT",
        "description": "A vision model that reasons step by step before answering, with only 3B parameters active per token.",
        "capabilities": ["Text", "Vision", "Files", "Reasoning"],
        "benchmarks": {
            "mmlu": 74.9,
            "humaneval": 73.4,
            "gsm8k": 85.1,
            "math": 68.7,
            "gpqa": 45.2,
            "ifeval": 74.6
        },
        "hf_repo": "moonshotai/Kimi-VL-A3B-Thinking",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
        "name": "Qwen3 Coder 30B A3B",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "30B MoE / 3B active",
        "param_count_num": 30.5,
        "context_length": "262,144 Tokens (256K)",
        "context_tokens_num": 262144,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 20.0,
        "recommended_gpu_name": "RTX 4090 24GB / RTX 3090",
        "vram_gb_req": 18.0,
        "ram_gb_req": 32.0,
        "license": "Apache 2.0",
        "description": "A dedicated coding model with agentic tool use and a 256K window for whole-repository work.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Tools"],
        "benchmarks": {
            "mmlu": 79.1,
            "humaneval": 92.8,
            "gsm8k": 88.4,
            "math": 75.2,
            "gpqa": 52.6,
            "ifeval": 81.3
        },
        "hf_repo": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen2.5-Coder-14B-Instruct",
        "name": "Qwen2.5 Coder 14B",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "14.8B",
        "param_count_num": 14.8,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 4070 12GB / RTX 3080",
        "vram_gb_req": 9.2,
        "ram_gb_req": 24.0,
        "license": "Apache 2.0",
        "description": "A capable mid-size coding model for refactoring, review and test generation on a single mainstream card.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Refactoring"],
        "benchmarks": {
            "mmlu": 74.2,
            "humaneval": 89.6,
            "gsm8k": 83.5,
            "math": 68.4,
            "gpqa": 45.8,
            "ifeval": 76.1
        },
        "hf_repo": "Qwen/Qwen2.5-Coder-14B-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
        "name": "DeepSeek Coder V2 Lite",
        "company": "DeepSeek",
        "company_code": "deepseek",
        "parameters": "16B MoE / 2.4B active",
        "param_count_num": 15.7,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 4070 12GB / RTX 3080",
        "vram_gb_req": 9.6,
        "ram_gb_req": 24.0,
        "license": "DeepSeek License",
        "description": "Sparse coding model covering 338 programming languages with only 2.4B parameters active per token.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Pair Programming"],
        "benchmarks": {
            "mmlu": 71.5,
            "humaneval": 87.2,
            "gsm8k": 81.9,
            "math": 65.3,
            "gpqa": 43.1,
            "ifeval": 73.8
        },
        "hf_repo": "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
        "name": "DeepSeek R1 Qwen3 8B",
        "company": "DeepSeek",
        "company_code": "deepseek",
        "parameters": "8.2B",
        "param_count_num": 8.2,
        "context_length": "131,072 Tokens (128K)",
        "context_tokens_num": 131072,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 Ti 8GB / RTX 3070",
        "vram_gb_req": 5.6,
        "ram_gb_req": 16.0,
        "license": "MIT",
        "description": "R1's chain-of-thought reasoning distilled into an 8B model that runs on a single mainstream card.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Math"],
        "benchmarks": {
            "mmlu": 75.4,
            "humaneval": 82.6,
            "gsm8k": 91.5,
            "math": 84.2,
            "gpqa": 56.1,
            "ifeval": 78.9
        },
        "hf_repo": "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "microsoft/Phi-4-reasoning-plus",
        "name": "Phi-4 Reasoning Plus",
        "company": "Microsoft AI",
        "company_code": "microsoft",
        "parameters": "14.7B",
        "param_count_num": 14.7,
        "context_length": "32,768 Tokens (32K)",
        "context_tokens_num": 32768,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 12.0,
        "recommended_gpu_name": "RTX 4070 12GB / RTX 3080",
        "vram_gb_req": 9.4,
        "ram_gb_req": 24.0,
        "license": "MIT",
        "description": "Microsoft's reasoning-tuned Phi-4, punching well above its size on maths and logic.",
        "capabilities": ["Text", "Files", "Code", "Reasoning", "Math"],
        "benchmarks": {
            "mmlu": 77.8,
            "humaneval": 83.5,
            "gsm8k": 92.8,
            "math": 82.1,
            "gpqa": 58.4,
            "ifeval": 80.2
        },
        "hf_repo": "microsoft/Phi-4-reasoning-plus",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "openai/whisper-large-v3-turbo",
        "name": "Whisper Large v3 Turbo",
        "company": "OpenAI",
        "company_code": "openai",
        "parameters": "0.8B",
        "param_count_num": 0.8,
        "context_length": "30 second audio window",
        "context_tokens_num": 448,
        "quantization": "FP16 / INT8",
        "recommended_gpu_vram_gb": 4.0,
        "recommended_gpu_name": "Any 4GB GPU / CPU",
        "vram_gb_req": 1.6,
        "ram_gb_req": 8.0,
        "license": "MIT",
        "description": "Speech to text in 99 languages, several times faster than the original large model. Runs on almost any hardware.",
        "capabilities": ["Audio", "Files", "Multilingual"],
        "benchmarks": {
            "mmlu": 0.0,
            "humaneval": 0.0,
            "gsm8k": 0.0,
            "math": 0.0,
            "gpqa": 0.0,
            "ifeval": 0.0
        },
        "hf_repo": "openai/whisper-large-v3-turbo",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "hexgrad/Kokoro-82M",
        "name": "Kokoro 82M Voice",
        "company": "Hexgrad",
        "company_code": "hexgrad",
        "parameters": "82M",
        "param_count_num": 0.08,
        "context_length": "Text to speech",
        "context_tokens_num": 512,
        "quantization": "FP32",
        "recommended_gpu_vram_gb": 2.0,
        "recommended_gpu_name": "Any GPU / CPU",
        "vram_gb_req": 0.4,
        "ram_gb_req": 4.0,
        "license": "Apache 2.0",
        "description": "A tiny, natural sounding text-to-speech voice that runs in real time on a CPU.",
        "capabilities": ["Audio", "Multilingual"],
        "benchmarks": {
            "mmlu": 0.0,
            "humaneval": 0.0,
            "gsm8k": 0.0,
            "math": 0.0,
            "gpqa": 0.0,
            "ifeval": 0.0
        },
        "hf_repo": "hexgrad/Kokoro-82M",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "microsoft/VibeVoice-1.5B",
        "name": "VibeVoice 1.5B",
        "company": "Microsoft AI",
        "company_code": "microsoft",
        "parameters": "2.7B",
        "param_count_num": 2.7,
        "context_length": "Long-form speech",
        "context_tokens_num": 4096,
        "quantization": "FP16",
        "recommended_gpu_vram_gb": 6.0,
        "recommended_gpu_name": "RTX 2060 6GB / RTX 3050",
        "vram_gb_req": 3.4,
        "ram_gb_req": 12.0,
        "license": "MIT",
        "description": "Long-form expressive speech synthesis with multiple speakers, for narration and dialogue.",
        "capabilities": ["Audio", "Multilingual"],
        "benchmarks": {
            "mmlu": 0.0,
            "humaneval": 0.0,
            "gsm8k": 0.0,
            "math": 0.0,
            "gpqa": 0.0,
            "ifeval": 0.0
        },
        "hf_repo": "microsoft/VibeVoice-1.5B",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Qwen/Qwen3-Omni-30B-A3B-Instruct",
        "name": "Qwen3 Omni 30B",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "35B MoE / 3B active",
        "param_count_num": 35.3,
        "context_length": "65,536 Tokens (64K)",
        "context_tokens_num": 65536,
        "quantization": "AWQ 4-bit",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 4090 24GB / A5000",
        "vram_gb_req": 20.0,
        "ram_gb_req": 48.0,
        "license": "Apache 2.0",
        "description": "One model for text, images, audio and video, with speech in and speech out.",
        "capabilities": ["Text", "Vision", "Audio", "Video", "Files", "Code", "Reasoning"],
        "benchmarks": {
            "mmlu": 78.2,
            "humaneval": 80.4,
            "gsm8k": 87.9,
            "math": 71.5,
            "gpqa": 51.2,
            "ifeval": 79.8
        },
        "hf_repo": "Qwen/Qwen3-Omni-30B-A3B-Instruct",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Lightricks/LTX-Video",
        "name": "LTX-Video 2B",
        "company": "Lightricks",
        "company_code": "lightricks",
        "parameters": "1.9B",
        "param_count_num": 1.9,
        "context_length": "Text or image to video",
        "context_tokens_num": 256,
        "quantization": "FP16 / FP8",
        "recommended_gpu_vram_gb": 8.0,
        "recommended_gpu_name": "RTX 4060 Ti 8GB / RTX 3070",
        "vram_gb_req": 6.0,
        "ram_gb_req": 16.0,
        "license": "OpenRAIL-M",
        "description": "Generates short video faster than real time on a consumer GPU. The most approachable open video model.",
        "capabilities": ["Video", "Vision"],
        "benchmarks": {
            "mmlu": 0.0,
            "humaneval": 0.0,
            "gsm8k": 0.0,
            "math": 0.0,
            "gpqa": 0.0,
            "ifeval": 0.0
        },
        "hf_repo": "Lightricks/LTX-Video",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "Wan-AI/Wan2.2-TI2V-5B",
        "name": "Wan 2.2 TI2V 5B",
        "company": "Alibaba Cloud",
        "company_code": "alibaba",
        "parameters": "5B",
        "param_count_num": 5.0,
        "context_length": "Text and image to video",
        "context_tokens_num": 512,
        "quantization": "FP16",
        "recommended_gpu_vram_gb": 16.0,
        "recommended_gpu_name": "RTX 4080 16GB / RTX 4090",
        "vram_gb_req": 12.0,
        "ram_gb_req": 32.0,
        "license": "Apache 2.0",
        "description": "Alibaba's compact video generator: 720p clips from a prompt or a still image on a single card.",
        "capabilities": ["Video", "Vision"],
        "benchmarks": {
            "mmlu": 0.0,
            "humaneval": 0.0,
            "gsm8k": 0.0,
            "math": 0.0,
            "gpqa": 0.0,
            "ifeval": 0.0
        },
        "hf_repo": "Wan-AI/Wan2.2-TI2V-5B",
        "ollama_tag": "",
        "is_default": False
    },
    {
        "id": "genmo/mochi-1-preview",
        "name": "Mochi 1 Video 10B",
        "company": "Genmo",
        "company_code": "genmo",
        "parameters": "10B",
        "param_count_num": 10.0,
        "context_length": "Text to video",
        "context_tokens_num": 256,
        "quantization": "FP16 / FP8",
        "recommended_gpu_vram_gb": 24.0,
        "recommended_gpu_name": "RTX 4090 24GB / A5000",
        "vram_gb_req": 22.0,
        "ram_gb_req": 48.0,
        "license": "Apache 2.0",
        "description": "High fidelity open text-to-video with strong motion quality. Needs a 24GB card.",
        "capabilities": ["Video", "Vision"],
        "benchmarks": {
            "mmlu": 0.0,
            "humaneval": 0.0,
            "gsm8k": 0.0,
            "math": 0.0,
            "gpqa": 0.0,
            "ifeval": 0.0
        },
        "hf_repo": "genmo/mochi-1-preview",
        "ollama_tag": "",
        "is_default": False
    },
]


# These identities either have no validated exact upstream repository/tag or
# previously pointed at an older/different model. They must not reach the UI,
# alias resolver, cache detector, or downloader. A real older model keeps its
# own honest catalog identity instead of masquerading as a future model.
OMITTED_UNVERIFIED_MODEL_IDS = frozenset({
    # Checked live against the Hugging Face model API: these four still shipped
    # in the catalog and every one of them 404s, which is what produced the
    # "Exact official repository validation failed" download error.
    "qwen/qwen3.6-6b-awq",
    "meta/llama-3.3-70b-instruct-awq",
    "nvidia/nemotron-3-ultra-49b-instruct",
    "nvidia/nemotron-3-8b-instruct",
    "google/gemma-4-4b-it",
    "google/gemma-4-27b",
    "google/gemma-4-32b",
    "google/gemma-3-9b-it",
    "meta/llama-4-7b-instruct",
    "meta/llama-4-13b-instruct",
    "meta/llama-4-34b-instruct",
    "meta/llama-4-70b-instruct-awq",
    "moonshotai/kimi-k1.5-8b",
    "moonshotai/kimi-k3-8b",
    "moonshotai/kimi-k3-32b",
    "moonshot/kimi-k3-chat",
    "thudm/glm-5.2-9b",
    "thudm/glm-5.2-27b",
    "zhipu/glm-5.2",
    "zhipu/glm-5.3-code",
    "deepseek/deepseek-v4-pro",
    "nvidia/nemotron-3-ultra-70b",
    "nvidia/nemotron-3-super-4b",
})

MODELS_CATALOG = [
    entry for entry in MODELS_CATALOG
    if str(entry.get("id") or "").strip().casefold() not in OMITTED_UNVERIFIED_MODEL_IDS
]

# This row previously mapped Qwen3 weights to a Qwen2.5 Ollama tag. Preserve
# the exact Hugging Face identity but remove the cross-model runtime alias.
for _catalog_entry in MODELS_CATALOG:
    if _catalog_entry.get("id") == "Qwen/Qwen3-4B-AWQ":
        _catalog_entry["ollama_tag"] = ""

# Only tags checked against the publisher's official Ollama library are used
# as cross-runtime aliases. Other tags can still work when selected by their
# exact installed name, but they are not treated as proof of an HF model ID.
VERIFIED_OLLAMA_TAGS = frozenset({
    "qwen2.5vl:3b",
    "qwen2.5vl:7b",
})

_VERIFIED_HF_REPOSITORIES: set[str] = set()


def mark_hf_repository_verified(repo_id: str) -> None:
    """Record a successful exact live repository-identity check for this process."""
    normalized = str(repo_id or "").strip().strip("/").casefold()
    if normalized:
        _VERIFIED_HF_REPOSITORIES.add(normalized)


def is_hf_repository_verified(repo_id: str) -> bool:
    normalized = str(repo_id or "").strip().strip("/").casefold()
    return bool(normalized and normalized in _VERIFIED_HF_REPOSITORIES)


def assert_exact_hf_repository(expected_repo: str, resolved_repo: str) -> str:
    """Reject a provider response that resolves to a different model identity."""
    expected = str(expected_repo or "").strip().strip("/")
    resolved = str(resolved_repo or "").strip().strip("/")
    if not expected or "/" not in expected:
        raise ValueError("Catalog entry has no exact Hugging Face repository identity.")
    if expected.casefold() != resolved.casefold():
        raise ValueError(
            "Repository identity mismatch: "
            f"requested '{expected}', provider resolved '{resolved or 'unavailable'}'."
        )
    return expected


def _catalog_entry_for_model(model_id: str) -> Optional[Dict[str, Any]]:
    normalized = str(model_id or "").strip().lower()
    if normalized.endswith(":latest"):
        normalized = normalized[:-len(":latest")]
    for entry in MODELS_CATALOG:
        aliases = {
            str(entry.get("id") or "").strip().lower(),
            str(entry.get("hf_repo") or "").strip().lower(),
        }
        ollama_tag = str(entry.get("ollama_tag") or "").strip().lower()
        if ollama_tag in VERIFIED_OLLAMA_TAGS:
            aliases.add(ollama_tag)
        aliases = {
            alias[:-len(":latest")] if alias.endswith(":latest") else alias
            for alias in aliases if alias
        }
        if normalized in aliases:
            return entry
    return None


def _model_cache_directories(model_id: str) -> List[str]:
    """Return de-duplicated persistent and legacy HF cache locations."""
    model_entry = _catalog_entry_for_model(model_id)
    hf_repo = model_entry.get("hf_repo", model_id) if model_entry else model_id
    hf_folder_name = f"models--{hf_repo.replace('/', '--')}"
    data_dir = os.path.abspath(os.getenv("DATA_DIR", "./data"))
    hf_home = os.path.abspath(os.getenv("HF_HOME", os.path.join(data_dir, "models")))
    configured_hub = os.getenv("HUGGINGFACE_HUB_CACHE", "").strip()
    home_dir = os.path.expanduser("~")

    hub_roots = [
        configured_hub,
        os.path.join(hf_home, "hub"),
        os.path.join(data_dir, "models", "hub"),
        os.path.join(home_dir, ".cache", "huggingface", "hub"),
        "/root/.cache/huggingface/hub",
    ]
    candidates = [os.path.join(root, hf_folder_name) for root in hub_roots if root]
    # Older builds sometimes placed the HF model directory directly below
    # DATA_DIR/models instead of below its `hub` directory.
    candidates.append(os.path.join(data_dir, "models", hf_folder_name))

    unique = []
    seen = set()
    for candidate in candidates:
        normalized = os.path.normcase(os.path.abspath(candidate))
        if normalized not in seen:
            seen.add(normalized)
            unique.append(candidate)
    return unique


def _nonempty_file(path: str, minimum_bytes: int = 1) -> bool:
    try:
        return os.path.isfile(path) and os.path.getsize(path) >= minimum_bytes
    except OSError:
        return False


def _snapshot_has_complete_weights(snapshot_dir: str) -> bool:
    """Validate a loadable HF snapshot instead of trusting its byte count."""
    if not _nonempty_file(os.path.join(snapshot_dir, "config.json")):
        return False

    tokenizer_files = (
        "tokenizer.json", "tokenizer.model", "tokenizer_config.json", "vocab.json",
    )
    if not any(_nonempty_file(os.path.join(snapshot_dir, name)) for name in tokenizer_files):
        return False

    index_names = ("model.safetensors.index.json", "pytorch_model.bin.index.json")
    for index_name in index_names:
        index_path = os.path.join(snapshot_dir, index_name)
        if not _nonempty_file(index_path):
            continue
        try:
            with open(index_path, encoding="utf-8") as index_file:
                index_data = json.load(index_file)
            weight_map = index_data.get("weight_map", {})
            shard_names = {str(name) for name in weight_map.values() if name}
            if not shard_names:
                return False
            snapshot_root = os.path.abspath(snapshot_dir)
            actual_weight_bytes = 0
            for shard_name in shard_names:
                shard_path = os.path.abspath(os.path.join(snapshot_dir, shard_name))
                if os.path.commonpath([snapshot_root, shard_path]) != snapshot_root:
                    return False
                if not _nonempty_file(shard_path, minimum_bytes=1024 * 1024):
                    return False
                actual_weight_bytes += os.path.getsize(shard_path)
            expected_weight_bytes = int(index_data.get("metadata", {}).get("total_size", 0) or 0)
            if expected_weight_bytes > 0 and actual_weight_bytes < expected_weight_bytes:
                return False
            return True
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return False

    single_weight_names = ("model.safetensors", "pytorch_model.bin")
    if any(_nonempty_file(os.path.join(snapshot_dir, name), minimum_bytes=1024 * 1024)
           for name in single_weight_names):
        return True

    # Some verified repositories use a custom single safetensors/GGUF name.
    try:
        custom_weights = [
            name for name in os.listdir(snapshot_dir)
            if name.endswith((".safetensors", ".gguf"))
            and _nonempty_file(os.path.join(snapshot_dir, name), minimum_bytes=1024 * 1024)
        ]
        return len(custom_weights) == 1
    except OSError:
        return False


def find_complete_model_snapshot(model_id: str) -> Optional[str]:
    """Return a verified complete snapshot path, or ``None`` for partial data."""
    if not model_id or model_id == "auto" or model_id.startswith("cloud:"):
        return None

    for model_dir in _model_cache_directories(model_id):
        if not os.path.isdir(model_dir):
            continue
        snapshots_dir = os.path.join(model_dir, "snapshots")
        if os.path.isdir(snapshots_dir):
            try:
                snapshots = [
                    os.path.join(snapshots_dir, name)
                    for name in os.listdir(snapshots_dir)
                    if os.path.isdir(os.path.join(snapshots_dir, name))
                ]
            except OSError:
                snapshots = []
            for snapshot in snapshots:
                if _snapshot_has_complete_weights(snapshot):
                    return snapshot

        # Support an explicitly managed, unpacked model directory.
        # A stale partial blob elsewhere in a normal HF cache must not hide a
        # separately complete snapshot, but it does invalidate a direct model
        # directory that has no snapshot boundary.
        try:
            has_incomplete_blob = any(
                filename.endswith(".incomplete")
                for _, _, filenames in os.walk(model_dir)
                for filename in filenames
            )
        except OSError:
            has_incomplete_blob = True
        if not has_incomplete_blob and _snapshot_has_complete_weights(model_dir):
            return model_dir
    return None


def check_download_status(model_id: str) -> bool:
    """True only when a complete, loadable local model snapshot is present."""
    return find_complete_model_snapshot(model_id) is not None


def get_hardware_compatibility(
    vram_req: float,
    ram_req: float,
    recommended_gpu_vram_gb: float = 6.0,
    user_gpu_vram: Optional[float] = None,
    user_ram_gb: Optional[float] = None,
    is_integrated_gpu: bool = False
) -> Dict[str, Any]:
    """Compare measured capacity with catalog requirements without speed claims."""

    if user_gpu_vram is None or user_ram_gb is None:
        return {
            "status": "hardware_unknown",
            "label": "Device RAM/VRAM telemetry unavailable — compatibility not evaluated",
            "color": "zinc",
            "can_run_gpu": None,
            "tier_recommendation": "Connect the host telemetry bridge for a capacity check",
        }

    if user_gpu_vram <= 0.5 or is_integrated_gpu:
        if ram_req <= user_ram_gb * 0.85:
            return {
                "status": "cpu_ram_mode",
                "label": f"CPU/RAM fallback may fit {user_ram_gb:.1f} GB system RAM; speed not measured",
                "color": "sky",
                "can_run_gpu": False,
                "tier_recommendation": "Capacity check only — run a benchmark before relying on performance",
            }
        return {
            "status": "insufficient_ram",
            "label": f"Needs about {ram_req:.1f} GB RAM; measured device RAM is {user_ram_gb:.1f} GB",
            "color": "rose",
            "can_run_gpu": False,
            "tier_recommendation": "Measured capacity is below the catalog requirement",
        }

    if user_gpu_vram >= recommended_gpu_vram_gb:
        return {
            "status": "recommended_capacity_met",
            "label": f"Measured {user_gpu_vram:.1f} GB VRAM meets the {recommended_gpu_vram_gb:.1f} GB recommendation; speed not measured",
            "color": "emerald",
            "can_run_gpu": True,
            "tier_recommendation": "Recommended VRAM capacity met (not a performance guarantee)",
        }

    if user_gpu_vram >= vram_req:
        return {
            "status": "minimum_capacity_met",
            "label": f"Measured {user_gpu_vram:.1f} GB VRAM meets the {vram_req:.1f} GB minimum, below the {recommended_gpu_vram_gb:.1f} GB recommendation",
            "color": "amber",
            "can_run_gpu": True,
            "tier_recommendation": "Minimum capacity met; actual speed and stability require a measured run",
        }

    return {
        "status": "insufficient_vram",
        "label": f"Needs at least {vram_req:.1f} GB VRAM; measured GPU VRAM is {user_gpu_vram:.1f} GB",
        "color": "rose",
        "can_run_gpu": False,
        "tier_recommendation": "Measured capacity is below the catalog requirement",
    }


def get_full_catalog(
    user_gpu_vram: Optional[float] = None,
    user_ram_gb: Optional[float] = None,
    is_integrated_gpu: bool = False
) -> List[Dict[str, Any]]:
    """Return catalog entries with strict download and measured-capacity status."""
    catalog = []
    for item in MODELS_CATALOG:
        entry = dict(item)
        entry["is_downloaded"] = check_download_status(entry["id"])
        hf_repo = str(entry.get("hf_repo") or "").strip()
        ollama_tag = str(entry.get("ollama_tag") or "").strip().lower()
        entry["identity_verified"] = is_hf_repository_verified(hf_repo)
        entry["verification_status"] = (
            "verified_exact_repository"
            if entry["identity_verified"]
            else "live_exact_repository_validation_required"
        )
        entry["ollama_tag_verified"] = bool(ollama_tag and ollama_tag in VERIFIED_OLLAMA_TAGS)
        if not entry["ollama_tag_verified"]:
            # Do not expose a guessed tag to API clients. Exact installed tags
            # remain discoverable through the runtime inventory independently.
            entry["ollama_tag"] = ""
        entry["download_validation_required"] = not entry["identity_verified"]
        benchmark_sources = entry.get("benchmark_sources")
        if not benchmark_sources:
            # Legacy catalog scores were not shipped with primary-source
            # citations and therefore cannot be represented as verified data.
            entry["benchmarks"] = {}
            entry["benchmark_status"] = "unavailable_without_cited_primary_source"
        else:
            entry["benchmark_status"] = "source_cited"
        entry["hardware_fit"] = get_hardware_compatibility(
            vram_req=entry["vram_gb_req"],
            ram_req=entry["ram_gb_req"],
            recommended_gpu_vram_gb=entry.get("recommended_gpu_vram_gb", 6.0),
            user_gpu_vram=user_gpu_vram,
            user_ram_gb=user_ram_gb,
            is_integrated_gpu=is_integrated_gpu
        )
        catalog.append(entry)
    return catalog
