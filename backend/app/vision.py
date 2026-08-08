"""
Vision Handler Module for Grey Matter AI.
Handles PDF-to-image conversion, image encoding, and vLLM vision model calls.

Uses vLLM's OpenAI-compatible /v1/chat/completions endpoint with image_url content blocks.
Compatible with: Qwen2.5-VL-7B-Instruct-AWQ and any other vLLM multimodal model.
"""
import base64
import gc
import io
import logging
from typing import List, Optional, Generator

import fitz  # PyMuPDF
import requests
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


def pdf_to_images(file_path: str, max_pages: int = 5, dpi: int = 150) -> List[bytes]:
    """
    Convert PDF pages to PNG image bytes in-memory.
    Limits to max_pages to prevent VRAM overflow on constrained hardware.
    """
    image_bytes_list = []
    try:
        doc = fitz.open(file_path)
        page_count = min(len(doc), max_pages)

        for page_num in range(page_count):
            page = doc.load_page(page_num)
            zoom = dpi / 72.0
            mat = fitz.Matrix(zoom, zoom)
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            image_bytes_list.append(img_bytes)
            del pix

        doc.close()
        logger.info(f"Converted {page_count}/{len(doc)} PDF pages to images from: {file_path}")

    except Exception as e:
        logger.error(f"Error converting PDF to images: {e}")
        raise ValueError(f"Failed to convert PDF pages to images: {str(e)}")
    finally:
        gc.collect()

    return image_bytes_list


def encode_image_base64(image_data: bytes) -> str:
    """
    Encode raw image bytes to a base64 string for vLLM vision API.
    Resizes large images to prevent VRAM overflow.
    """
    try:
        img = Image.open(io.BytesIO(image_data))
        max_dimension = 1024

        if max(img.size) > max_dimension:
            ratio = max_dimension / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.LANCZOS)
            logger.info(f"Resized image to {new_size} for VRAM safety")

        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        encoded = base64.b64encode(buffer.read()).decode("utf-8")
        del img, buffer
        return encoded

    except Exception as e:
        logger.error(f"Error encoding image to base64: {e}")
        raise ValueError(f"Failed to encode image: {str(e)}")


def call_vision_model(
    images_b64: List[str],
    prompt: str,
    model: str = None,
    stream: bool = True
):
    """
    Call vLLM's OpenAI-compatible /v1/chat/completions endpoint with base64 images.
    Compatible with Qwen2.5-VL, LLaVA, and any multimodal model served by vLLM.

    Args:
        images_b64: List of base64-encoded image strings.
        prompt: User's text prompt/question about the images.
        model: Model name (defaults to settings.ACTIVE_MODEL).
        stream: Whether to stream the response.

    Returns:
        If stream=True: returns the requests.Response object for streaming.
        If stream=False: returns the full response text string.
    """
    # Use the configured active model (Qwen2.5-VL-7B-Instruct-AWQ by default)
    if not model:
        model = settings.ACTIVE_MODEL

    system_prompt = (
        "You are Smaran AI — a precise multimodal vision document analysis assistant. "
        "When analyzing images of invoices, bills, attendance reports, or technical documents, "
        "extract ALL line items, quantities, prices, dates, employee names, and totals into structured text. "
        "Use markdown tables for tabular data. Be thorough and accurate. "
        "If you see a chart or graph, describe the data points and trends precisely.\n"
        "IMPORTANT FOR VISUAL GRAPHS & CHARTS:\n"
        "If the user asks for a chart or visualization based on the extracted data, "
        "output a markdown code block with language 'chart' containing valid JSON:\n"
        "```chart\n"
        "{\n"
        '  "type": "bar" | "line" | "pie",\n'
        '  "title": "Chart Title",\n'
        '  "labels": ["Label1", ...],\n'
        '  "datasets": [{"label": "Dataset", "data": [num1, ...]}]\n'
        "}\n"
        "```\n"
    )

    # Build OpenAI-compatible multimodal message content
    # vLLM vision models expect images as image_url content blocks with base64 data URIs
    image_content_blocks = [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64}"
            }
        }
        for b64 in images_b64
    ]

    # Add the text prompt after images
    image_content_blocks.append({
        "type": "text",
        "text": prompt
    })

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": image_content_blocks}
    ]

    payload = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "max_tokens": 4096,
        "temperature": 0.2,
    }

    # Use vLLM OpenAI-compatible endpoint (VLLM_URL = http://inference-server:8000/v1)
    vllm_base = settings.VLLM_URL.rstrip("/")
    url = f"{vllm_base}/chat/completions"

    try:
        response = requests.post(url, json=payload, stream=stream, timeout=600)

        if response.status_code != 200:
            error_text = response.text
            logger.error(f"vLLM vision API error: {error_text}")
            raise ValueError(f"vLLM vision model returned error: {error_text}")

        if not stream:
            result = response.json()
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")

        return response

    except requests.exceptions.ConnectionError:
        raise ValueError(
            f"Cannot connect to vLLM inference server at {url}. "
            "Ensure the inference-server container is running."
        )
    except requests.exceptions.Timeout:
        raise ValueError("vLLM vision model request timed out (600s limit).")


def stream_vision_response(response) -> Generator[str, None, None]:
    """
    Parse streamed SSE response from vLLM's OpenAI-compatible endpoint.
    Yields text token strings.
    """
    try:
        for line in response.iter_lines():
            if not line:
                continue
            if isinstance(line, bytes):
                line = line.decode("utf-8")
            if line.startswith("data: "):
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    import json
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    token = delta.get("content", "")
                    if token:
                        yield token
                except Exception:
                    continue
    except Exception as e:
        logger.error(f"Vision stream parse error: {e}")


def cleanup_after_processing():
    """
    Explicit garbage collection routine for VRAM-constrained environments.
    Call after processing large vision files or BOM data.
    """
    gc.collect()
    logger.info("Garbage collection completed after large file processing.")
