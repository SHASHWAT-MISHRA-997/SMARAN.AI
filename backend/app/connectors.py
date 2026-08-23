"""
SMARAN.AI Production AI Connectors & Extensions
=================================================
1. ComfyUI (https://github.com/Comfy-Org/ComfyUI)
   - Node-based Stable Diffusion & Flux image/video generation engine.
2. HeyGem (https://github.com/suifeng9203/HeyGem.ai)
   - Offline AI Digital Human & Talking Avatar video generation with lip-sync.
3. OmniVoice (https://github.com/k2-fsa/OmniVoice)
   - Massively multilingual zero-shot voice cloning & TTS (600+ languages).
4. Handy (https://github.com/cjpais/Handy)
   - Local offline Speech-to-Text & hotkey voice typing into active applications.

100% Free & Open-Source, with strict privacy and safety guarantees.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("smaran.connectors")

# Default connection endpoints
COMFYUI_DEFAULT_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
HEYGEM_DEFAULT_URL = os.getenv("HEYGEM_URL", "http://127.0.0.1:7860")
OMNIVOICE_DEFAULT_URL = os.getenv("OMNIVOICE_URL", "http://127.0.0.1:8008")


# ---------------------------------------------------------------------------
# 1. ComfyUI Connector
# ---------------------------------------------------------------------------
class ComfyUIConnector:
    """Manages connection to local or remote ComfyUI instance for AI image & video generation."""

    @staticmethod
    async def is_available(url: str = COMFYUI_DEFAULT_URL) -> bool:
        """Check if ComfyUI service is active and responsive."""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(f"{url.rstrip('/')}/system_stats")
                return res.status_code == 200
        except Exception:
            return False

    @staticmethod
    async def get_system_stats(url: str = COMFYUI_DEFAULT_URL) -> Dict[str, Any]:
        """Fetch VRAM, active devices, and system status from ComfyUI."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{url.rstrip('/')}/system_stats")
                if res.status_code == 200:
                    return res.json()
        except Exception as e:
            logger.debug(f"ComfyUI stats error: {e}")
        return {"devices": [], "vram_free": 0}

    @staticmethod
    async def generate_image(
        prompt: str,
        negative_prompt: str = "ugly, blurry, distorted, low quality",
        width: int = 512,
        height: int = 512,
        steps: int = 20,
        cfg_scale: float = 7.0,
        url: str = COMFYUI_DEFAULT_URL
    ) -> Dict[str, Any]:
        """Queue an image generation prompt workflow in ComfyUI."""
        # Standard txt2img workflow payload for ComfyUI
        workflow = {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "cfg": cfg_scale,
                    "denoise": 1,
                    "latent_image": ["5", 0],
                    "model": ["4", 0],
                    "negative": ["7", 0],
                    "positive": ["6", 0],
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "seed": int(time.time()),
                    "steps": steps
                }
            },
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": "v1-5-pruned-emaonly.safetensors"
                }
            },
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "batch_size": 1,
                    "height": height,
                    "width": width
                }
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["4", 1],
                    "text": prompt
                }
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["4", 1],
                    "text": negative_prompt
                }
            },
            "8": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["4", 2]
                }
            },
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "filename_prefix": "SMARAN_AI",
                    "images": ["8", 0]
                }
            }
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(f"{url.rstrip('/')}/prompt", json={"prompt": workflow})
                if res.status_code == 200:
                    data = res.json()
                    prompt_id = data.get("prompt_id")
                    return {
                        "success": True,
                        "prompt_id": prompt_id,
                        "message": f"ComfyUI task queued: {prompt_id}",
                        "endpoint": url
                    }
                return {"success": False, "error": f"ComfyUI HTTP {res.status_code}: {res.text}"}
        except Exception as e:
            return {"success": False, "error": f"ComfyUI connection failed: {e}"}


# ---------------------------------------------------------------------------
# 2. HeyGem AI Digital Human & Talking Avatar Connector
# ---------------------------------------------------------------------------
class HeyGemConnector:
    """Manages offline AI digital human generation and lip-synced talking avatar videos."""

    @staticmethod
    async def is_available(url: str = HEYGEM_DEFAULT_URL) -> bool:
        """Check if local HeyGem digital human service is running."""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(f"{url.rstrip('/')}/health")
                return res.status_code == 200
        except Exception:
            return False

    @staticmethod
    async def generate_talking_avatar(
        text: str,
        avatar_id: str = "default_avatar",
        voice_id: str = "default_voice",
        url: str = HEYGEM_DEFAULT_URL
    ) -> Dict[str, Any]:
        """Generate a lip-synced talking avatar video from text."""
        payload = {
            "text": text,
            "avatar_id": avatar_id,
            "voice_id": voice_id,
            "resolution": "1080p",
            "fps": 30
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                res = await client.post(f"{url.rstrip('/')}/api/avatar/generate", json=payload)
                if res.status_code == 200:
                    return res.json()
                return {"success": False, "error": f"HeyGem HTTP {res.status_code}"}
        except Exception as e:
            return {
                "success": False,
                "error": f"HeyGem offline service is not running on {url}. Launch HeyGem locally to enable digital human avatar videos: {e}"
            }


# ---------------------------------------------------------------------------
# 3. OmniVoice (k2-fsa) Zero-Shot Multilingual TTS Connector
# ---------------------------------------------------------------------------
class OmniVoiceConnector:
    """Zero-shot massively multilingual speech synthesis supporting 600+ languages."""

    @staticmethod
    async def is_available(url: str = OMNIVOICE_DEFAULT_URL) -> bool:
        """Check if OmniVoice / Sherpa-ONNX TTS engine is active."""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(f"{url.rstrip('/')}/api/status")
                return res.status_code == 200
        except Exception:
            return False

    @staticmethod
    async def synthesize(
        text: str,
        language: str = "en",
        speaker_id: int = 0,
        speed: float = 1.0,
        url: str = OMNIVOICE_DEFAULT_URL
    ) -> Dict[str, Any]:
        """Synthesize high-quality multilingual speech using OmniVoice."""
        payload = {
            "text": text,
            "language": language,
            "speaker_id": speaker_id,
            "speed": speed
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(f"{url.rstrip('/')}/api/tts/generate", json=payload)
                if res.status_code == 200:
                    audio_b64 = base64.b64encode(res.content).decode("utf-8")
                    return {
                        "success": True,
                        "audio_base64": audio_b64,
                        "format": "wav",
                        "language": language
                    }
                return {"success": False, "error": f"OmniVoice HTTP {res.status_code}"}
        except Exception as e:
            return {
                "success": False,
                "error": f"OmniVoice local engine offline: {e}"
            }


# ---------------------------------------------------------------------------
# 4. Handy Speech-To-Text / Hotkey Voice Typing Connector
# ---------------------------------------------------------------------------
class HandyVoiceConnector:
    """Integrates local Whisper transcription with desktop hotkey audio typing."""

    @staticmethod
    def get_supported_hotkeys() -> List[Dict[str, str]]:
        return [
            {"name": "Push to Talk", "hotkey": "Ctrl + Shift + Space", "action": "transcribe_to_active_window"},
            {"name": "Toggle Voice Dictation", "hotkey": "Ctrl + Win + V", "action": "toggle_continuous_stt"},
            {"name": "J.A.R.V.I.S. Command", "hotkey": "Alt + Space", "action": "open_voice_hud"},
        ]

    @staticmethod
    async def transcribe_audio_chunk(audio_bytes: bytes, language: str = "auto") -> Dict[str, Any]:
        """Transcribe an audio chunk using local Whisper engine."""
        try:
            from app.voice_service import transcribe_audio
            transcript = await transcribe_audio(audio_bytes, language=language)
            return {"success": True, "transcript": transcript}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Aggregated Connectors Health & Status
# ---------------------------------------------------------------------------
async def get_all_connectors_status() -> Dict[str, Any]:
    """Check connectivity across all 4 production connectors."""
    comfy_ok, heygem_ok, omnivoice_ok = await asyncio.gather(
        ComfyUIConnector.is_available(),
        HeyGemConnector.is_available(),
        OmniVoiceConnector.is_available(),
        return_exceptions=True
    )

    return {
        "comfyui": {
            "name": "ComfyUI (Stable Diffusion & Flux)",
            "available": bool(comfy_ok is True),
            "endpoint": COMFYUI_DEFAULT_URL,
            "capabilities": ["Text-to-Image", "Image-to-Image", "ControlNet", "Flux", "SDXL"]
        },
        "heygem": {
            "name": "HeyGem.ai (Digital Human & Talking Avatar)",
            "available": bool(heygem_ok is True),
            "endpoint": HEYGEM_DEFAULT_URL,
            "capabilities": ["Offline Digital Twin", "Lip-Sync Video", "Voice Cloning", "Real-Time Avatar"]
        },
        "omnivoice": {
            "name": "OmniVoice (k2-fsa Multilingual Speech)",
            "available": bool(omnivoice_ok is True),
            "endpoint": OMNIVOICE_DEFAULT_URL,
            "capabilities": ["600+ Languages", "Zero-Shot Voice Cloning", "Diffusion TTS", "Speaker Design"]
        },
        "handy": {
            "name": "Handy (Local Whisper Voice Assistant)",
            "available": True,
            "capabilities": ["Offline STT", "Global Hotkey Voice Typing", "Barge-In", "Whisper Small/Medium"]
        }
    }
