"""
GREYMATTER.AI — Production Launcher
====================================
Zero-friction .exe launcher for GREYMATTER.AI platform.
Auto-detects hardware, downloads the optimized GGUF model for the hardware tier,
generates a custom hardware-tuned docker-compose.yml,
and starts the full local AI platform with zero user setup.

Supports seamless GPU-to-CPU auto-scaling for RTX 2060, RTX 5060 Ti, and non-GPU systems.
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

# Force UTF-8 stdout/stderr encoding on Windows to prevent UnicodeEncodeError
if sys.stdout and sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr and sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ══════════════════════════════════════════════════════════════════════════════
APP_NAME = "SMARAN.AI"
VERSION  = "2.2.0"
BASE_DIR = os.path.dirname(os.path.abspath(sys.argv[0] if getattr(sys, 'frozen', False) else __file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(DATA_DIR, "models")
ENV_FILE = os.path.join(BASE_DIR, ".env")

FRONTEND_PORT = 3003

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
        "display_name": "Qwen 3 4B AWQ (Quantized · 6GB GPU Engine)",
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

def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def print_banner():
    clear_screen()
    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║                                                                ║")
    print("║      ███████╗███╗   ███╗██████╗  █████╗ ███╗   ██╗            ║")
    print("║      ██╔════╝████╗ ████║██╔══██╗██╔══██╗████╗  ██║            ║")
    print("║      ███████╗██╔████╔██║██████╔╝███████║██╔██╗ ██║            ║")
    print("║      ╚════██║██║╚██╔╝██║██╔══██╗██╔══██║██║╚██╗██║            ║")
    print("║      ███████║██║ ╚═╝ ██║██║  ██║██║  ██║██║ ╚████║            ║")
    print("║      ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝            ║")
    print("║              SMARAN.AI — SYSTEM ENGINE LAUNCHER               ║")
    print("║              v" + VERSION + "  |  100% Offline & Local              ║")
    print("║                                                                ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    print()

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: HARDWARE DETECTION & MODEL SELECTION
# ══════════════════════════════════════════════════════════════════════════════
def detect_hardware():
    print("═══ STEP 1: Host Hardware Profile Scan ═══════════════════════════")
    hw = {
        "cpu_name": "Unknown Processor",
        "cpu_cores": os.cpu_count() or 4,
        "ram_total_gb": 0,
        "gpu_available": False,
        "gpu_name": "N/A",
        "gpu_vram_gb": 0.0,
    }

    # ── CPU Name ───────────────────────────────────────────────────────────
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
        winreg.CloseKey(key)
        hw["cpu_name"] = cpu_name.strip()
    except Exception:
        try:
            res = subprocess.run(["wmic", "cpu", "get", "name"], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip() and l.strip() != "Name"]
            if lines: hw["cpu_name"] = lines[0]
        except Exception: pass

    # ── RAM Size ───────────────────────────────────────────────────────────
    try:
        import psutil
        hw["ram_total_gb"] = round(psutil.virtual_memory().total / (1024**3), 1)
    except ImportError:
        try:
            res = subprocess.run(["wmic", "computersystem", "get", "totalphysicalmemory"], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip().isdigit()]
            if lines: hw["ram_total_gb"] = round(int(lines[0]) / (1024**3), 1)
        except Exception: pass

    # ── GPU Name & VRAM ────────────────────────────────────────────────────
    nvidia_paths = ["nvidia-smi", r"C:\Windows\System32\nvidia-smi.exe", r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]
    for nvsmi in nvidia_paths:
        try:
            res = subprocess.run(
                [nvsmi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if res.returncode == 0 and res.stdout.strip():
                parts = res.stdout.strip().split("\n")[0].split(",")
                if len(parts) >= 2:
                    hw["gpu_available"] = True
                    hw["gpu_name"] = parts[0].strip()
                    hw["gpu_vram_gb"] = round(float(parts[1].strip()) / 1024.0, 1)
                    break
        except Exception:
            continue

    print(f"  [✓] CPU: {hw['cpu_name']} ({hw['cpu_cores']} cores)")
    print(f"  [✓] RAM: {hw['ram_total_gb']} GB")
    if hw["gpu_available"]:
        print(f"  [✓] GPU: {hw['gpu_name']} ({hw['gpu_vram_gb']} GB VRAM)")
    else:
        print("  [!] GPU: No Nvidia GPU detected. CPU Fallback active.")
    
    # Select hardware tier
    if hw["gpu_available"] and hw["gpu_vram_gb"] >= 15.0:
        hw["tier"] = "ultra"
        print("  [✓] Auto-Configured Tier: ULTRA (vLLM Qwen 7B Vision GPU)")
    elif hw["gpu_available"] and hw["gpu_vram_gb"] >= 6.0:
        hw["tier"] = "mid"
        print("  [✓] Auto-Configured Tier: MID (vLLM Qwen 7B Vision GPU)")
    else:
        hw["tier"] = "cpu"
        print("  [✓] Auto-Configured Tier: CPU Fallback (vLLM Qwen 3B CPU)")
        
    print()
    return hw

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: DOWNLOAD CHOSEN MODEL WEIGHTS (Delegated to vLLM auto-downloader)
# ══════════════════════════════════════════════════════════════════════════════
def verify_model_weights(hw):
    print("═══ STEP 2: Checking AI Model Weights ════════════════════════════")
    tier_info = TIERS[hw["tier"]]
    model_id = tier_info["model_id"]
    print(f"  [✓] Configured Model: {tier_info['display_name']}")
    print(f"  [✓] vLLM will automatically download/cache model weights on startup: {model_id}")
    print()
    return "", model_id

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: GENERATE CONFIG AND DYNAMIC COMPOSE FILE
# ══════════════════════════════════════════════════════════════════════════════
def generate_runtime_configs(hw, model_id):
    print("═══ STEP 3: Auto-Configuring Containers ══════════════════════════")
    gpu = hw["gpu_available"]
    tier_info = TIERS[hw["tier"]]
    
    os.makedirs(DATA_DIR, exist_ok=True)
    hw_config_path = os.path.join(DATA_DIR, "hardware_config.json")
    
    model_config = {
        "engine": "vllm",
        "model_id": model_id,
        "display_name": tier_info["display_name"],
        "ctx_window": tier_info["ctx_window"],
        "reasoning_model": False,
        "gpu_available": gpu,
        "host_gpu_vram_gb": hw["gpu_vram_gb"],
        "host_gpu_name": hw["gpu_name"],
        "host_cpu_name": hw["cpu_name"],
        "host_cpu_cores": hw["cpu_cores"],
        "host_ram_total_gb": hw["ram_total_gb"]
    }
    
    with open(hw_config_path, "w") as f:
        json.dump(model_config, f, indent=2)
    print("  [✓] Saved hardware_config.json")

    # Generate custom docker-compose.yml based on GPU availability
    if gpu:
        vllm_command = f"--model {model_id} --port 8000 --host 0.0.0.0 --max-model-len 2048 --gpu-memory-utilization 0.75 --dtype float16 --trust-remote-code"
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

    compose_content = f"""# SMARAN.AI - Auto-generated Compose Profile
version: '3.8'

services:
  # vLLM OpenAI-Compatible Inference Server
  inference-server:
    image: vllm/vllm-openai:v0.8.5.post1
    container_name: smaran-inference
    ports:
      - "8001:8000"
    volumes:
      - ./data/models:/root/.cache/huggingface
    environment:
      - VLLM_USE_V1=0
    command: {vllm_command}
    restart: unless-stopped
{deploy_section}

  # Monolithic App Container (FastAPI Backend + Vite Frontend)
  app:
    build: .
    image: shashwatmishra062/smaran-ai:latest
    container_name: smaran-app
    ports:
      - "{FRONTEND_PORT}:3003"
    environment:
      - JWT_SECRET=gmr-robotics-local-security-secret-key-98765
      - ACTIVE_MODEL={model_id}
      - INFERENCE_ENGINE=vllm
      - VLLM_URL=http://smaran-inference:8000/v1
      - DATA_DIR=/app/data
    volumes:
      - ./data:/app/data
    restart: unless-stopped
"""
    with open("docker-compose.yml", "w") as f:
        f.write(compose_content)
    print("  [✓] Generated hardware-tuned docker-compose.yml")
    print()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: CHECK DOCKER DESKTOP STATUS
# ══════════════════════════════════════════════════════════════════════════════
def verify_docker():
    print("═══ STEP 4: Verifying Docker Desktop Status ══════════════════════")
    if not shutil.which("docker"):
        print("  [✗] Docker Desktop is not installed on this system.")
        print("      Please install Docker Desktop and try again: https://www.docker.com/products/docker-desktop")
        input("\nPress Enter to exit...")
        sys.exit(1)

    try:
        res = subprocess.run(["docker", "info"], capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            print("  [✗] Docker is installed but not running.")
            print("      → Please open Docker Desktop and wait for it to start.")
            input("\nPress Enter to exit...")
            sys.exit(1)
    except Exception:
        print("  [✗] Unable to establish Docker socket connection.")
        input("\nPress Enter to exit...")
        sys.exit(1)

    print("  [✓] Docker daemon is online and healthy.")
    print()

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: RUN PLATFORM CONTAINERS
# ══════════════════════════════════════════════════════════════════════════════
def run_containers():
    print("═══ STEP 5: Launching Local Container Stack ═════════════════════")
    print("  [*] Building and starting services. First boot might take a few minutes...")
    print()
    
    subprocess.run(["docker", "compose", "down", "--remove-orphans"], capture_output=True, cwd=BASE_DIR)
    
    cmd = ["docker", "compose", "up", "--build", "-d"]
    result = subprocess.run(cmd, cwd=BASE_DIR)
    
    if result.returncode != 0:
        print("  [✗] Docker compose startup failed. Attempting legacy docker-compose...")
        result = subprocess.run(["docker-compose", "up", "--build", "-d"], cwd=BASE_DIR)
        if result.returncode != 0:
            print("  [✗] Critical: Container startup failed.")
            input("Press Enter to exit...")
            sys.exit(1)

    print()
    print("  [✓] Container stack is running.")
    print()

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5b: START HOST STATS BRIDGE (real-time telemetry)
# ══════════════════════════════════════════════════════════════════════════════
def telemetry_worker():
    """Background loop that writes real Windows Task Manager stats to data/host_stats.json every second."""
    # Static: CPU name, physical cores, logical threads
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
        winreg.CloseKey(key)
        cpu_name = cpu_name.strip()
    except Exception:
        cpu_name = "Unknown CPU"

    cpu_cores   = psutil.cpu_count(logical=False) or 8   # Physical cores (matches Task Manager "Cores")
    cpu_threads = psutil.cpu_count(logical=True)  or 16  # Logical processors (matches Task Manager "Logical processors")
    stats_file  = os.path.join(DATA_DIR, "host_stats.json")
    
    # Pre-warm psutil CPU counter (first call always returns 0.0)
    psutil.cpu_percent(interval=None)

    # State for delta calculations
    prev_net       = None
    prev_net_time  = time.time()
    prev_disk_io   = None
    prev_disk_time = time.time()

    while True:
        try:
            now_time = time.time()

            # 1. CPU Usage
            cpu_usage = round(psutil.cpu_percent(interval=None), 1)

            # 2. RAM stats
            mem = psutil.virtual_memory()
            ram_used_gb  = round(mem.used  / (1024**3), 2)
            ram_total_gb = round(mem.total / (1024**3), 2)
            ram_percent  = round(mem.percent, 1)

            # 3. GPU stats via nvidia-smi
            gpu_available = False
            gpu_usage = 0.0
            gpu_name = "N/A"
            gpu_vram_used = 0.0
            gpu_vram_total = 0.0
            gpu_temp = 0.0
            for nvsmi in ["nvidia-smi",
                          r"C:\Windows\System32\nvidia-smi.exe",
                          r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]:
                try:
                    res = subprocess.run(
                        [nvsmi,
                         "--query-gpu=utilization.gpu,name,memory.used,memory.total,temperature.gpu",
                         "--format=csv,noheader,nounits"],
                        capture_output=True, text=True, timeout=2
                    )
                    if res.returncode == 0 and res.stdout.strip():
                        parts = res.stdout.strip().split("\n")[0].split(",")
                        if len(parts) >= 4:
                            gpu_usage      = float(parts[0].strip())
                            gpu_name       = parts[1].strip()
                            gpu_vram_used  = round(float(parts[2].strip()) / 1024.0, 2)
                            gpu_vram_total = round(float(parts[3].strip()) / 1024.0, 2)
                            if len(parts) >= 5:
                                gpu_temp = float(parts[4].strip())
                            gpu_available = True
                            break
                except Exception:
                    continue

            # 4. Disk Space (C:)
            disk_space_used_gb  = 0.0
            disk_space_total_gb = 0.0
            disk_space_pct      = 0.0
            try:
                dspace = psutil.disk_usage('C:\\')
                disk_space_used_gb  = round(dspace.used  / (1024**3), 2)
                disk_space_total_gb = round(dspace.total / (1024**3), 2)
                disk_space_pct      = round(dspace.percent, 1)
            except Exception:
                pass

            # 4b. Disk I/O Activity % (matches Task Manager "Disk %")
            disk_io_pct  = 0.0
            disk_read_kb = 0.0
            disk_write_kb = 0.0
            try:
                now_dio = psutil.disk_io_counters(perdisk=False)
                if now_dio and prev_disk_io:
                    dt = now_time - prev_disk_time
                    if dt > 0:
                        busy_delta    = (now_dio.read_time + now_dio.write_time) - \
                                        (prev_disk_io.read_time + prev_disk_io.write_time)
                        disk_io_pct   = round(min(100.0, busy_delta / (dt * 10.0)), 1)
                        disk_read_kb  = round(((now_dio.read_bytes  - prev_disk_io.read_bytes)  / 1024.0) / dt, 1)
                        disk_write_kb = round(((now_dio.write_bytes - prev_disk_io.write_bytes) / 1024.0) / dt, 1)
                prev_disk_io   = now_dio
                prev_disk_time = now_time
            except Exception:
                pass

            # 5. Network Stats
            net_up   = 0.0
            net_down = 0.0
            try:
                now_net = psutil.net_io_counters()
                dt = now_time - prev_net_time
                if dt > 0 and prev_net:
                    net_up   = round(((now_net.bytes_sent - prev_net.bytes_sent) / 1024.0) / dt, 1)
                    net_down = round(((now_net.bytes_recv - prev_net.bytes_recv) / 1024.0) / dt, 1)
                prev_net      = now_net
                prev_net_time = now_time
            except Exception:
                pass

            stats = {
                "timestamp":           now_time,
                # CPU — physical cores matches Task Manager
                "cpu_usage":           cpu_usage,
                "cpu_name":            cpu_name,
                "cpu_cores":           cpu_cores,    # Physical cores (e.g. 8)
                "cpu_threads":         cpu_threads,  # Logical processors (e.g. 16)
                # RAM
                "ram_used_gb":         ram_used_gb,
                "ram_total_gb":        ram_total_gb,
                "ram_percent":         ram_percent,
                # GPU
                "gpu_available":       gpu_available,
                "gpu_usage":           gpu_usage,
                "gpu_name":            gpu_name,
                "gpu_vram_used_gb":    gpu_vram_used,
                "gpu_vram_total_gb":   gpu_vram_total,
                "gpu_temperature":     gpu_temp,
                # Disk I/O activity (matches Task Manager Disk %)
                "disk_io_pct":         disk_io_pct,
                "disk_read_kb":        max(0.0, disk_read_kb),
                "disk_write_kb":       max(0.0, disk_write_kb),
                # Disk Space (C:)
                "disk_space_used_gb":  disk_space_used_gb,
                "disk_space_total_gb": disk_space_total_gb,
                "disk_space_pct":      disk_space_pct,
                # Network
                "net_up_kb":           max(0.0, net_up),
                "net_down_kb":         max(0.0, net_down)
            }

            # Write atomically
            tmp_file = stats_file + ".tmp"
            with open(tmp_file, "w") as f:
                json.dump(stats, f)
            os.replace(tmp_file, stats_file)

        except Exception:
            pass

        time.sleep(1)

def start_host_stats_bridge():
    """Start the host stats bridge thread directly inside the launcher."""
    print("═══ STEP 5b: Starting Host Stats Bridge ══════════════════════════")
    try:
        t = threading.Thread(target=telemetry_worker, daemon=True)
        t.start()
        print("  [✓] Background host telemetry thread started.")
    except Exception as e:
        print(f"  [!] Could not start telemetry thread: {e}")
    print()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6: LAN FIREWALL RULE CONFIG
# ══════════════════════════════════════════════════════════════════════════════
def configure_firewall():
    print("═══ STEP 6: LAN Firewall Configuration ══════════════════════════")
    lan_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.254.254.254", 1))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    if is_admin():
        try:
            subprocess.run(["netsh", "advfirewall", "firewall", "delete", "rule", "name=GREYMATTER.AI Platform"], capture_output=True)
            subprocess.run([
                "netsh", "advfirewall", "firewall", "add", "rule",
                "name=GREYMATTER.AI Platform", "dir=in", "action=allow",
                "protocol=TCP", f"localport={FRONTEND_PORT}", "profile=private,domain"
            ], capture_output=True)
            print(f"  [✓] Inbound traffic firewall rule set for port {FRONTEND_PORT}")
        except Exception:
            print("  [!] Failed to set firewall rule.")
    else:
        print("  [!] Running without Administrator rights. Inbound network rule skipped.")
        print("      To let other devices on your LAN access this node, run launcher as Admin.")
        
    print(f"  [✓] Current Host LAN IP: {lan_ip}")
    print()
    return lan_ip

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7: HEALTH CHECK & AUTO BROWSER LAUNCH
# ══════════════════════════════════════════════════════════════════════════════
def wait_for_online(lan_ip):
    print("═══ STEP 7: Verifying System Health & Launching Browser ═════════")
    
    url = f"http://localhost:{FRONTEND_PORT}"
    max_checks = 30
    for check in range(max_checks):
        try:
            req = urllib.request.urlopen(url, timeout=3)
            if req.status == 200:
                print("  [✓] GREYMATTER.AI Platform is fully ONLINE!")
                print()
                
                import webbrowser
                webbrowser.open(url)
                return True
        except Exception:
            pass
        time.sleep(2)
        dots = "." * ((check % 3) + 1)
        print(f"  [*] Waiting for web interface to load{dots}      ", end="\r")

    print("\n  [!] Platform starting slowly. Check Docker Desktop logs for greymatter-app.")
    return False

# ══════════════════════════════════════════════════════════════════════════════
# MAIN ROUTINE
# ══════════════════════════════════════════════════════════════════════════════
def main():
    print_banner()
    hw = detect_hardware()
    model_path, model_id = verify_model_weights(hw)
    generate_runtime_configs(hw, model_id)
    verify_docker()
    run_containers()
    start_host_stats_bridge()
    lan_ip = configure_firewall()
    wait_for_online(lan_ip)

    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║                                                                ║")
    print("║             GREYMATTER.AI IS RUNNING OFFLINE                   ║")
    print("║                                                                ║")
    print("╠══════════════════════════════════════════════════════════════════╣")
    print(f"║  🌐 Local Console:   http://localhost:{FRONTEND_PORT}                   ║")
    print(f"║  🏢 LAN Access IP:   http://{lan_ip}:{FRONTEND_PORT}              ║")
    print("║                                                                ║")
    print("║  Hardware profile used:                                       ║")
    print(f"║    CPU:  {hw['cpu_name'][:48]:48s}    ║")
    if hw["gpu_available"]:
        print(f"║    GPU:  {hw['gpu_name'][:48]:48s}    ║")
        print(f"║    VRAM: {hw['gpu_vram_gb']} GB                                          ║")
    else:
        print("║    GPU:  No GPU (CPU fallback mode active)                   ║")
    print(f"║    RAM:  {hw['ram_total_gb']} GB                                            ║")
    print("║                                                                ║")
    print("║  ─────────────────────────────────────────────────────         ║")
    print("║  To share this node with other devices on your LAN:           ║")
    print(f"║  Give them this link: http://{lan_ip}:{FRONTEND_PORT}                 ║")
    print("║                                                                ║")
    print("║  (Press Enter to close this window, platform stays active)     ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    input()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Exit requested by user.")
    except Exception as e:
        print(f"\n[✗] Fatal error encountered: {e}")
        import traceback
        traceback.print_exc()
        input("\nPress Enter to exit...")
