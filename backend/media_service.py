"""Isolated local image generation and video-frame caption API."""
import base64
import io
import os
from typing import List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
from local_image import generate_local_image

app = FastAPI(title="Smaran Local Media")
caption_model = None
caption_processor = None
transcribe_model = None

class GenerateRequest(BaseModel):
    prompt: str

class CaptionRequest(BaseModel):
    frames: List[str]
    ocr: bool = False

class TranscribeRequest(BaseModel):
    filename: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/generate")
def generate(request: GenerateRequest):
    try:
        filename = generate_local_image(request.prompt, "/data/uploads")
        return {"filename": filename}
    except Exception as exc:
        raise HTTPException(500, str(exc))

@app.post("/caption")
def caption(request: CaptionRequest):
    global caption_model, caption_processor
    try:
        import torch
        from transformers import BlipForConditionalGeneration, BlipProcessor
        if caption_model is None:
            caption_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
            caption_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
        frames = request.frames[:12]
        images = [
            Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
            for encoded in frames
        ]

        def run(device: str):
            if device == "cuda":
                caption_model.half().to(device)
            else:
                caption_model.float().to(device)
            inputs = caption_processor(images=images, return_tensors="pt")
            inputs = {key: value.to(device) for key, value in inputs.items()}
            if device == "cuda" and "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].half()
            tokens = caption_model.generate(**inputs, max_new_tokens=35)
            descriptions = caption_processor.batch_decode(tokens, skip_special_tokens=True)
            return [f"Frame {index + 1}: {description}" for index, description in enumerate(descriptions)]

        use_cuda = torch.cuda.is_available() and os.getenv("VIDEO_CAPTION_DEVICE", "cuda") == "cuda"
        try:
            output = run("cuda" if use_cuda else "cpu")
        except RuntimeError:
            if not use_cuda:
                raise
            torch.cuda.empty_cache()
            output = run("cpu")
        finally:
            if use_cuda:
                caption_model.float().to("cpu")
                torch.cuda.empty_cache()
        ocr_results = []
        if request.ocr:
            import pytesseract
            for index, image in enumerate(images[:3]):
                try:
                    text = pytesseract.image_to_string(image, lang="eng+hin", config="--psm 6").strip()
                except Exception:
                    text = pytesseract.image_to_string(image, lang="eng", config="--psm 6").strip()
                if text:
                    ocr_results.append(f"Image {index + 1} OCR text:\n{text}")
        return {"captions": output, "ocr": ocr_results}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.post("/transcribe")
def transcribe(request: TranscribeRequest):
    global transcribe_model
    filename = os.path.basename(request.filename)
    if filename != request.filename or not filename.lower().endswith((".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mp4", ".avi", ".mkv", ".webm", ".mov", ".flv")):
        raise HTTPException(400, "Invalid media filename")
    media_path = os.path.join("/data/uploads", filename)
    if not os.path.isfile(media_path):
        raise HTTPException(404, "Uploaded media file not found")
    try:
        from faster_whisper import WhisperModel
        if transcribe_model is None:
            device = "cuda" if os.getenv("MEDIA_WHISPER_DEVICE", "cuda") == "cuda" else "cpu"
            transcribe_model = WhisperModel(
                os.getenv("MEDIA_WHISPER_MODEL", "tiny"),
                device=device,
                compute_type="float16" if device == "cuda" else "int8",
            )
        segments, _ = transcribe_model.transcribe(media_path, beam_size=2, vad_filter=True)
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        return {"transcript": text}
    except Exception as exc:
        raise HTTPException(500, str(exc))
