"""Ground YouTube answers in the video's real transcript, audio and frames."""
import os
import shutil
import tempfile
import base64
import io

_caption_model = None
_caption_processor = None


def _transcript(video_id):
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        preferred_langs = ["en", "hi", "en-US", "hi-IN", "es", "fr", "de", "ja", "zh"]
        try:
            snippets = api.fetch(video_id, languages=preferred_langs)
            return " ".join(getattr(x, "text", str(x)) for x in snippets)[:50000]
        except Exception:
            pass
        try:
            transcript_list = api.list(video_id)
            for t in transcript_list:
                try:
                    data = t.fetch()
                    return " ".join(getattr(x, "text", str(x)) for x in data)[:50000]
                except Exception:
                    continue
        except Exception:
            pass
    except Exception:
        pass
    return ""


def _audio(video_path):
    try:
        from faster_whisper import WhisperModel
        model_name = os.getenv("YOUTUBE_WHISPER_MODEL", "tiny")
        segments, _ = WhisperModel(model_name, device="cpu", compute_type="int8").transcribe(video_path, beam_size=2, vad_filter=True)
        return " ".join(x.text for x in segments)[:50000]
    except Exception:
        return ""


def _frames(video_path, count=8):
    try:
        import cv2
        from app.vision import encode_image_base64
        cap, output = cv2.VideoCapture(video_path), []
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total > 0:
            for index in range(count):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int((index + 0.5) * total / count))
                ok, frame = cap.read()
                if ok:
                    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if ok:
                        output.append(encode_image_base64(encoded.tobytes()))
        cap.release()
        return output
    except Exception:
        return []


def _caption_frames(frames):
    """CPU fallback when the configured chat server is not multimodal."""
    global _caption_model, _caption_processor
    try:
        import requests
        service_url = os.getenv("LOCAL_IMAGE_SERVICE_URL", "http://media-generator:8002")
        response = requests.post(f"{service_url}/caption", json={"frames": frames}, timeout=600)
        if response.ok:
            return "\n".join(response.json().get("captions", []))
    except Exception:
        pass
    try:
        from PIL import Image
        from transformers import BlipForConditionalGeneration, BlipProcessor
        if _caption_model is None:
            _caption_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
            _caption_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
        captions = []
        for index, encoded in enumerate(frames):
            image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
            inputs = _caption_processor(images=image, return_tensors="pt")
            output = _caption_model.generate(**inputs, max_new_tokens=35)
            captions.append(f"Frame {index + 1}: {_caption_processor.decode(output[0], skip_special_tokens=True)}")
        return "\n".join(captions)
    except Exception:
        return ""


def analyze_youtube_video(url, video_id):
    transcript = _transcript(video_id)
    visual, error = "", ""
    title, channel, duration, description = f"YouTube video {video_id}", "", 0, ""
    
    # Extract metadata using yt_dlp without heavy video download if transcript is available
    try:
        from yt_dlp import YoutubeDL
        ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                title = info.get("title") or title
                channel = info.get("uploader") or info.get("channel") or ""
                duration = int(info.get("duration") or 0)
                description = (info.get("description") or "")[:2000]
    except Exception as meta_err:
        error = str(meta_err)

    # Download frames/audio only if transcript was not retrieved
    if not transcript:
        temp_dir = tempfile.mkdtemp(prefix="smaran_youtube_")
        try:
            from yt_dlp import YoutubeDL
            options = {
                "format": "best[height<=360][ext=mp4]/best[height<=360]/worst",
                "outtmpl": os.path.join(temp_dir, "video.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
                "max_filesize": 400 * 1024 * 1024,
                "noplaylist": True
            }
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get("title") or title
                channel = info.get("channel") or info.get("uploader") or ""
                duration = int(info.get("duration") or 0)
                description = (info.get("description") or "")[:2000]
                video_path = ydl.prepare_filename(info)

            if not transcript and os.path.exists(video_path):
                transcript = _audio(video_path)

            frame_count = 4 if duration <= 60 else (8 if duration <= 600 else 12)
            frames = _frames(video_path, count=frame_count) if os.path.exists(video_path) else []
            if frames:
                visual = _caption_frames(frames)
                if not visual and os.getenv("VIDEO_VISION_MODEL_ENABLED", "0") == "1":
                    try:
                        from app.vision import call_vision_model
                        visual = call_vision_model(frames, "These are chronological frames from one video. Describe only what visibly happens, in order. Do not infer unseen events.", stream=False)[:20000]
                    except Exception as exc:
                        error = f"Visual model unavailable: {exc}"
        except Exception as exc:
            error = str(exc)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    evidence = [f"Title: {title}", f"Channel: {channel}", f"Duration seconds: {duration}"]
    if description:
        evidence.append("Video Description:\n" + description)
    if transcript:
        evidence.append("Actual speech/transcript from inside the video:\n" + transcript)
    if visual:
        evidence.append("Actual sampled-frame visual analysis:\n" + visual)
    if not transcript and not visual and not description:
        evidence.append("Content extraction failed; do not guess the video content. Error: " + error)
    
    return {
        "title": title,
        "snippet": "\n\n".join(evidence),
        "url": url,
        "content_verified": bool(transcript or visual or description)
    }

