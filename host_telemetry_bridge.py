"""Small host-side telemetry writer for a Docker-mounted JSON file.

Uses psutil for CPU/RAM/disk/network and vendor tools only when they exist.
Unknown GPU readings stay unavailable; no values are estimated.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import time
from pathlib import Path

import psutil


def command(args: list[str], timeout: int = 4) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def cpu_name() -> str:
    if platform.system() == "Windows":
        value = command(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)"])
        if value:
            return value
    if platform.system() == "Darwin":
        value = command(["sysctl", "-n", "machdep.cpu.brand_string"])
        if value:
            return value
    try:
        for line in Path("/proc/cpuinfo").read_text(errors="ignore").splitlines():
            if line.lower().startswith("model name"):
                return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return platform.processor() or "Unavailable"


def operating_system_info() -> dict:
    """Return OS labels reported by the host itself; never infer from browser UA."""
    system = platform.system()
    info = {
        "host_os": system,
        "host_os_display": system,
        "host_os_version": platform.version(),
        "host_os_build": "",
        "host_arch": platform.machine(),
        "host_device_manufacturer": "",
        "host_device_model": "",
    }
    if system == "Windows":
        raw = command([
            "powershell", "-NoProfile", "-Command",
            "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress",
        ])
        try:
            value = json.loads(raw) if raw else {}
            info["host_os_display"] = str(value.get("Caption") or system).strip()
            info["host_os_version"] = str(value.get("Version") or info["host_os_version"]).strip()
            info["host_os_build"] = str(value.get("BuildNumber") or "").strip()
        except Exception:
            pass
        raw_device = command([
            "powershell", "-NoProfile", "-Command",
            "Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress",
        ])
        try:
            device = json.loads(raw_device) if raw_device else {}
            info["host_device_manufacturer"] = str(device.get("Manufacturer") or "").strip()
            info["host_device_model"] = str(device.get("Model") or "").strip()
        except Exception:
            pass
    elif system == "Darwin":
        product = command(["sw_vers", "-productName"])
        version = command(["sw_vers", "-productVersion"])
        build = command(["sw_vers", "-buildVersion"])
        info["host_os_display"] = product or "macOS"
        info["host_os_version"] = version or info["host_os_version"]
        info["host_os_build"] = build
        info["host_device_manufacturer"] = "Apple"
        info["host_device_model"] = command(["sysctl", "-n", "hw.model"])
    elif system == "Linux":
        try:
            release = platform.freedesktop_os_release()
            info["host_os_display"] = release.get("PRETTY_NAME") or release.get("NAME") or system
            info["host_os_version"] = release.get("VERSION_ID") or info["host_os_version"]
        except Exception:
            pass
        try:
            info["host_device_manufacturer"] = Path("/sys/devices/virtual/dmi/id/sys_vendor").read_text(errors="ignore").strip()
            info["host_device_model"] = Path("/sys/devices/virtual/dmi/id/product_name").read_text(errors="ignore").strip()
        except Exception:
            pass
    return info


def gpu_inventory() -> list[dict]:
    items: list[dict] = []
    output = command(["nvidia-smi", "--query-gpu=index,name,memory.total,memory.used,temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits"])
    for line in output.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 6:
            continue
        try:
            items.append({"index": int(parts[0]), "name": parts[1], "vram_total_gb": round(float(parts[2]) / 1024, 2), "vram_used_gb": round(float(parts[3]) / 1024, 2), "temperature": float(parts[4]), "usage": float(parts[5]), "vendor": "nvidia", "has_live_metrics": True})
        except ValueError:
            continue
    if platform.system() == "Windows":
        raw = command(["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"])
        try:
            controllers = json.loads(raw) if raw else []
            if isinstance(controllers, dict):
                controllers = [controllers]
            known = {str(item["name"]).lower() for item in items}
            for controller in controllers:
                name = str(controller.get("Name") or "").strip()
                if not name or name.lower() in known or "microsoft basic" in name.lower():
                    continue
                ram = int(controller.get("AdapterRAM") or 0)
                items.append({"index": len(items), "name": name, "vram_total_gb": round(ram / 1024**3, 2) if ram > 0 else None, "vram_used_gb": None, "temperature": None, "usage": None, "vendor": "amd" if "amd" in name.lower() or "radeon" in name.lower() else "intel" if "intel" in name.lower() else "other", "has_live_metrics": False})
        except Exception:
            pass
    return items


def npu_inventory() -> dict:
    """Detect AI accelerators / NPUs available on the host.

    On Windows:
    1. Windows ML API via PowerShell (WinML / DirectML-compatible devices)
    2. Check for Intel NPU (GNA) — registry or driver presence
    3. Check for Qualcomm AI Engine (Snapdragon X Elite NPU)

    On Linux:
    1. Check for Intel NPU driver (intel_vpu / intel_npu module)
    2. Check for /dev/accel/dri render nodes for AI accelerators
    3. Check for Qualcomm AI Engine
    """
    result = {
        "npu_available": False,
        "npu_name": "",
        "npu_vendor": "",
    }
    system = platform.system()

    # Check for intel_npu / intel_vpu kernel module (Linux)
    try:
        if Path("/sys/class/intel-npu").exists() or Path("/dev/intel-npu").exists():
            result["npu_available"] = True
            result["npu_name"] = "Intel NPU (GNA/AI Accelerator)"
            result["npu_vendor"] = "Intel"
            return result
    except Exception:
        pass

    # Check /proc/modules for NPU-related modules (Linux)
    try:
        modules = Path("/proc/modules").read_text(errors="ignore")
        for mod in ["intel_npu", "intel_vpu", "npu_dev", "ai_accel"]:
            if mod in modules:
                result["npu_available"] = True
                result["npu_name"] = f"NPU module: {mod}"
                result["npu_vendor"] = "Intel"
                return result
    except Exception:
        pass

    # Windows: check for AI accelerator via PowerShell
    if system == "Windows":
        # Method 1: WMI — check for AI accelerators in device manager
        raw = command([
            "powershell", "-NoProfile", "-Command",
            "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'NPU|AI.*Accelerator|Neural.*Process|GNA|AI.*Engine|DirectML' } | Select-Object Name,Manufacturer | ConvertTo-Json -Compress"
        ])
        try:
            devices = json.loads(raw) if raw else []
            if isinstance(devices, dict):
                devices = [devices]
            if devices:
                for dev in devices:
                    name = str(dev.get("Name") or "").strip()
                    if name:
                        result["npu_available"] = True
                        result["npu_name"] = name
                        result["npu_vendor"] = str(dev.get("Manufacturer") or "").strip()
                        return result
        except Exception:
            pass

        # Method 2: Registry — look for Intel NPU driver
        raw2 = command([
            "powershell", "-NoProfile", "-Command",
            "Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -match 'NPU|Neural.*Process|GNA|AI.*Accelerator|AI.*Engine' } | Select-Object DeviceName,ManufacturerName | ConvertTo-Json -Compress"
        ])
        try:
            drivers = json.loads(raw2) if raw2 else []
            if isinstance(drivers, dict):
                drivers = [drivers]
            if drivers:
                for drv in drivers:
                    name = str(drv.get("DeviceName") or "").strip()
                    if name:
                        result["npu_available"] = True
                        result["npu_name"] = name
                        result["npu_vendor"] = str(drv.get("ManufacturerName") or "").strip()
                        return result
        except Exception:
            pass

    # macOS: check for Apple Neural Engine
    if system == "Darwin":
        # Apple Silicon has a built-in Neural Engine (ANE)
        raw = command(["sysctl", "-n", "machdep.cpu.brand_string"])
        if raw:
            cpu = raw.lower()
            if "apple" in cpu or "m1" in cpu or "m2" in cpu or "m3" in cpu or "m4" in cpu:
                result["npu_available"] = True
                result["npu_name"] = "Apple Neural Engine (ANE)"
                result["npu_vendor"] = "Apple"
                return result

    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    previous_net = psutil.net_io_counters()
    previous_disk = psutil.disk_io_counters()
    previous_time = time.monotonic()
    static_gpus = gpu_inventory()
    os_info = operating_system_info()
    npu_info = npu_inventory()
    while True:
        current_time = time.monotonic()
        elapsed = max(0.1, current_time - previous_time)
        memory = psutil.virtual_memory()
        disk_space = psutil.disk_usage(str(Path.home().anchor or "/"))
        current_net = psutil.net_io_counters()
        current_disk = psutil.disk_io_counters()
        live_gpus = gpu_inventory()
        if live_gpus:
            static_gpus = live_gpus
        payload = {
            "telemetry_source": f"{platform.system().lower()}_host_bridge",
            **os_info,
            "npu_available": npu_info.get("npu_available", False),
            "npu_name": npu_info.get("npu_name", ""),
            "npu_vendor": npu_info.get("npu_vendor", ""),
            "timestamp": time.time(), "cpu_name": cpu_name(),
            "cpu_cores": psutil.cpu_count(logical=False), "cpu_threads": psutil.cpu_count(logical=True),
            "cpu_usage": psutil.cpu_percent(interval=None), "ram_total_gb": round(memory.total / 1024**3, 2),
            "ram_used_gb": round(memory.used / 1024**3, 2), "ram_percent": memory.percent,
            "gpus": static_gpus, "gpu_count": len(static_gpus), "gpu_available": bool(static_gpus),
            "disk_space_pct": disk_space.percent, "disk_space_used_gb": round(disk_space.used / 1024**3, 2),
            "disk_space_total_gb": round(disk_space.total / 1024**3, 2),
            "net_up_kb": round((current_net.bytes_sent - previous_net.bytes_sent) / 1024 / elapsed, 1),
            "net_down_kb": round((current_net.bytes_recv - previous_net.bytes_recv) / 1024 / elapsed, 1),
            "disk_read_kb": round((current_disk.read_bytes - previous_disk.read_bytes) / 1024 / elapsed, 1) if current_disk and previous_disk else 0,
            "disk_write_kb": round((current_disk.write_bytes - previous_disk.write_bytes) / 1024 / elapsed, 1) if current_disk and previous_disk else 0,
        }
        primary = next((gpu for gpu in static_gpus if gpu.get("has_live_metrics")), static_gpus[0] if static_gpus else {})
        payload.update({"gpu_name": primary.get("name"), "gpu_usage": primary.get("usage"), "gpu_vram_total_gb": primary.get("vram_total_gb"), "gpu_vram_used_gb": primary.get("vram_used_gb"), "gpu_temperature": primary.get("temperature")})
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(temporary, output)
        previous_net, previous_disk, previous_time = current_net, current_disk, current_time
        time.sleep(1)


if __name__ == "__main__":
    main()
