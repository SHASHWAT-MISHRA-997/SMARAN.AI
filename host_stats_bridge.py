"""
GREYMATTER.AI — Host Stats Bridge
===================================
Runs on the HOST (Windows) as a background process.
Every 1 second reads REAL Windows Task Manager equivalent stats
and writes them to data/host_stats.json which the Docker container reads.

Metrics match exactly what Windows Task Manager shows:
  - CPU %      : overall CPU utilization (matches Task Manager > CPU)
  - RAM        : in-use GB / total GB (matches Task Manager > Memory)  
  - Disk %     : disk I/O ACTIVITY % (matches Task Manager > Disk 0) NOT space used
  - Disk Space : separate field showing used / total GB (for display)
  - GPU %      : NVIDIA GPU engine utilization via nvidia-smi
  - Network    : upload / download KB/s (matches Task Manager > Wi-Fi)
"""
import os
import sys
import json
import time
import subprocess
import psutil
import winreg

STATS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "host_stats.json")

# ── Static: read once ─────────────────────────────────────────────────────────
def get_cpu_info():
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                             r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
        winreg.CloseKey(key)
        return name.strip()
    except Exception:
        return "Unknown CPU"

# ── GPU stats via nvidia-smi ──────────────────────────────────────────────────
def get_gpu_stats():
    nvidia_paths = [
        "nvidia-smi",
        r"C:\Windows\System32\nvidia-smi.exe",
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    ]
    for nvsmi in nvidia_paths:
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
                    return {
                        "available": True,
                        "usage": round(float(parts[0].strip()), 1),
                        "name": parts[1].strip(),
                        "vram_used_gb": round(float(parts[2].strip()) / 1024.0, 2),
                        "vram_total_gb": round(float(parts[3].strip()) / 1024.0, 2),
                        "temperature": round(float(parts[4].strip()), 1) if len(parts) >= 5 else 0.0
                    }
        except Exception:
            continue
    return {"available": False, "usage": 0.0, "name": "N/A",
            "vram_used_gb": 0.0, "vram_total_gb": 0.0, "temperature": 0.0}

# ── Main loop ─────────────────────────────────────────────────────────────────
def main():
    os.makedirs(os.path.dirname(STATS_FILE), exist_ok=True)
    print(f"[Host Stats Bridge] Writing to: {STATS_FILE}")

    cpu_name  = get_cpu_info()
    cpu_cores = psutil.cpu_count(logical=False) or 8
    cpu_threads = psutil.cpu_count(logical=True) or 16

    # Pre-warm psutil CPU counter (first call always returns 0.0)
    psutil.cpu_percent(interval=None)

    # State for delta calculations
    _prev_net      = None
    _prev_net_time = time.time()
    _prev_disk_io  = None
    _prev_disk_time = time.time()

    while True:
        try:
            now_time = time.time()

            # ── CPU ───────────────────────────────────────────────────────────
            cpu_usage = round(psutil.cpu_percent(interval=None), 1)

            # ── RAM ───────────────────────────────────────────────────────────
            mem = psutil.virtual_memory()
            ram_used_gb  = round(mem.used  / (1024**3), 2)
            ram_total_gb = round(mem.total / (1024**3), 2)
            ram_percent  = round(mem.percent, 1)

            # ── DISK: Space (C:) ─────────────────────────────────────────────
            try:
                dspace = psutil.disk_usage("C:\\")
                disk_space_used_gb  = round(dspace.used  / (1024**3), 2)
                disk_space_total_gb = round(dspace.total / (1024**3), 2)
                disk_space_pct      = round(dspace.percent, 1)
            except Exception:
                disk_space_used_gb  = 0.0
                disk_space_total_gb = 0.0
                disk_space_pct      = 0.0

            # ── DISK: I/O Activity % (what Task Manager shows) ────────────────
            # busy_time is cumulative ms the disk was busy.
            # delta_busy_ms / (dt_seconds * 1000) * 100 = activity %
            disk_io_pct  = 0.0
            disk_read_kb = 0.0
            disk_write_kb = 0.0
            try:
                now_dio = psutil.disk_io_counters(perdisk=False)
                if now_dio and _prev_disk_io:
                    dt = now_time - _prev_disk_time
                    if dt > 0:
                        busy_delta = (now_dio.read_time + now_dio.write_time) - \
                                     (_prev_disk_io.read_time + _prev_disk_io.write_time)
                        disk_io_pct   = round(min(100.0, busy_delta / (dt * 10.0)), 1)
                        disk_read_kb  = round(((now_dio.read_bytes  - _prev_disk_io.read_bytes)  / 1024.0) / dt, 1)
                        disk_write_kb = round(((now_dio.write_bytes - _prev_disk_io.write_bytes) / 1024.0) / dt, 1)
                _prev_disk_io   = now_dio
                _prev_disk_time = now_time
            except Exception:
                pass

            # ── Network ───────────────────────────────────────────────────────
            net_up_kb   = 0.0
            net_down_kb = 0.0
            try:
                now_net = psutil.net_io_counters()
                if now_net and _prev_net:
                    dt = now_time - _prev_net_time
                    if dt > 0:
                        net_up_kb   = round(((now_net.bytes_sent - _prev_net.bytes_sent) / 1024.0) / dt, 1)
                        net_down_kb = round(((now_net.bytes_recv - _prev_net.bytes_recv) / 1024.0) / dt, 1)
                _prev_net      = now_net
                _prev_net_time = now_time
            except Exception:
                pass

            # ── GPU ───────────────────────────────────────────────────────────
            gpu = get_gpu_stats()

            # ── Write Stats ───────────────────────────────────────────────────
            stats = {
                "timestamp":        now_time,
                # CPU
                "cpu_usage":        cpu_usage,
                "cpu_name":         cpu_name,
                "cpu_cores":        cpu_cores,
                "cpu_threads":      cpu_threads,
                # RAM
                "ram_used_gb":      ram_used_gb,
                "ram_total_gb":     ram_total_gb,
                "ram_percent":      ram_percent,
                # GPU
                "gpu_available":    gpu["available"],
                "gpu_usage":        gpu["usage"],
                "gpu_name":         gpu["name"],
                "gpu_vram_used_gb": gpu["vram_used_gb"],
                "gpu_vram_total_gb":gpu["vram_total_gb"],
                "gpu_temperature":  gpu["temperature"],
                # Disk I/O activity (matches Task Manager "Disk %")
                "disk_io_pct":      disk_io_pct,
                "disk_read_kb":     max(0.0, disk_read_kb),
                "disk_write_kb":    max(0.0, disk_write_kb),
                # Disk Space (C:) — separate from activity
                "disk_space_used_gb":  disk_space_used_gb,
                "disk_space_total_gb": disk_space_total_gb,
                "disk_space_pct":      disk_space_pct,
                # Network
                "net_up_kb":   max(0.0, net_up_kb),
                "net_down_kb": max(0.0, net_down_kb)
            }

            # Atomic write: temp → rename
            tmp = STATS_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(stats, f)
            os.replace(tmp, STATS_FILE)

        except Exception as ex:
            print(f"[Host Stats Bridge] Error: {ex}")

        time.sleep(1)

if __name__ == "__main__":
    main()
