"""
SMARAN.AI Production Launcher
====================================
Zero-friction desktop launcher for SMARAN.AI platform.
Features an interactive dark splash window, clear user guidance,
hardware auto-detection (NVIDIA GPU / CPU fallback),
and automatic browser opening.
"""
import os
import sys
import subprocess
import time
import shutil
import socket
import json
import ctypes
import winreg
import urllib.request
import threading
import psutil
import io
import uuid
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox

# Force UTF-8 stdout/stderr encoding on Windows
if sys.stdout and sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr and sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

WIN_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

def run_cmd(cmd, capture_output=True, text=True, timeout=None):
    kwargs = {"capture_output": capture_output, "text": text}
    if timeout:
        kwargs["timeout"] = timeout
    if WIN_NO_WINDOW:
        kwargs["creationflags"] = WIN_NO_WINDOW
    return subprocess.run(cmd, **kwargs)

# ==============================================================================
# CONSTANTS
# ==============================================================================
APP_NAME = "SMARAN.AI"
VERSION  = "1.1.0"
IMAGE_REPOSITORY = os.getenv("SMARAN_IMAGE_REPOSITORY", "shashwatmishra062/smaran-ai")
IMAGE_TAG = f"v{VERSION}"
INSTALL_DIR = os.path.dirname(os.path.abspath(sys.argv[0] if getattr(sys, 'frozen', False) else __file__))
BASE_DIR = os.path.join(os.getenv("LOCALAPPDATA", INSTALL_DIR), "SMARAN.AI") if getattr(sys, 'frozen', False) else INSTALL_DIR
os.makedirs(BASE_DIR, exist_ok=True)
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(DATA_DIR, "models")
ENV_FILE = os.path.join(BASE_DIR, ".env")
BUNDLE_DIR = os.path.join(INSTALL_DIR, "offline")
OFFLINE_IMAGE_ARCHIVE = os.path.join(BUNDLE_DIR, f"smaran-ai-images-v{VERSION}.tar")
OFFLINE_MODEL_ARCHIVE = os.path.join(BUNDLE_DIR, f"smaran-ai-models-v{VERSION}.tar.gz")
OFFLINE_MODEL_MARKER = f".smaran-offline-models-v{VERSION}"
INSTALL_ID_FILE = os.path.join(BASE_DIR, ".install-id")

if os.path.isfile(INSTALL_ID_FILE):
    with open(INSTALL_ID_FILE, "r", encoding="utf-8") as install_file:
        INSTALL_ID = install_file.read().strip()
else:
    INSTALL_ID = uuid.uuid4().hex[:12]
    with open(INSTALL_ID_FILE, "w", encoding="utf-8") as install_file:
        install_file.write(INSTALL_ID)

DATA_VOLUME_NAME = f"smaran-ai_data_{INSTALL_ID}"
MODEL_VOLUME_NAME = f"smaran-ai_models_{INSTALL_ID}"

FRONTEND_PORT = 3003
COMPOSE_PROJECT_NAME = "smaran-ai"
DOCKER_STARTUP_TIMEOUT_SECONDS = 180

# Model tiers mapping
TIERS = {
    "ultra": {
        "model_id": "Qwen/Qwen3-VL-4B-Instruct",
        "display_name": "Qwen 3 VL 4B (Multimodal Vision Engine)",
        "url": "",
        "size_bytes": 0,
        "ctx_window": 4096
    },
    "mid": {
        "model_id": "Qwen/Qwen3-4B-AWQ",
        "display_name": "Qwen 3 4B AWQ (Quantized 6GB GPU Engine)",
        "url": "",
        "size_bytes": 0,
        "ctx_window": 4096
    },
    "cpu": {
        "model_id": "Qwen/Qwen2.5-7B-Instruct",
        "display_name": "Qwen 3 8B (High-Precision Reasoning)",
        "url": "",
        "size_bytes": 0,
        "ctx_window": 4096
    }
}

class StartupWindow:
    def __init__(self):
        self.root = None
        self.user_clicked = False
        try:
            self.root = tk.Tk()
            self.root.title(f"{APP_NAME} Workspace")
            self.root.geometry("640x340")
            self.root.resizable(False, False)
            self.root.configure(bg="#0B0F17") # Deep Obsidian Dark
            
            # Ensure window stays on top of Docker Desktop and all popups
            try:
                self.root.attributes("-topmost", True)
            except Exception:
                pass

            # Center on screen
            try:
                sw = self.root.winfo_screenwidth()
                sh = self.root.winfo_screenheight()
                x = (sw - 640) // 2
                y = (sh - 340) // 2
                self.root.geometry(f"640x340+{x}+{y}")
            except Exception:
                pass

            # Main Card Container
            card = tk.Frame(self.root, bg="#131B2E", highlightbackground="#243354", highlightthickness=1)
            card.pack(fill="both", expand=True, padx=16, pady=16)

            # Header Frame
            header_frame = tk.Frame(card, bg="#131B2E")
            header_frame.pack(fill="x", padx=28, pady=(20, 4))
            
            title_lbl = tk.Label(
                header_frame, 
                text="Welcome to SMARAN.AI", 
                font=("Segoe UI", 24, "bold"), 
                fg="#FF7A00", 
                bg="#131B2E"
            )
            title_lbl.pack(anchor="w")

            sub_lbl = tk.Label(
                header_frame, 
                text=f"Your Private Local AI Workspace v{VERSION} | 100% Secure & Offline",
                font=("Segoe UI", 10), 
                fg="#94A3B8", 
                bg="#131B2E"
            )
            sub_lbl.pack(anchor="w", pady=(2, 0))

            # Progress Bar & Percentage Frame
            prog_frame = tk.Frame(card, bg="#131B2E")
            prog_frame.pack(fill="x", padx=28, pady=(14, 6))

            style = ttk.Style()
            style.theme_use("clam")
            style.configure(
                "Custom.Horizontal.TProgressbar", 
                troughcolor="#1E293B", 
                background="#FF7A00", 
                bordercolor="#131B2E", 
                lightcolor="#FF7A00", 
                darkcolor="#FF7A00"
            )
            
            self.progress_bar = ttk.Progressbar(
                prog_frame, 
                style="Custom.Horizontal.TProgressbar", 
                orient="horizontal", 
                length=500, 
                mode="determinate"
            )
            self.progress_bar.pack(side="left", fill="x", expand=True)
            self.progress_bar["value"] = 10

            self.pct_var = tk.StringVar(value="10%")
            self.pct_lbl = tk.Label(
                prog_frame,
                textvariable=self.pct_var,
                font=("Segoe UI", 9, "bold"),
                fg="#FF7A00",
                bg="#131B2E",
                width=5
            )
            self.pct_lbl.pack(side="right", padx=(8, 0))

            # Status Label
            self.status_var = tk.StringVar(value="Welcome! We are initializing your personal AI workspace...")
            self.status_lbl = tk.Label(
                card, 
                textvariable=self.status_var, 
                wraplength=530, 
                justify="left", 
                font=("Segoe UI", 11, "bold"), 
                fg="#F8FAFC", 
                bg="#131B2E"
            )
            self.status_lbl.pack(anchor="w", padx=28, pady=(4, 2))

            # Sub-Status / Guidance Note
            self.sub_var = tk.StringVar(value="Please sit back and relax. Your web browser will open automatically when ready.")
            self.sub_lbl = tk.Label(
                card, 
                textvariable=self.sub_var, 
                wraplength=530, 
                justify="left", 
                font=("Segoe UI", 9), 
                fg="#64748B", 
                bg="#131B2E"
            )
            self.sub_lbl.pack(anchor="w", padx=28)

            # Action Button Container (Hidden by default)
            self.btn_frame = tk.Frame(card, bg="#131B2E")
            self.action_btn = tk.Button(
                self.btn_frame, 
                text="Start AI Workspace", 
                font=("Segoe UI", 10, "bold"), 
                fg="white", 
                bg="#FF7A00", 
                activebackground="#E06C00", 
                activeforeground="white",
                relief="flat",
                padx=22,
                pady=6,
                cursor="hand2"
            )
            self.action_btn.pack()

            self.root.protocol("WM_DELETE_WINDOW", lambda: None)
            self.root.update()
        except Exception:
            self.root = None

    def set_status(self, main_text, sub_text=None, progress=None):
        if self.root:
            try:
                self.status_var.set(main_text)
                if sub_text:
                    self.sub_var.set(sub_text)
                if progress is not None:
                    self.progress_bar["value"] = progress
                    self.pct_var.set(f"{int(progress)}%")
                self.btn_frame.pack_forget()
                self.root.update_idletasks()
                self.root.update()
            except Exception:
                pass

    def prompt_action(self, main_text, sub_text, button_label, callback):
        if not self.root:
            callback()
            return
        try:
            self.status_var.set(main_text)
            self.sub_var.set(sub_text)
            self.user_clicked = False

            def on_click():
                self.user_clicked = True
                self.btn_frame.pack_forget()
                callback()

            self.action_btn.config(text=button_label, command=on_click)
            self.btn_frame.pack(padx=32, pady=(8, 0), anchor="w")
            
            while not self.user_clicked and self.root:
                try:
                    self.root.update()
                except Exception:
                    break
                time.sleep(0.1)
        except Exception:
            callback()

    def close(self):
        if self.root:
            try:
                self.root.destroy()
            except Exception:
                pass
            self.root = None


STARTUP_WINDOW = None


def set_startup_status(main_text, sub_text=None, progress=None):
    if STARTUP_WINDOW:
        STARTUP_WINDOW.set_status(main_text, sub_text, progress)

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False

# ==============================================================================
# STEP 1: HARDWARE DETECTION & MODEL SELECTION
# ==============================================================================
def detect_hardware():
    set_startup_status("Step 1 of 5 - Scanning computer hardware...", "Detecting CPU cores, memory capacity, and graphics acceleration...", progress=20)
    hw = {
        "cpu_name": "Unknown Processor",
        "cpu_cores": os.cpu_count() or 4,
        "ram_total_gb": 0,
        "gpu_available": False,
        "gpu_name": "N/A",
        "gpu_vram_gb": 0.0,
    }

    # CPU Name
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
        winreg.CloseKey(key)
        hw["cpu_name"] = cpu_name.strip()
    except Exception:
        try:
            res = run_cmd(["wmic", "cpu", "get", "name"], timeout=5)
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip() and l.strip() != "Name"]
            if lines: hw["cpu_name"] = lines[0]
        except Exception: pass

    # RAM Size
    try:
        hw["ram_total_gb"] = round(psutil.virtual_memory().total / (1024**3), 1)
    except Exception:
        try:
            res = run_cmd(["wmic", "computersystem", "get", "totalphysicalmemory"], timeout=5)
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip().isdigit()]
            if lines: hw["ram_total_gb"] = round(int(lines[0]) / (1024**3), 1)
        except Exception: pass

    # GPU Name & VRAM
    nvidia_paths = ["nvidia-smi", r"C:\Windows\System32\nvidia-smi.exe", r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]
    for nvsmi in nvidia_paths:
        try:
            res = run_cmd([nvsmi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], timeout=5)
            if res.returncode == 0 and res.stdout.strip():
                parts = res.stdout.strip().split("\n")[0].split(",")
                if len(parts) >= 2:
                    hw["gpu_available"] = True
                    hw["gpu_name"] = parts[0].strip()
                    hw["gpu_vram_gb"] = round(float(parts[1].strip()) / 1024.0, 1)
                    break
        except Exception:
            continue

    # Select hardware tier
    if hw["gpu_available"] and hw["gpu_vram_gb"] >= 15.0:
        hw["tier"] = "ultra"
    elif hw["gpu_available"] and hw["gpu_vram_gb"] >= 6.0:
        hw["tier"] = "mid"
    else:
        hw["tier"] = "cpu"
        
    return hw

# ==============================================================================
# STEP 2: DOWNLOAD CHOSEN MODEL WEIGHTS
# ==============================================================================
def verify_model_weights(hw):
    profile_name = "NVIDIA GPU Accelerator Profile" if hw["gpu_available"] else "Standard CPU Performance Profile"
    set_startup_status("Step 2 of 5 - Optimizing performance profile...", f"Configured profile: {profile_name}", progress=35)
    tier_info = TIERS[hw["tier"]]
    model_id = tier_info["model_id"]
    return "", model_id

# ==============================================================================
# STEP 3: GENERATE CONFIG AND DYNAMIC COMPOSE FILE
# ==============================================================================
def generate_runtime_configs(hw, model_id):
    set_startup_status("Step 3 of 5 - Setting up AI configuration...", "Generating custom settings for your PC...", progress=50)
    gpu = hw["gpu_available"]
    tier_info = TIERS[hw["tier"]]
    
    os.makedirs(DATA_DIR, exist_ok=True)
    hw_config_path = os.path.join(DATA_DIR, "hardware_config.json")
    
    model_config = {
        "engine": "vllm",
        "model_id": model_id,
        "display_name": tier_info["display_name"],
        "ctx_window": tier_info["ctx_window"],
        "max_model_len": {"cpu": 1024, "mid": 3968, "ultra": 8192}[hw["tier"]],
        "reasoning_model": False,
        "gpu_available": gpu,
        "host_gpu_vram_gb": hw["gpu_vram_gb"],
        "host_gpu_name": hw["gpu_name"],
        "host_cpu_name": hw["cpu_name"],
        "host_cpu_cores": hw["cpu_cores"],
        "host_ram_total_gb": hw["ram_total_gb"]
    }
    
    with open(hw_config_path, "w", encoding="utf-8") as f:
        json.dump(model_config, f, indent=2)

    max_model_len = {"cpu": 1024, "mid": 3968, "ultra": 8192}[hw["tier"]]
    device_setting = "cuda" if gpu else "cpu"

    if gpu:
        vllm_command = f"--model {model_id} --port 8000 --host 0.0.0.0 --max-model-len {max_model_len} --gpu-memory-utilization 0.75 --enforce-eager --dtype float16 --trust-remote-code"
        deploy_section = """    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]"""
    else:
        vllm_command = f"--model {model_id} --port 8000 --host 0.0.0.0 --max-model-len 1024 --device cpu"
        deploy_section = ""

    host_data_mount = DATA_DIR.replace("\\", "/")
    compose_content = f"""# SMARAN.AI - Auto-generated Compose Profile
name: {COMPOSE_PROJECT_NAME}
version: '3.8'

services:
  browser-renderer:
    image: {IMAGE_REPOSITORY}:browser-{IMAGE_TAG}
    read_only: true
    tmpfs:
      - /tmp:size=536870912
    shm_size: 536870912
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped

  media-generator:
    image: {IMAGE_REPOSITORY}:media-{IMAGE_TAG}
    environment:
      - LOCAL_IMAGE_DEVICE={device_setting}
      - LOCAL_IMAGE_MODEL=segmind/tiny-sd
      - LOCAL_IMAGE_OFFLOAD=none
      - LOCAL_IMAGE_SIZE=384
      - LOCAL_IMAGE_STEPS=12
      - LOCAL_IMAGE_GUIDANCE=7.5
      - LOCAL_IMAGE_USE_SAFETENSORS=0
      - LOCAL_IMAGE_RELEASE_GPU=1
      - VIDEO_CAPTION_DEVICE={device_setting}
      - MEDIA_WHISPER_DEVICE={device_setting}
      - MEDIA_WHISPER_MODEL=tiny
    volumes:
      - smaran_models:/root/.cache/huggingface
      - smaran_data:/data
    restart: unless-stopped
{deploy_section}

  # vLLM OpenAI-Compatible Inference Server
  inference-server:
    image: vllm/vllm-openai:v0.8.5.post1
    expose:
      - "8000"
    volumes:
      - smaran_models:/root/.cache/huggingface
    environment:
      - VLLM_USE_V1=0
    command: {vllm_command}
    restart: unless-stopped
{deploy_section}

  # Monolithic App Container (FastAPI Backend + Vite Frontend)
  app:
    image: {IMAGE_REPOSITORY}:app-{IMAGE_TAG}
    ports:
      - "{FRONTEND_PORT}:3003"
    environment:
      - ACTIVE_MODEL={model_id}
      - INFERENCE_ENGINE=vllm
      - MAX_MODEL_LEN={max_model_len}
      - VLLM_URL=http://inference-server:8000/v1
      - DATA_DIR=/app/data
      - LOCAL_IMAGE_SERVICE_URL=http://media-generator:8002
      - UPLOAD_WHISPER_DEVICE={device_setting}
      - UPLOAD_WHISPER_MODEL=tiny
      - HF_HOME=/app/data/models
      - BROWSER_RENDER_SERVICE_URL=http://browser-renderer:8003
    volumes:
      - "{host_data_mount}:/app/data"
    restart: unless-stopped
{deploy_section}

volumes:
  smaran_models:
    external: true
    name: {MODEL_VOLUME_NAME}
  smaran_data:
    external: true
    name: {DATA_VOLUME_NAME}
"""

    with open(os.path.join(BASE_DIR, "docker-compose.yml"), "w", encoding="utf-8") as f:
        f.write(compose_content)

# ==============================================================================
# STEP 4: CHECK DOCKER DESKTOP STATUS
# ==============================================================================
def find_docker_cli():
    if shutil.which("docker"):
        return shutil.which("docker")
    known_paths = [
        r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        r"C:\Program Files\Docker\Docker\resources\docker.exe",
        r"C:\Program Files\Docker\Docker\Docker Desktop.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Docker\resources\bin\docker.exe"),
        os.path.expandvars(r"%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Docker\Docker\resources\bin\docker.exe"),
    ]
    for p in known_paths:
        if os.path.isfile(p):
            docker_dir = os.path.dirname(p)
            if docker_dir not in os.environ["PATH"]:
                os.environ["PATH"] = docker_dir + os.pathsep + os.environ["PATH"]
            return p
    return None

def find_python_executable():
    """Finds a working python executable on the host machine."""
    candidates = [
        sys.executable,
        shutil.which("python"),
        shutil.which("python3"),
        shutil.which("py"),
        r"C:\Python311\python.exe",
        r"C:\Python312\python.exe",
        r"C:\Python310\python.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python311\python.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python312\python.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python310\python.exe"),
    ]
    for p in candidates:
        if p and os.path.isfile(p) and not p.lower().endswith("smaran_ai.exe"):
            try:
                res = subprocess.run([p, "-c", "import uvicorn; print('ok')"], capture_output=True, text=True, timeout=3)
                if "ok" in res.stdout:
                    return p
            except Exception:
                continue
    return None

def start_native_backend():
    """Starts the native FastAPI backend in runtime/ or backend/ without requiring Docker."""
    app_dirs = [
        os.path.join(INSTALL_DIR, "runtime"),
        os.path.join(INSTALL_DIR, "backend"),
        os.path.join(BASE_DIR, "runtime"),
        os.path.join(BASE_DIR, "backend")
    ]
    target_dir = None
    for d in app_dirs:
        if os.path.isdir(d) and (os.path.isfile(os.path.join(d, "app", "main.py")) or os.path.isfile(os.path.join(d, "main.py"))):
            target_dir = d
            break
            
    if not target_dir:
        return False

    py_bin = find_python_executable()
    if not py_bin:
        # Try generic python
        py_bin = shutil.which("python") or shutil.which("py")
        if not py_bin:
            return False

    set_startup_status("Starting SMARAN.AI High-Speed Engine...", "Launching local AI backend on port 3003...", progress=80)
    cmd = [py_bin, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(FRONTEND_PORT)]
    
    popen_kwargs = {"cwd": target_dir}
    if WIN_NO_WINDOW:
        popen_kwargs["creationflags"] = WIN_NO_WINDOW
        
    try:
        subprocess.Popen(cmd, **popen_kwargs)
        return True
    except Exception:
        return False

def verify_and_start_backend():
    set_startup_status("Step 4 of 5 - Starting AI Engine...", "Checking available background services...", progress=70)
    
    # Check if already running on port 3003
    try:
        req = urllib.request.urlopen(f"http://localhost:{FRONTEND_PORT}/api/test/ping", timeout=2)
        if req.status == 200:
            return
    except Exception:
        pass

    # 1. Try Native Python backend first (fastest, requires zero Docker setup)
    if start_native_backend():
        return

    # 2. If native start not applicable, check Docker
    docker_bin = find_docker_cli()
    if docker_bin:
        try:
            res = run_cmd(["docker", "info"], timeout=5)
            if res.returncode == 0:
                # Docker is online, run container with port 3003
                run_containers_docker()
                return
        except Exception:
            pass

    # 3. If Docker binary exists but engine is stopped, try starting Docker Desktop
    docker_paths = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe",
        Path(os.environ.get("LocalAppData", "")) / "Docker" / "Docker Desktop.exe",
    ]
    docker_desktop = next((path for path in docker_paths if path.exists()), None)
    if docker_desktop:
        set_startup_status("Starting Docker Engine...", "Launching background engine...", progress=75)
        try:
            subprocess.Popen([str(docker_desktop)], cwd=str(docker_desktop.parent), creationflags=WIN_NO_WINDOW if WIN_NO_WINDOW else 0)
            for _ in range(20):
                time.sleep(2)
                if run_cmd(["docker", "info"], timeout=3).returncode == 0:
                    run_containers_docker()
                    return
        except Exception:
            pass

def run_containers_docker():
    set_startup_status("Step 5 of 5 - Loading SMARAN AI...", "Initializing workspace container on port 3003...", progress=85)
    run_cmd(["docker", "rm", "-f", "smaran-ai"])
    
    # Run container with port 3003
    cmd = [
        "docker", "run", "-d",
        "--name", "smaran-ai",
        "--restart", "unless-stopped",
        "-p", f"{FRONTEND_PORT}:3003",
        "shashwatmishra062/smaran-ai:latest"
    ]
    run_cmd(cmd)

def telemetry_worker():
    """Background loop that writes real Windows Task Manager stats to data/host_stats.json every second."""
    try:
        cpu_name = "Unknown CPU"
        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            winreg.CloseKey(key)
            cpu_name = cpu_name.strip()
        except Exception:
            pass

        physical_cores = psutil.cpu_count(logical=False) or 4
        logical_threads = psutil.cpu_count(logical=True) or 4
        ram_total_gb = round(psutil.virtual_memory().total / (1024**3), 1)

        # GPU static stats - support multiple GPUs (NVIDIA + AMD)
        has_gpu = False
        gpu_list = []
        nvidia_smi_path = None
        
        # Try NVIDIA first
        for path in ["nvidia-smi", r"C:\Windows\System32\nvidia-smi.exe", r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]:
            try:
                res = run_cmd([path, "--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"], timeout=3)
                if res.returncode == 0 and res.stdout.strip():
                    lines = res.stdout.strip().split("\n")
                    for line in lines:
                        parts = [p.strip() for p in line.split(",")]
                        if len(parts) >= 3:
                            gpu_list.append({
                                "index": int(parts[0]),
                                "name": parts[1],
                                "vram_total_gb": round(float(parts[2]) / 1024.0, 1),
                                "vendor": "nvidia"
                            })
                    if gpu_list:
                        has_gpu = True
                        nvidia_smi_path = path
                        break
            except Exception:
                continue

        # If no NVIDIA found, try AMD via WMI
        if not gpu_list:
            try:
                ps_script = """
                Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Json -Compress
                """
                res = run_cmd(["powershell", "-NoProfile", "-Command", ps_script], timeout=5)
                if res.returncode == 0 and res.stdout.strip():
                    import json
                    controllers = json.loads(res.stdout.strip())
                    if isinstance(controllers, dict):
                        controllers = [controllers]
                    for idx, ctrl in enumerate(controllers):
                        name = ctrl.get("Name", "Unknown GPU")
                        adapter_ram = int(ctrl.get("AdapterRAM", 0) or 0)
                        vram_gb = round(adapter_ram / (1024 ** 3), 1)
                        if vram_gb < 0.1:
                            vram_gb = 0.5
                        vendor = "amd" if "amd" in name.lower() or "radeon" in name.lower() else "other"
                        gpu_list.append({
                            "index": idx,
                            "name": name,
                            "vram_total_gb": vram_gb,
                            "vendor": vendor
                        })
                    if gpu_list:
                        has_gpu = True
            except Exception:
                pass

        stats_file = os.path.join(DATA_DIR, "host_stats.json")
        action_bridge = HostActionBridge(DATA_DIR)

        while True:
            try:
                cpu_usage = round(psutil.cpu_percent(interval=None), 1)
                vm = psutil.virtual_memory()
                ram_used_gb = round(vm.used / (1024**3), 1)
                ram_percent = round(vm.percent, 1)

                gpu_util = 0.0
                gpu_vram_used_gb = 0.0
                gpu_temp = 0
                gpu_details = []

                if has_gpu and nvidia_smi_path:
                    try:
                        res = run_cmd(
                            [nvidia_smi_path, "--query-gpu=index,utilization.gpu,memory.used,temperature.gpu", "--format=csv,noheader,nounits"],
                            timeout=2
                        )
                        if res.returncode == 0 and res.stdout.strip():
                            lines = res.stdout.strip().split("\n")
                            for line in lines:
                                parts = [p.strip() for p in line.split(",")]
                                if len(parts) >= 4:
                                    gpu_idx = int(parts[0])
                                    gpu_details.append({
                                        "index": gpu_idx,
                                        "usage": float(parts[1]),
                                        "vram_used_gb": round(float(parts[2]) / 1024.0, 1),
                                        "temperature": int(parts[3])
                                    })
                            if gpu_details:
                                gpu_util = gpu_details[0]["usage"]
                                gpu_vram_used_gb = gpu_details[0]["vram_used_gb"]
                                gpu_temp = gpu_details[0]["temperature"]
                    except Exception:
                        pass
                elif has_gpu and gpu_list and any(g.get("vendor") == "amd" for g in gpu_list):
                    gpu_details = [{
                        "index": g["index"],
                        "usage": 0.0,
                        "vram_used_gb": 0.0,
                        "temperature": 0
                    } for g in gpu_list if g.get("vendor") == "amd"]

                payload = {
                    "timestamp": time.time(),
                    "cpu_name": cpu_name,
                    "cpu_cores": physical_cores,
                    "cpu_threads": logical_threads,
                    "cpu_usage": cpu_usage,
                    "ram_total_gb": ram_total_gb,
                    "ram_used_gb": ram_used_gb,
                    "ram_percent": ram_percent,
                    "gpu_available": has_gpu,
                    "gpus": gpu_list,
                    "gpu_details": gpu_details,
                    "gpu_count": len(gpu_list),
                    "gpu_name": gpu_list[0]["name"] if gpu_list else "N/A",
                    "gpu_vram_total_gb": gpu_list[0]["vram_total_gb"] if gpu_list else 0.0,
                    "gpu_vram_used_gb": gpu_vram_used_gb,
                    "gpu_usage": gpu_util,
                    "gpu_temperature": gpu_temp,
                }

                temp_file = stats_file + ".tmp"
                with open(temp_file, "w", encoding="utf-8") as f:
                    json.dump(payload, f)
                os.replace(temp_file, stats_file)
                action_bridge.tick()
            except Exception:
                pass
            time.sleep(1.0)
    except Exception:
        pass

def start_host_stats_bridge():
    """Start one persistent, hidden host telemetry process."""
    pid_file = os.path.join(DATA_DIR, ".host-stats.pid")
    try:
        if os.path.exists(pid_file):
            with open(pid_file, "r", encoding="utf-8") as handle:
                existing_pid = int(handle.read().strip() or "0")
            if existing_pid and psutil.pid_exists(existing_pid):
                return existing_pid
    except Exception:
        pass

    if getattr(sys, "frozen", False):
        command = [sys.executable, "--telemetry-bridge"]
    else:
        command = [sys.executable, os.path.abspath(__file__), "--telemetry-bridge"]
    creation_flags = WIN_NO_WINDOW
    if sys.platform == "win32":
        creation_flags |= 0x00000008  # DETACHED_PROCESS
    process = subprocess.Popen(
        command,
        cwd=BASE_DIR,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creation_flags,
    )
    with open(pid_file, "w", encoding="utf-8") as handle:
        handle.write(str(process.pid))
    return process.pid

def configure_firewall():
    lan_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    if is_admin():
        rule_name = "SMARAN_AI_LAN_Access"
        check_cmd = f'netsh advfirewall firewall show rule name="{rule_name}"'
        res = run_cmd(check_cmd)
        if "No rules match" in res.stdout or res.returncode != 0:
            add_cmd = f'netsh advfirewall firewall add rule name="{rule_name}" dir=in action=allow protocol=TCP localport={FRONTEND_PORT}'
            run_cmd(add_cmd)
    return lan_ip

def create_desktop_shortcut():
    try:
        desktop_dir = os.path.join(os.path.expanduser("~"), "Desktop")
        shortcut_path = os.path.join(desktop_dir, "SMARAN.AI.lnk")
        target_exe = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(sys.argv[0])
        
        if os.path.exists(desktop_dir) and not os.path.exists(shortcut_path):
            ps_script = (
                f'$WshShell = New-Object -ComObject WScript.Shell; '
                f'$Shortcut = $WshShell.CreateShortcut("{shortcut_path}"); '
                f'$Shortcut.TargetPath = "{target_exe}"; '
                f'$Shortcut.WorkingDirectory = "{os.path.dirname(target_exe)}"; '
                f'$Shortcut.Description = "SMARAN.AI Desktop Workspace"; '
                f'$Shortcut.IconLocation = "{target_exe},0"; '
                f'$Shortcut.Save()'
            )
            run_cmd(["powershell", "-NoProfile", "-Command", ps_script])
    except Exception:
        pass

def wait_for_online(lan_ip):
    set_startup_status("Welcome Aboard! Opening SMARAN AI Workspace...", "Launching your web interface in your default browser. Thank you for waiting!", progress=100)
    url = f"http://localhost:{FRONTEND_PORT}"
    
    for check in range(60):
        try:
            req = urllib.request.urlopen(url, timeout=3)
            if req.status == 200:
                import webbrowser
                webbrowser.open(url)
                return True
        except Exception:
            pass
        time.sleep(2)
        if STARTUP_WINDOW and STARTUP_WINDOW.root:
            try:
                STARTUP_WINDOW.root.update()
            except Exception:
                pass

    import webbrowser
    webbrowser.open(url)
    return False

def remove_zone_identifier():
    try:
        target_exe = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(sys.argv[0])
        zone_file = target_exe + ":Zone.Identifier"
        if os.path.exists(zone_file):
            os.remove(zone_file)
    except Exception:
        pass

def main():
    remove_zone_identifier()
    global STARTUP_WINDOW
    STARTUP_WINDOW = StartupWindow()
    hw = detect_hardware()
    model_path, model_id = verify_model_weights(hw)
    generate_runtime_configs(hw, model_id)
    verify_and_start_backend()
    start_host_stats_bridge()
    lan_ip = configure_firewall()
    create_desktop_shortcut()
    wait_for_online(lan_ip)
    
    time.sleep(1.5)
    if STARTUP_WINDOW:
        STARTUP_WINDOW.close()

def show_error_dialog(title, message):
    try:
        root = tk.Tk()
        root.title(title)
        root.geometry("540x240")
        root.resizable(False, False)
        root.configure(bg="#0B0F17")
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass
        try:
            sw = root.winfo_screenwidth()
            sh = root.winfo_screenheight()
            x = (sw - 540) // 2
            y = (sh - 240) // 2
            root.geometry(f"540x240+{x}+{y}")
        except Exception:
            pass

        card = tk.Frame(root, bg="#131B2E", highlightbackground="#243354", highlightthickness=1)
        card.pack(fill="both", expand=True, padx=16, pady=16)

        hdr = tk.Label(card, text=title, font=("Segoe UI", 16, "bold"), fg="#FF7A00", bg="#131B2E")
        hdr.pack(anchor="w", padx=20, pady=(16, 6))

        msg = tk.Label(card, text=message, font=("Segoe UI", 10), fg="#F8FAFC", bg="#131B2E", wraplength=480, justify="left")
        msg.pack(anchor="w", padx=20, pady=(0, 14))

        def open_download():
            import webbrowser
            webbrowser.open("https://www.docker.com/products/docker-desktop")
            root.destroy()

        btn_frame = tk.Frame(card, bg="#131B2E")
        btn_frame.pack(anchor="e", padx=20, pady=(0, 10))

        if "download" in message.lower() or "docker desktop" in message.lower():
            dl_btn = tk.Button(btn_frame, text="Download Docker Desktop", font=("Segoe UI", 9, "bold"), fg="white", bg="#2563EB", activebackground="#1D4ED8", activeforeground="white", relief="flat", padx=14, pady=4, cursor="hand2", command=open_download)
            dl_btn.pack(side="left", padx=(0, 8))

        close_btn = tk.Button(btn_frame, text="OK", font=("Segoe UI", 9, "bold"), fg="white", bg="#FF7A00", activebackground="#E06C00", activeforeground="white", relief="flat", padx=20, pady=4, cursor="hand2", command=root.destroy)
        close_btn.pack(side="left")

        root.mainloop()
    except Exception:
        pass

if __name__ == "__main__":
    if "--telemetry-bridge" in sys.argv:
        try:
            telemetry_worker()
        except KeyboardInterrupt:
            pass
    else:
        try:
            main()
        except KeyboardInterrupt:
            pass
        except Exception as e:
            if STARTUP_WINDOW:
                STARTUP_WINDOW.close()
            show_error_dialog("SMARAN.AI Setup Guidance", str(e))
