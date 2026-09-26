"""SMARAN drives a ComfyUI that is already running on this computer.

ComfyUI holds whatever models its owner has put in it - Flux, SD 3.5, SDXL,
HunyuanDiT, with ControlNet and IP-Adapter nodes - and runs them well. So
rather than copy it, SMARAN talks to it through its own HTTP API:

    GET  /system_stats                          is it running
    GET  /object_info/CheckpointLoaderSimple    which checkpoints it has
    POST /prompt {"prompt": <workflow>}         queue a workflow
    GET  /history/<prompt_id>                   finished? which files
    GET  /view?filename=&subfolder=&type=       the picture itself

The workflow is either SMARAN's standard text-to-image graph built on the
chosen checkpoint, or one the owner exported from ComfyUI ("Save (API
Format)") with the text {{prompt}} where the prompt goes - so any workflow,
with any nodes, can be run by voice or from the Images page.

The address is http://127.0.0.1:8188 unless SMARAN_COMFYUI_URL says
otherwise, and only this computer or the local network is allowed.
"""

from __future__ import annotations

import ipaddress
import json
import os
import random
import time
import urllib.parse
import uuid
from typing import Callable, Dict, List, Optional

import httpx

DEFAULT_URL = "http://127.0.0.1:8188"
MAX_WAIT = 900


class ComfyError(RuntimeError):
    pass


def base_url() -> str:
    url = (os.getenv("SMARAN_COMFYUI_URL") or DEFAULT_URL).strip().rstrip("/")
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    try:
        local = host == "localhost" or ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = False
    if parsed.scheme not in ("http", "https") or not local:
        raise ComfyError("SMARAN_COMFYUI_URL must point at this computer or your local network.")
    return url


def _client() -> httpx.Client:
    # trust_env=False: a system proxy must not see requests meant for localhost.
    return httpx.Client(base_url=base_url(), timeout=20.0, trust_env=False)


def status() -> Dict:
    try:
        with _client() as c:
            stats = c.get("/system_stats").json()
            info = c.get("/object_info/CheckpointLoaderSimple").json()
    except (httpx.HTTPError, ValueError, ComfyError) as exc:
        return {"running": False, "url": DEFAULT_URL, "models": [],
                "error": "ComfyUI is not answering at %s. Start ComfyUI, then refresh." % (
                    os.getenv("SMARAN_COMFYUI_URL") or DEFAULT_URL), "detail": str(exc)[:200]}
    try:
        names = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    except (KeyError, IndexError, TypeError):
        names = []
    device = ((stats.get("devices") or [{}])[0]).get("name", "")
    return {"running": True, "url": base_url(), "device": device,
            "version": (stats.get("system") or {}).get("comfyui_version", ""),
            "models": [{"id": n, "description": ""} for n in names], "error": ""}


_SIZES = {"1:1": (1024, 1024), "16:9": (1344, 768), "9:16": (768, 1344), "4:3": (1152, 896), "3:4": (896, 1152)}


def standard_workflow(prompt: str, checkpoint: str, aspect: str = "1:1", steps: int = 25,
                      negative: str = "blurry, low quality, watermark, text artifacts") -> Dict:
    """ComfyUI's own default text-to-image graph, in API format."""
    width, height = _SIZES.get(aspect, _SIZES["1:1"])
    if "sd15" in checkpoint.lower() or "v1-5" in checkpoint.lower():
        width, height = width // 2, height // 2   # SD 1.5 was trained at 512
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "3": {"class_type": "KSampler", "inputs": {
            "seed": random.randint(1, 2**31 - 1), "steps": steps, "cfg": 7.0, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0],
            "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "SMARAN", "images": ["8", 0]}},
    }


def custom_workflow(text: str, prompt: str) -> Dict:
    """An exported API-format workflow, with {{prompt}} replaced."""
    if "{{prompt}}" not in text:
        raise ComfyError("Put {{prompt}} in the workflow where the prompt text goes.")
    try:
        graph = json.loads(text.replace("{{prompt}}", json.dumps(prompt)[1:-1]))
    except ValueError as exc:
        raise ComfyError("That is not a workflow in ComfyUI's API format (Save (API Format)): %s" % exc) from exc
    if not isinstance(graph, dict) or not all(isinstance(v, dict) and "class_type" in v for v in graph.values()):
        raise ComfyError("That looks like the UI format. In ComfyUI use Save (API Format) instead.")
    return graph


def run(graph: Dict, out_path: str, note: Callable[[str], None] = lambda _: None,
        should_stop: Optional[Callable[[], bool]] = None) -> str:
    """Queue the graph, wait for it, save the first picture to out_path."""
    client_id = uuid.uuid4().hex
    with _client() as c:
        queued = c.post("/prompt", json={"prompt": graph, "client_id": client_id})
        if queued.status_code != 200:
            detail = queued.json() if "json" in queued.headers.get("content-type", "") else queued.text
            raise ComfyError("ComfyUI refused the workflow: %s" % str(detail)[:400])
        prompt_id = queued.json().get("prompt_id")
        note("Queued in ComfyUI.")
        deadline = time.time() + MAX_WAIT
        while time.time() < deadline:
            if should_stop and should_stop():
                c.post("/interrupt")
                raise ComfyError("Stopped.")
            history = c.get("/history/%s" % prompt_id).json().get(prompt_id)
            if history:
                state = history.get("status") or {}
                if state.get("status_str") == "error":
                    raise ComfyError("ComfyUI reported an error: %s" % str(state.get("messages"))[:400])
                images: List[Dict] = [img for node in (history.get("outputs") or {}).values()
                                      for img in node.get("images", [])]
                if images:
                    first = images[0]
                    picture = c.get("/view", params={"filename": first["filename"],
                                                     "subfolder": first.get("subfolder", ""),
                                                     "type": first.get("type", "output")})
                    picture.raise_for_status()
                    with open(out_path, "wb") as fh:
                        fh.write(picture.content)
                    return out_path
                if state.get("completed"):
                    raise ComfyError("The workflow finished without saving a picture (add a SaveImage node).")
            time.sleep(1.0)
    raise ComfyError("ComfyUI was still working after %d minutes." % (MAX_WAIT // 60))
