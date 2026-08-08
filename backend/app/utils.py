import os
import csv
import json
import logging
import subprocess
import psutil
from pypdf import PdfReader
from sqlalchemy.orm import Session
from app.config import settings

logger = logging.getLogger(__name__)

# --- Ingestion File Parsers ---
def parse_file_content(file_path: str, file_type: str) -> str:
    """Parse text contents based on file extensions."""
    file_type = file_type.lower()

    if file_type == "pdf":
        try:
            reader = PdfReader(file_path)
            text_parts = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            return "\n\n".join(text_parts)
        except Exception as e:
            logger.error(f"Error parsing PDF file {file_path}: {e}")
            raise ValueError(f"Could not parse PDF content: {str(e)}")
            
    elif file_type == "csv":
        try:
            formatted_rows = []
            with open(file_path, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                headers = reader.fieldnames or []
                for idx, row in enumerate(reader):
                    row_parts = [f"{col}: {val}" for col, val in row.items() if val]
                    formatted_rows.append(f"Row {idx + 1}: " + ", ".join(row_parts))
            return "\n".join(formatted_rows)
        except Exception as e:
            logger.error(f"Error parsing CSV file {file_path}: {e}")
            raise ValueError(f"Could not parse CSV content: {str(e)}")

    elif file_type == "xlsx":
        try:
            from openpyxl import load_workbook
            wb = load_workbook(file_path, read_only=True, data_only=True)
            all_text_parts = []
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                rows = list(ws.iter_rows(values_only=True))
                if not rows:
                    continue
                # First row as headers
                headers = [str(h) if h is not None else "" for h in rows[0]]
                all_text_parts.append(f"Sheet: {sheet_name}")
                all_text_parts.append(f"Columns: {', '.join(headers)}")
                for idx, row in enumerate(rows[1:], start=1):
                    row_parts = []
                    for col_name, val in zip(headers, row):
                        if val is not None:
                            row_parts.append(f"{col_name}: {val}")
                    if row_parts:
                        all_text_parts.append(f"Row {idx}: " + ", ".join(row_parts))
            wb.close()
            return "\n".join(all_text_parts)
        except Exception as e:
            logger.error(f"Error parsing Excel file {file_path}: {e}")
            raise ValueError(f"Could not parse Excel content: {str(e)}")

    elif file_type == "docx":
        try:
            from docx import Document as WordDocument
            document = WordDocument(file_path)
            parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
            for table_index, table in enumerate(document.tables, start=1):
                parts.append(f"Table {table_index}:")
                for row_index, row in enumerate(table.rows, start=1):
                    cells = [cell.text.strip() for cell in row.cells]
                    parts.append(f"Row {row_index}: " + " | ".join(cells))
            return "\n".join(parts)
        except Exception as e:
            logger.error(f"Error parsing Word file {file_path}: {e}")
            raise ValueError(f"Could not parse Word content: {str(e)}")

    elif file_type == "pptx":
        try:
            from pptx import Presentation
            presentation = Presentation(file_path)
            parts = []
            for slide_index, slide in enumerate(presentation.slides, start=1):
                slide_parts = [f"Slide {slide_index}:"]
                for shape in slide.shapes:
                    if getattr(shape, "has_text_frame", False) and shape.text.strip():
                        slide_parts.append(shape.text.strip())
                    if getattr(shape, "has_table", False):
                        for row in shape.table.rows:
                            slide_parts.append(" | ".join(cell.text.strip() for cell in row.cells))
                parts.append("\n".join(slide_parts))
            return "\n\n".join(parts)
        except Exception as e:
            logger.error(f"Error parsing PowerPoint file {file_path}: {e}")
            raise ValueError(f"Could not parse PowerPoint content: {str(e)}")
            
    elif file_type in ["mp3", "wav", "m4a", "ogg", "flac"]:
        try:
            try:
                from faster_whisper import WhisperModel
                # Run model on CPU with INT8 quantization for fast offloaded inference
                model = WhisperModel("small", device="cpu", compute_type="int8")
                segments, info = model.transcribe(file_path, beam_size=5)
                transcripts = [segment.text for segment in segments]
                return f"[Audio Transcription for {os.path.basename(file_path)}]\n" + " ".join(transcripts)
            except ImportError:
                filename = os.path.basename(file_path)
                return f"[Audio File: {filename}] Audio content uploaded. Local faster-whisper package not installed. Size: {os.path.getsize(file_path)} bytes."
        except Exception as e:
            logger.error(f"Error parsing audio file {file_path}: {e}")
            raise ValueError(f"Could not parse audio content: {str(e)}")

    elif file_type in ["mp4", "avi", "mkv", "webm", "mov", "flv"]:
        # Extract audio from video, then transcribe with Whisper
        try:
            import tempfile
            audio_extracted = False
            tmp_audio_path = None
            try:
                from moviepy import VideoFileClip
                tmp_audio_path = tempfile.mktemp(suffix=".wav")
                clip = VideoFileClip(file_path)
                clip.audio.write_audiofile(tmp_audio_path, logger=None)
                clip.close()
                audio_extracted = True
            except ImportError:
                pass
            except Exception as ve:
                logger.warning(f"moviepy failed to extract audio from {file_path}: {ve}")

            if audio_extracted and tmp_audio_path and os.path.exists(tmp_audio_path):
                try:
                    from faster_whisper import WhisperModel
                    model = WhisperModel("small", device="cpu", compute_type="int8")
                    segments, info = model.transcribe(tmp_audio_path, beam_size=5)
                    transcripts = [segment.text for segment in segments]
                    os.remove(tmp_audio_path)
                    return f"[Video Transcription for {os.path.basename(file_path)}]\n" + " ".join(transcripts)
                except ImportError:
                    os.remove(tmp_audio_path)
                    return f"[Video File: {os.path.basename(file_path)}] Audio extracted but faster-whisper not installed for transcription."
                except Exception as we:
                    logger.error(f"Whisper transcription failed for video {file_path}: {we}")
                    return f"[Video File: {os.path.basename(file_path)}] Audio extraction succeeded but transcription failed: {str(we)}"
            else:
                return f"[Video File: {os.path.basename(file_path)}] Could not extract audio (moviepy not installed or no audio track). File size: {os.path.getsize(file_path)} bytes."
        except Exception as e:
            logger.error(f"Error parsing video file {file_path}: {e}")
            raise ValueError(f"Could not parse video content: {str(e)}")

    elif file_type in ["png", "jpg", "jpeg", "webp", "bmp", "tiff"]:
        try:
            from app.vision import call_vision_model, encode_image_base64
            with open(file_path, "rb") as f:
                img_bytes = f.read()
            img_b64 = encode_image_base64(img_bytes)
            # Call vision model synchronously
            description = call_vision_model(
                images_b64=[img_b64],
                prompt="Analyze this document image, drawing, diagram or figure. Extract all text, numbers, labels, columns, and structured information in detail. Describe any charts or graphical plots precisely for indexing in a text search database.",
                stream=False
            )
            return f"[Visual Figure Description for {os.path.basename(file_path)}]\n{description}"
        except Exception as e:
            logger.error(f"Error calling vision model for image parse: {e}")
            return f"[Image File: {os.path.basename(file_path)}] Failed to automatically extract vision description: {str(e)}"

    elif file_type in ["txt", "md", "xml", "py", "cpp", "h", "json", "yaml", "yml", "log", "html", "htm"]:
        try:
            with open(file_path, mode="r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            if file_type == "json":
                # Beautify JSON for embedding readability
                try:
                    parsed = json.loads(content)
                    return json.dumps(parsed, indent=2)
                except Exception:
                    pass
            return content
        except Exception as e:
            logger.error(f"Error parsing text file {file_path}: {e}")
            raise ValueError(f"Could not read text content: {str(e)}")
            
    else:
        # Fallback raw read
        try:
            with open(file_path, mode="r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception as e:
            raise ValueError(f"Unsupported file format: {file_type}. Parse failed: {str(e)}")


def fetch_url_content(url: str) -> str:
    """Fetch and extract clean readable text from a URL.
    
    Supports:
    - Regular web pages (via requests + BeautifulSoup)
    - YouTube URLs (extracts title + description)
    
    Returns extracted text for AI processing.
    """
    try:
        import re as _re
        # YouTube URL handling
        yt_patterns = [
            r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)',
        ]
        for pattern in yt_patterns:
            match = _re.search(pattern, url)
            if match:
                video_id = match.group(1)
                # Try to get video info via YouTube oembed (no API key required)
                try:
                    import requests as _r
                    resp = _r.get(f"https://www.youtube.com/oembed?url={url}&format=json", timeout=10)
                    if resp.ok:
                        data = resp.json()
                        title = data.get("title", "Unknown")
                        author = data.get("author_name", "Unknown")
                        return f"[YouTube Video]\nTitle: {title}\nChannel: {author}\nURL: {url}\n\nNote: Full transcript not available without YouTube API. The AI has the video title and channel info."
                except Exception:
                    pass
                return f"[YouTube Video: {video_id}]\nURL: {url}\nNote: Could not fetch video metadata."

        # General web page extraction
        import requests as _r
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
        resp = _r.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        
        if "text/html" in content_type or not content_type:
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(resp.text, "html.parser")
                # Remove script, style, nav, footer noise
                for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
                    tag.decompose()
                # Get title
                title = soup.title.string.strip() if soup.title else ""
                # Extract main content: try article/main first, then body
                main = soup.find("article") or soup.find("main") or soup.find("body")
                text = main.get_text(separator="\n", strip=True) if main else soup.get_text(separator="\n", strip=True)
                # Clean up excessive blank lines
                lines = [l.strip() for l in text.splitlines() if l.strip()]
                clean_text = "\n".join(lines)
                # Limit to ~50000 chars
                if len(clean_text) > 50000:
                    clean_text = clean_text[:50000] + "\n\n[Content truncated...]"
                return f"[Web Page: {title}]\nURL: {url}\n\n{clean_text}"
            except ImportError:
                # BeautifulSoup not available, return raw text
                text = resp.text[:50000]
                return f"[Web Page]\nURL: {url}\n\n{text}"
        elif "application/json" in content_type:
            return f"[JSON API Response]\nURL: {url}\n\n{resp.text[:50000]}"
        elif "text/plain" in content_type:
            return f"[Text Content]\nURL: {url}\n\n{resp.text[:50000]}"
        else:
            return f"[Content from URL: {url}]\nContent-Type: {content_type}\n\n{resp.text[:10000]}"
    except Exception as e:
        raise ValueError(f"Could not fetch URL content from '{url}': {str(e)}")


# --- System Performance Diagnostics ---
def get_folder_size_mb(path: str) -> float:
    """Return the total size of files under the specified path in MB."""
    if not os.path.exists(path):
        return 0.0
    if os.path.isfile(path):
        return os.path.getsize(path) / (1024 * 1024)
        
    total_size = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.exists(fp):
                total_size += os.path.getsize(fp)
    return total_size / (1024 * 1024)

import time

# Performance trackers for rate calculations (disk read/write speed and network traffic speed)
_last_telemetry_time = None
_last_net_io = None
_last_disk_io = None

def get_system_telemetry(db: Session, active_sessions: int, latency_ms: float) -> dict:
    """Calculate system-wide resource metrics using auto-detected host hardware specs.
    
    Priority:
      1. host_stats.json  — written every second by host_stats_bridge.py on the Windows host.
                            This gives 100% accurate real Task Manager figures.
      2. nvidia-smi       — direct subprocess call; works inside Docker with GPU passthrough.
      3. psutil           — container-level fallback (RAM/CPU will reflect container limits).
    """
    global _last_telemetry_time, _last_net_io, _last_disk_io

    now = time.time()
    dt = now - _last_telemetry_time if _last_telemetry_time else 1.0
    if dt <= 0:
        dt = 1.0
    _last_telemetry_time = now

    # ── Try reading from host_stats_bridge output (most accurate) ────────────
    _hs = {}
    try:
        data_dir = os.getenv("DATA_DIR", "/app/data")
        hs_path = os.path.join(data_dir, "host_stats.json")
        if os.path.exists(hs_path):
            age = time.time() - os.path.getmtime(hs_path)
            if age < 5:  # Only use if written within last 5 seconds
                with open(hs_path) as f:
                    _hs = json.load(f)
    except Exception:
        pass

    # ── Also read hardware_config.json for static hardware specs ─────────────
    _hw = {}
    try:
        hw_path = os.path.join(os.getenv("DATA_DIR", "/app/data"), "hardware_config.json")
        if os.path.exists(hw_path):
            with open(hw_path) as f:
                _hw = json.load(f)
    except Exception:
        pass

    # ── 1. CPU ────────────────────────────────────────────────────────────────
    if _hs:
        cpu_usage  = float(_hs.get("cpu_usage", 0.0))
        cpu_name   = str(_hs.get("cpu_name", ""))
        cpu_cores  = int(_hs.get("cpu_cores", 0))
        cpu_threads = int(_hs.get("cpu_threads", 0)) or (cpu_cores * 2)
    else:
        cpu_usage = psutil.cpu_percent(interval=0.1)
        cpu_name  = str(_hw.get("host_cpu_name", ""))
        cpu_cores = int(_hw.get("host_cpu_cores", 0)) or psutil.cpu_count(logical=False) or 8
        cpu_threads = psutil.cpu_count(logical=True) or (cpu_cores * 2)
        if not cpu_name:
            try:
                if os.path.exists("/proc/cpuinfo"):
                    with open("/proc/cpuinfo") as f:
                        for line in f:
                            if line.strip().startswith("model name"):
                                cpu_name = line.split(":", 1)[1].strip()
                                break
            except Exception:
                pass
        if not cpu_name:
            cpu_name = _hw.get("host_cpu_name", "AMD Ryzen 9 4900H")

    # ── 2. Memory ─────────────────────────────────────────────────────────────
    if _hs:
        mem_pct      = float(_hs.get("ram_percent", 0.0))
        mem_used_gb  = float(_hs.get("ram_used_gb", 0.0))
        mem_total_gb = float(_hs.get("ram_total_gb", 0.0))
    else:
        host_ram_total = float(_hw.get("host_ram_total_gb", 0) or 0)
        try:
            mem = psutil.virtual_memory()
            mem_pct = mem.percent
            mem_total_gb = host_ram_total if host_ram_total > 0 else round(mem.total / (1024**3), 2)
            mem_used_gb  = round((mem_pct / 100.0) * mem_total_gb, 2)
        except Exception:
            mem_pct      = 0.0
            mem_total_gb = host_ram_total if host_ram_total > 0 else 16.0
            mem_used_gb  = 0.0

    # ── 3. GPU ────────────────────────────────────────────────────────────────
    if _hs and _hs.get("gpu_available"):
        gpu_available   = True
        gpu_usage       = float(_hs.get("gpu_usage", 0.0))
        gpu_name        = str(_hs.get("gpu_name", ""))
        gpu_vram_used   = float(_hs.get("gpu_vram_used_gb", 0.0))
        gpu_vram_total  = float(_hs.get("gpu_vram_total_gb", 0.0))
        gpu_temperature = float(_hs.get("gpu_temperature", 0.0))
        _nvidia_smi_ok  = True
    else:
        # Fall back to nvidia-smi / torch.cuda / hardware_config inside container
        gpu_usage       = 0.0
        gpu_name        = str(_hw.get("host_gpu_name") or _hw.get("gpu_name") or "")
        gpu_vram_used   = 0.0
        gpu_vram_total  = float(_hw.get("host_gpu_vram_gb") or _hw.get("gpu_vram_total") or 0.0)
        gpu_temperature = 0.0
        _nvidia_smi_ok  = False

        for nvsmi in ["nvidia-smi"]:
            try:
                res = subprocess.run(
                    [nvsmi,
                     "--query-gpu=utilization.gpu,name,memory.used,memory.total,temperature.gpu",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=3
                )
                if res.returncode == 0 and res.stdout.strip():
                    parts = res.stdout.strip().split("\n")[0].split(",")
                    if len(parts) >= 4:
                        gpu_usage      = float(parts[0].strip())
                        gpu_name       = parts[1].strip()
                        gpu_vram_used  = round(float(parts[2].strip()) / 1024.0, 2)
                        gpu_vram_total = round(float(parts[3].strip()) / 1024.0, 2)
                        if len(parts) >= 5:
                            gpu_temperature = float(parts[4].strip())
                        _nvidia_smi_ok = True
                        break
            except Exception:
                continue

        if not _nvidia_smi_ok:
            try:
                import torch
                if torch.cuda.is_available():
                    _nvidia_smi_ok = True
                    gpu_name = gpu_name or torch.cuda.get_device_name(0)
                    total_mem = torch.cuda.get_device_properties(0).total_memory / (1024**3)
                    gpu_vram_total = gpu_vram_total or round(total_mem, 1)
            except Exception:
                pass

        if not gpu_name or "Not" in gpu_name:
            gpu_name = _hw.get("host_gpu_name") or "NVIDIA GeForce RTX 2060"
        if not gpu_vram_total:
            gpu_vram_total = 6.0

        gpu_available = True

    # ── 4. Disk ───────────────────────────────────────────────────────────────
    # disk_io_pct    = disk I/O ACTIVITY %  (matches Task Manager "Disk %")
    # disk_space_pct = disk SPACE used %   (e.g. 246 GB / 679 GB = 37%)
    if _hs:
        disk_io_pct       = float(_hs.get("disk_io_pct", 0.0))
        disk_space_pct    = float(_hs.get("disk_space_pct", 0.0))
        disk_used_gb      = float(_hs.get("disk_space_used_gb", _hs.get("disk_used_gb", 0.0)))
        disk_total_gb     = float(_hs.get("disk_space_total_gb", _hs.get("disk_total_gb", 0.0)))
        disk_read_kb      = float(_hs.get("disk_read_kb", 0.0))
        disk_write_kb     = float(_hs.get("disk_write_kb", 0.0))
    else:
        disk_io_pct = disk_space_pct = disk_used_gb = disk_total_gb = 0.0
        disk_read_kb = disk_write_kb = 0.0
        try:
            disk = psutil.disk_usage('/')
            disk_space_pct = round(disk.percent, 1)
            disk_io_pct    = 0.0   # cannot compute inside container
            disk_used_gb   = round(disk.used  / (1024**3), 2)
            disk_total_gb  = round(disk.total / (1024**3), 2)
            disk_io = psutil.disk_io_counters()
            if disk_io and _last_disk_io:
                disk_read_kb  = round(((disk_io.read_bytes  - _last_disk_io.read_bytes)  / 1024.0) / dt, 1)
                disk_write_kb = round(((disk_io.write_bytes - _last_disk_io.write_bytes) / 1024.0) / dt, 1)
            _last_disk_io = disk_io
        except Exception:
            pass

    # ── 5. Network ────────────────────────────────────────────────────────────
    if _hs:
        net_up_kb   = float(_hs.get("net_up_kb", 0.0))
        net_down_kb = float(_hs.get("net_down_kb", 0.0))
    else:
        net_up_kb = net_down_kb = 0.0
        try:
            net_io = psutil.net_io_counters()
            if net_io and _last_net_io:
                net_up_kb   = round(((net_io.bytes_sent - _last_net_io.bytes_sent) / 1024.0) / dt, 1)
                net_down_kb = round(((net_io.bytes_recv - _last_net_io.bytes_recv) / 1024.0) / dt, 1)
            _last_net_io = net_io
        except Exception:
            pass

    # ── 6. Database size ──────────────────────────────────────────────────────
    sqlite_size = get_folder_size_mb(settings.SQLITE_DB_PATH)
    chroma_size = get_folder_size_mb(settings.CHROMA_DIR)
    db_size     = round(sqlite_size + chroma_size, 2)

    # ── 7. Model info ─────────────────────────────────────────────────────────
    model_display_name = _hw.get("display_name", "")
    ctx_window         = int(_hw.get("ctx_window", 0) or 0)
    reasoning_model    = bool(_hw.get("reasoning_model", False))
    selected_model_id  = str(_hw.get("model_id", ""))

    return {
        "cpu_usage":          cpu_usage,
        "cpu_cores":          cpu_cores,
        "cpu_threads":        cpu_threads,
        "cpu_name":           cpu_name,
        "memory_usage":       mem_pct,
        "memory_used_gb":     mem_used_gb,
        "memory_total_gb":    mem_total_gb,
        "gpu_available":      gpu_available,
        "gpu_usage":          gpu_usage,
        "gpu_name":           gpu_name,
        "gpu_vram_used":      gpu_vram_used,
        "gpu_vram_total":     gpu_vram_total,
        "gpu_temperature":    gpu_temperature,
        # disk_usage = I/O ACTIVITY % (matches Task Manager) — shown as gauge
        "disk_usage":         disk_io_pct,
        # disk_space_pct = storage SPACE used % — shown as subtitle text
        "disk_space_pct":     disk_space_pct,
        "disk_used_gb":       disk_used_gb,
        "disk_total_gb":      disk_total_gb,
        "disk_read_kb":       max(0.0, disk_read_kb),
        "disk_write_kb":      max(0.0, disk_write_kb),
        "net_up_kb":          net_up_kb,
        "net_down_kb":        net_down_kb,
        "active_sessions":    active_sessions,
        "database_size_mb":   db_size,
        "average_latency_ms": round(latency_ms, 1),
        # Model info — synced live from hardware_config.json
        "model_display_name": model_display_name,
        "model_id":           selected_model_id,
        "ctx_window":         ctx_window,
        "reasoning_model":    reasoning_model,
    }

import httpx

async def zep_add_message(session_id: str, role: str, content: str):
    """Asynchronously send chat messages to Zep AI Memory service."""
    zep_url = os.getenv("ZEP_URL", "http://zep-ai:8000")
    # Zep expects 'user' or 'ai' roles
    zep_role = "ai" if role == "assistant" else role
    payload = {
        "messages": [
            {
                "role": zep_role,
                "content": content
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            url = f"{zep_url.rstrip('/')}/api/v1/sessions/{session_id}/memory"
            r = await client.post(url, json=payload)
            if r.status_code != 200:
                logger.warning(f"Zep AI memory add failed with status {r.status_code}: {r.text}")
    except Exception as e:
        logger.warning(f"Failed to connect to Zep AI for session {session_id}: {e}")

async def zep_get_history(session_id: str) -> list[dict]:
    """Retrieve sliding window memory history from Zep AI."""
    zep_url = os.getenv("ZEP_URL", "http://zep-ai:8000")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            url = f"{zep_url.rstrip('/')}/api/v1/sessions/{session_id}/memory"
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                messages = data.get("messages", [])
                history = []
                for msg in messages:
                    role = "assistant" if msg.get("role") == "ai" else msg.get("role")
                    history.append({"role": role, "content": msg.get("content", "")})
                return history
    except Exception as e:
        logger.warning(f"Failed to fetch history from Zep AI for session {session_id}: {e}")
    return []


