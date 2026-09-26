"""SMARAN drives a local ComfyUI through its HTTP API."""
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image

from app.imaging import comfy


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), "teal").save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def server(monkeypatch):
    queued = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, body, ctype="application/json", code=200):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/system_stats":
                return self._send({"system": {"comfyui_version": "0.3.60"}, "devices": [{"name": "cuda:0 RTX 2060"}]})
            if self.path.startswith("/object_info/CheckpointLoaderSimple"):
                return self._send({"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["sdxl.safetensors", "flux1-schnell.safetensors"]]}}}})
            if self.path.startswith("/history/p1"):
                return self._send({"p1": {"status": {"status_str": "success", "completed": True},
                                          "outputs": {"9": {"images": [{"filename": "SMARAN_0001.png", "subfolder": "", "type": "output"}]}}}})
            if self.path.startswith("/view"):
                return self._send(_png(), "image/png")
            self._send({}, code=404)

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/prompt":
                queued.append(body["prompt"])
                return self._send({"prompt_id": "p1"})
            self._send({})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("SMARAN_COMFYUI_URL", "http://127.0.0.1:%d" % srv.server_address[1])
    yield queued
    srv.shutdown()


def test_status_lists_checkpoints(server):
    s = comfy.status()
    assert s["running"] and [m["id"] for m in s["models"]] == ["sdxl.safetensors", "flux1-schnell.safetensors"]
    assert "RTX 2060" in s["device"]


def test_standard_workflow_runs_and_saves(server, tmp_path):
    out = tmp_path / "x.png"
    comfy.run(comfy.standard_workflow("a teal square", "sdxl.safetensors", "16:9"), str(out))
    graph = server[0]
    assert graph["6"]["inputs"]["text"] == "a teal square"
    assert graph["5"]["inputs"]["width"] == 1344 and graph["4"]["inputs"]["ckpt_name"] == "sdxl.safetensors"
    assert Image.open(out).size == (32, 32)


def test_a_custom_workflow_gets_the_prompt(server, tmp_path):
    wf = json.dumps({"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{prompt}}"}},
                     "9": {"class_type": "SaveImage", "inputs": {}}})
    graph = comfy.custom_workflow(wf, 'a "quoted" kite')
    assert graph["1"]["inputs"]["text"] == 'a "quoted" kite'
    with pytest.raises(comfy.ComfyError, match="API"):
        comfy.custom_workflow('{"nodes": [], "p": "{{prompt}}"}', "x")


def test_not_running_is_said(monkeypatch):
    monkeypatch.setenv("SMARAN_COMFYUI_URL", "http://127.0.0.1:1")
    s = comfy.status()
    assert not s["running"] and "not answering" in s["error"]


def test_only_local_addresses(monkeypatch):
    monkeypatch.setenv("SMARAN_COMFYUI_URL", "http://example.com:8188")
    with pytest.raises(comfy.ComfyError):
        comfy.base_url()
