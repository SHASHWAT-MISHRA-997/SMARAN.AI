"""The open image and video models worth knowing, and whether this PC can run them.

Every memory figure here comes from the project's own README or model card,
read on 27 September 2026, and says so in `source`. Where a project states no
figure, none is given - "unknown" rather than a guess. Closed services
(Kling, Hailuo, Seedance, Runway, Veo, ChatGPT Images) have no local weights
at all; they are listed with the only honest way to reach them.

`where` says how SMARAN can use each one:

    smaran    runs in SMARAN itself on this computer (Images / Video page)
    comfyui   through a ComfyUI running on this computer (Images -> ComfyUI)
    nvidia    hosted by NVIDIA on your NVIDIA key (free trial credits)
    replicate hosted on Replicate on your key (billed per image or video)
"""
from __future__ import annotations

from typing import Dict, List, Optional

VIDEO: List[Dict] = [
    {"id": "ltx-video-2b", "name": "LTX-Video 2B (0.9.x)", "maker": "Lightricks", "params": "2B",
     "min_vram_gb": None, "license": "OpenRail-M", "where": ["smaran", "comfyui", "replicate"],
     "repo": "https://github.com/Lightricks/LTX-Video", "weights": "https://huggingface.co/Lightricks/LTX-Video",
     "note": "The model SMARAN's Video page runs on this PC.",
     "source": "LTX-Video README lists 2B and 13B checkpoints; no VRAM figure for the full models."},
    {"id": "ltx-video-13b", "name": "LTX-Video 13B (0.9.8)", "maker": "Lightricks", "params": "13B",
     "min_vram_gb": None, "license": "OpenRail-M", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/Lightricks/LTX-Video", "weights": "https://huggingface.co/Lightricks/LTX-Video",
     "note": "fp8 versions exist for smaller cards.", "source": "LTX-Video README (no VRAM stated)."},
    {"id": "wan21-1.3b", "name": "Wan 2.1 T2V-1.3B", "maker": "Alibaba (Wan)", "params": "1.3B",
     "min_vram_gb": 8.19, "license": "Apache 2.0", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/Wan-Video/Wan2.1", "weights": "https://huggingface.co/Wan-AI",
     "note": "480p; about 4 minutes for 5 s on an RTX 4090.",
     "source": "Wan2.1 README: 'requires only 8.19 GB VRAM'."},
    {"id": "wan21-14b", "name": "Wan 2.1 14B (T2V / I2V / VACE)", "maker": "Alibaba (Wan)", "params": "14B",
     "min_vram_gb": None, "license": "Apache 2.0", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/Wan-Video/Wan2.1", "weights": "https://huggingface.co/Wan-AI",
     "note": "480p and 720p.", "source": "Wan2.1 README (no VRAM stated for 14B)."},
    {"id": "wan22-5b", "name": "Wan 2.2 TI2V-5B", "maker": "Alibaba (Wan)", "params": "5B",
     "min_vram_gb": 24.0, "license": "Apache 2.0", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/Wan-Video/Wan2.2", "weights": "https://huggingface.co/Wan-AI",
     "note": "720p, 24 fps; text or image to video.", "source": "Wan2.2 README: 'at least 24GB VRAM'."},
    {"id": "wan22-a14b", "name": "Wan 2.2 A14B (T2V / I2V / S2V)", "maker": "Alibaba (Wan)", "params": "14B (MoE)",
     "min_vram_gb": 80.0, "license": "Apache 2.0", "where": ["replicate"],
     "repo": "https://github.com/Wan-Video/Wan2.2", "weights": "https://huggingface.co/Wan-AI",
     "note": "Cloud GPUs; single-GPU inference needs 80 GB.", "source": "Wan2.2 README: 'at least 80GB VRAM'."},
    {"id": "hunyuanvideo", "name": "HunyuanVideo", "maker": "Tencent", "params": "13B",
     "min_vram_gb": 45.0, "license": "Tencent Hunyuan Community", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/Tencent-Hunyuan/HunyuanVideo", "weights": "https://huggingface.co/tencent/HunyuanVideo",
     "note": "45 GB at 544p, 60 GB at 720p; HunyuanVideo 1.5 released Nov 2025.",
     "source": "HunyuanVideo README requirements table."},
    {"id": "mochi-1", "name": "Mochi 1", "maker": "Genmo", "params": "10B",
     "min_vram_gb": 20.0, "license": "Apache 2.0", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/genmoai/mochi", "weights": "https://huggingface.co/genmo/mochi-1-preview",
     "note": "About 60 GB in its own repo; under 20 GB through ComfyUI.",
     "source": "Mochi README: ~60 GB single GPU, <20 GB with ComfyUI."},
    {"id": "cogvideox-2b", "name": "CogVideoX-2B", "maker": "THUDM (Zhipu)", "params": "2B",
     "min_vram_gb": 5.0, "license": "Apache 2.0", "where": ["comfyui"],
     "repo": "https://github.com/THUDM/CogVideo", "weights": "https://huggingface.co/THUDM/CogVideoX-2b",
     "note": "720x480.", "source": "CogVideo README: 'diffusers BF16: 5GB minimum'."},
    {"id": "cogvideox-5b", "name": "CogVideoX-5B / 1.5-5B", "maker": "THUDM (Zhipu)", "params": "5B",
     "min_vram_gb": 10.0, "license": "CogVideoX License", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/THUDM/CogVideo", "weights": "https://huggingface.co/THUDM/CogVideoX-5b",
     "note": "1.5 renders 1360x768.", "source": "CogVideo README: 'diffusers BF16: from 10GB'."},
    {"id": "allegro", "name": "Allegro", "maker": "Rhymes AI", "params": "2.8B",
     "min_vram_gb": 9.3, "license": "Apache 2.0", "where": ["comfyui"],
     "repo": "https://github.com/rhymes-ai/Allegro", "weights": "https://huggingface.co/rhymes-ai/Allegro",
     "note": "9.3 GB with CPU offload, 27.5 GB without; 6 s of 720p takes ~20 min on an H100.",
     "source": "Allegro README."},
    {"id": "open-sora", "name": "Open-Sora", "maker": "HPC-AI Tech", "params": "11B (2.0)",
     "min_vram_gb": None, "license": "Apache 2.0", "where": ["comfyui"],
     "repo": "https://github.com/hpcaitech/Open-Sora", "weights": "https://huggingface.co/hpcai-tech",
     "note": "Large; multi-GPU in its own repo.", "source": "Open-Sora repository (no single-GPU figure used here)."},
    {"id": "skyreels-v1", "name": "SkyReels V1", "maker": "SkyReels", "params": "13B (HunyuanVideo-based)",
     "min_vram_gb": None, "license": "See repository", "where": ["comfyui"],
     "repo": "https://github.com/SkyworkAI/SkyReels-V1", "weights": "https://huggingface.co/Skywork",
     "note": "Human-centric video on the HunyuanVideo architecture.", "source": "SkyReels repository."},
    {"id": "cosmos", "name": "NVIDIA Cosmos", "maker": "NVIDIA", "params": "2B-14B",
     "min_vram_gb": None, "license": "NVIDIA Open Model", "where": ["comfyui"],
     "repo": "https://github.com/nvidia-cosmos", "weights": "https://huggingface.co/nvidia",
     "note": "World models for robotics and simulation more than creative clips.",
     "source": "NVIDIA Cosmos repositories. Not offered to this NVIDIA key as a hosted model (checked)."},
    {"id": "hunyuanvideo-foley", "name": "HunyuanVideo-Foley (sound for video)", "maker": "Tencent", "params": "XL / XXL",
     "min_vram_gb": 8.0, "license": "See repository", "where": ["comfyui"],
     "repo": "https://github.com/Tencent-Hunyuan/HunyuanVideo-Foley", "weights": "https://huggingface.co/tencent",
     "note": "Adds matching sound effects to a silent video. XL: 16 GB, 8 GB with offload; XXL: 20 GB / 12 GB.",
     "source": "HunyuanVideo-Foley README VRAM table."},
]

IMAGE: List[Dict] = [
    {"id": "sd15", "name": "Stable Diffusion 1.5", "maker": "Stability / Runway", "params": "0.9B",
     "min_vram_gb": 3.5, "license": "CreativeML OpenRAIL-M", "where": ["smaran", "comfyui"],
     "repo": "https://github.com/Stability-AI/generative-models",
     "weights": "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5",
     "note": "Runs on this PC in SMARAN, best at 512x512.", "source": "SMARAN image registry (model card)."},
    {"id": "sdxl", "name": "Stable Diffusion XL", "maker": "Stability AI", "params": "3.5B",
     "min_vram_gb": 5.0, "license": "CreativeML OpenRAIL++-M", "where": ["smaran", "comfyui"],
     "repo": "https://github.com/Stability-AI/generative-models",
     "weights": "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
     "note": "1024px.", "source": "SMARAN image registry (model card)."},
    {"id": "sd35", "name": "Stable Diffusion 3.5 Large", "maker": "Stability AI", "params": "8B",
     "min_vram_gb": None, "license": "Stability Community (free under $1M revenue)", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/Stability-AI/sd3.5", "weights": "https://huggingface.co/stabilityai/stable-diffusion-3.5-large",
     "note": "4-bit quantisation for smaller cards; Medium is the lighter version.",
     "source": "SD 3.5 Large model card (no VRAM figure)."},
    {"id": "flux1-dev", "name": "FLUX.1 [dev]", "maker": "Black Forest Labs", "params": "12B",
     "min_vram_gb": None, "license": "FLUX.1-dev Non-Commercial", "where": ["nvidia", "comfyui", "replicate"],
     "repo": "https://github.com/black-forest-labs/flux", "weights": "https://huggingface.co/black-forest-labs/FLUX.1-dev",
     "note": "What SMARAN's Automatic uses in the cloud - about 5 s for 1024x1024.",
     "source": "FLUX repo README (no VRAM stated); tested on the NVIDIA key."},
    {"id": "flux1-schnell", "name": "FLUX.1 [schnell]", "maker": "Black Forest Labs", "params": "12B",
     "min_vram_gb": None, "license": "Apache 2.0", "where": ["nvidia", "comfyui", "replicate"],
     "repo": "https://github.com/black-forest-labs/flux", "weights": "https://huggingface.co/black-forest-labs/FLUX.1-schnell",
     "note": "4-step fast version.", "source": "FLUX repo README."},
    {"id": "flux1-kontext", "name": "FLUX.1 Kontext [dev] (editing)", "maker": "Black Forest Labs", "params": "12B",
     "min_vram_gb": None, "license": "FLUX.1-dev Non-Commercial", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/black-forest-labs/flux", "weights": "https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev",
     "note": "Edits a picture from an instruction. NVIDIA's hosted one only accepts its own demo pictures (checked), so it is not used there.",
     "source": "FLUX repo README; NVIDIA API answered 'Expected: example_id'."},
    {"id": "flux2-dev", "name": "FLUX.2 [dev] / Klein", "maker": "Black Forest Labs", "params": "32B (Klein 4B / 9B)",
     "min_vram_gb": 64.0, "license": "Non-commercial (Klein 4B: Apache 2.0)", "where": ["replicate", "comfyui"],
     "repo": "https://github.com/black-forest-labs/flux2", "weights": "https://huggingface.co/black-forest-labs",
     "note": "Nov 2025. ~64 GB at full precision; GGUF Q4 ~19 GB; Klein 4B ~10 GB.",
     "source": "Black Forest Labs flux2 hardware notes and model listings."},
    {"id": "qwen-image", "name": "Qwen-Image (2512) / Qwen-Image-Edit", "maker": "Alibaba (Qwen)", "params": "20B",
     "min_vram_gb": None, "license": "Apache 2.0", "where": ["comfyui", "replicate"],
     "repo": "https://github.com/QwenLM/Qwen-Image", "weights": "https://huggingface.co/Qwen",
     "note": "Best at text inside pictures (Chinese especially); separate editing model. Layer-by-layer offload runs in 4 GB, slowly.",
     "source": "Qwen-Image README."},
    {"id": "hunyuandit", "name": "HunyuanDiT", "maker": "Tencent", "params": "1.5B",
     "min_vram_gb": None, "license": "Tencent Hunyuan Community", "where": ["comfyui"],
     "repo": "https://github.com/Tencent/HunyuanDiT", "weights": "https://huggingface.co/Tencent-Hunyuan/HunyuanDiT",
     "note": "Chinese and English prompts.", "source": "HunyuanDiT repository."},
    {"id": "sana", "name": "SANA / SANA-Sprint", "maker": "NVIDIA (NVlabs)", "params": "0.6B-4.8B",
     "min_vram_gb": 8.0, "license": "Apache 2.0", "where": ["comfyui"],
     "repo": "https://github.com/NVlabs/Sana", "weights": "https://huggingface.co/Efficient-Large-Model",
     "note": "Very fast; under 8 GB with 4-bit quantisation.", "source": "Sana README: 'laptop GPUs with < 8GB VRAM via 4-bit quantization'."},
    {"id": "omnigen", "name": "OmniGen", "maker": "VectorSpace Lab", "params": "3.8B",
     "min_vram_gb": None, "license": "MIT", "where": ["comfyui"],
     "repo": "https://github.com/VectorSpaceLab/OmniGen", "weights": "https://huggingface.co/Shitao/OmniGen-v1",
     "note": "Generation and editing from text alone.", "source": "OmniGen repository."},
    {"id": "lumina", "name": "Lumina-Image 2.0 / Lumina-T2I", "maker": "Alpha-VLLM", "params": "2B",
     "min_vram_gb": None, "license": "Apache 2.0", "where": ["comfyui"],
     "repo": "https://github.com/Alpha-VLLM/Lumina-Image-2.0", "weights": "https://huggingface.co/Alpha-VLLM",
     "note": "Flow-matching transformer, any aspect ratio.", "source": "Lumina repository."},
]

# Tools that are not models but how models are used; shown for completeness.
TOOLS: List[Dict] = [
    {"name": "ComfyUI", "repo": "https://github.com/comfyanonymous/ComfyUI",
     "note": "Runs almost every model above. SMARAN drives one already running on this PC (Images -> ComfyUI)."},
    {"name": "ControlNet", "repo": "https://github.com/lllyasviel/ControlNet", "note": "Pose, depth and edge control - inside ComfyUI workflows."},
    {"name": "IP-Adapter", "repo": "https://github.com/tencent-ailab/IP-Adapter", "note": "A reference picture guides style or face - inside ComfyUI workflows."},
    {"name": "Fooocus", "repo": "https://github.com/lllyasviel/Fooocus", "note": "Simple offline SDXL app."},
    {"name": "InvokeAI", "repo": "https://github.com/invoke-ai/InvokeAI", "note": "Canvas-based studio."},
    {"name": "AUTOMATIC1111 WebUI", "repo": "https://github.com/AUTOMATIC1111/stable-diffusion-webui", "note": "Classic slider interface."},
    {"name": "MoneyPrinterTurbo", "repo": "https://github.com/harry0703/MoneyPrinterTurbo", "note": "Script-to-short-video automation."},
]

# Services with no downloadable weights: the honest way to reach each.
CLOSED: List[Dict] = [
    {"name": "Kling", "kind": "video", "maker": "Kuaishou", "route": "replicate"},
    {"name": "Hailuo (MiniMax)", "kind": "video", "maker": "MiniMax", "route": "replicate"},
    {"name": "Seedance", "kind": "video", "maker": "ByteDance", "route": "replicate"},
    {"name": "Runway Gen-4.5", "kind": "video", "maker": "Runway", "route": "own paid API"},
    {"name": "Google Veo 3", "kind": "video", "maker": "Google", "route": "Gemini API (paid per second)"},
    {"name": "ChatGPT Images (gpt-image)", "kind": "image", "maker": "OpenAI", "route": "OpenAI API (paid)"},
    {"name": "Seedream", "kind": "image", "maker": "ByteDance", "route": "replicate"},
]


def tier(vram_gb: float) -> str:
    """How much this PC can do: strong, modest or light."""
    if vram_gb >= 12:
        return "strong"
    if vram_gb >= 6:
        return "modest"
    return "light"


NAMES = {"nvidia": "NVIDIA", "replicate": "Replicate"}


def fit(entry: Dict, vram_gb: float, runs_here=None) -> Dict:
    """Can this PC run it, in plain words. `runs_here` is SMARAN's own check
    for the models it runs itself - True, or the reason it cannot - and
    outranks any published figure."""
    need: Optional[float] = entry.get("min_vram_gb")
    where = entry.get("where", [])
    cloud = [NAMES[w] for w in where if w in NAMES]
    if runs_here is True:
        return {"fits": "yes", "why": "SMARAN checked this PC and can run it here."}
    if isinstance(runs_here, str) and runs_here:
        return {"fits": "not now", "why": "SMARAN cannot run it here right now: %s" % runs_here}
    if need is None:
        return {"fits": "unknown", "why": "Its project states no memory figure." + (
            " Use the cloud to be sure." if cloud else "")}
    if vram_gb >= need:
        return {"fits": "yes", "why": "Needs %.1f GB; this PC has %.0f GB." % (need, vram_gb)}
    return {"fits": "no", "why": "Needs %.1f GB; this PC has %.0f GB%s." % (
        need, vram_gb, " - use %s" % " or ".join(cloud) if cloud else "")}


def summary(kind: str, vram_gb: float) -> str:
    level = tier(vram_gb)
    if kind == "video":
        return {"strong": "Enough for the mid-size open models on this PC; the largest (Wan 2.2 A14B, "
                          "HunyuanVideo) still need cloud GPUs.",
                "modest": "Small open models run here, slowly (minutes per clip). For speed or the large "
                          "models, use the cloud tab - Replicate bills per video.",
                "light": "Video on this PC will be very slow or will not fit. The cloud tab is the practical "
                         "route - Replicate bills per video."}[level]
    return {"strong": "Most open image models fit here; Automatic makes pictures on this PC first.",
            "modest": "Stable Diffusion fits here; FLUX-class models are faster in the cloud, which "
                      "Automatic tries first.",
            "light": "Pictures on this PC will be slow; Automatic uses the cloud first."}[level]


def catalogue(kind: str, vram_gb: float, runs_here: Optional[Dict] = None) -> Dict:
    rows = VIDEO if kind == "video" else IMAGE
    runs_here = runs_here or {}
    return {
        "kind": kind,
        "tier": tier(vram_gb),
        "vram_gb": vram_gb,
        "summary": summary(kind, vram_gb),
        "models": [{**row, **fit(row, vram_gb, runs_here.get(row["id"]))} for row in rows],
        "closed": [c for c in CLOSED if c["kind"] == kind],
        "tools": TOOLS,
        "checked": "2026-09-27",
    }
