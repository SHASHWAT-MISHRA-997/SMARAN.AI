"""Detect real hardware specs using WMI (Windows) or /proc (Linux)."""
import subprocess, json, platform, os, sys

def detect_hardware():
    info = {
        "cpu_name": "Unknown CPU",
        "cpu_cores": 0,
        "cpu_threads": 0,
        "gpu_name": "N/A",
        "gpu_vram_gb": 0,
        "ram_total_gb": 0,
        "system_manufacturer": "",
        "system_model": "",
        "os_name": "",
        "os_version": "",
        "os_arch": "",
        "disks": []
    }
    
    is_windows = platform.system() == "Windows"
    
    if is_windows:
        # CPU via WMI
        try:
            r = subprocess.run(
                ["powershell", "-Command",
                 "Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors | ConvertTo-Json"],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0 and r.stdout.strip():
                cpu = json.loads(r.stdout.strip())
                if isinstance(cpu, list):
                    cpu = cpu[0]
                info["cpu_name"] = cpu.get("Name", "").strip()
                info["cpu_cores"] = cpu.get("NumberOfCores", 0)
                info["cpu_threads"] = cpu.get("NumberOfLogicalProcessors", 0)
        except Exception as e:
            print(f"CPU WMI error: {e}")

        # GPU via WMI
        try:
            r = subprocess.run(
                ["powershell", "-Command",
                 "Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Json"],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0 and r.stdout.strip():
                gpus = json.loads(r.stdout.strip())
                if isinstance(gpus, dict):
                    gpus = [gpus]
                for gpu in gpus:
                    name = gpu.get("Name", "")
                    adapter_ram = gpu.get("AdapterRAM", 0) or 0
                    if adapter_ram > 0:
                        vram_gb = round(adapter_ram / (1024**3), 2)
                    else:
                        vram_gb = 0
                    print(f"  GPU: {name}, VRAM: {vram_gb} GB, Driver: {gpu.get('DriverVersion', 'N/A')}")
                    # Use first real GPU (skip Microsoft Basic Display)
                    if name and "Microsoft" not in name:
                        info["gpu_name"] = name
                        info["gpu_vram_gb"] = vram_gb
                    elif not info["gpu_name"] or info["gpu_name"] == "N/A":
                        info["gpu_name"] = name
                        info["gpu_vram_gb"] = vram_gb
        except Exception as e:
            print(f"GPU WMI error: {e}")

        # System + RAM via WMI
        try:
            r = subprocess.run(
                ["powershell", "-Command",
                 "Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object TotalPhysicalMemory, Manufacturer, Model | ConvertTo-Json"],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0 and r.stdout.strip():
                sys_info = json.loads(r.stdout.strip())
                ram_bytes = int(sys_info.get("TotalPhysicalMemory", 0) or 0)
                info["ram_total_gb"] = round(ram_bytes / (1024**3), 2)
                info["system_manufacturer"] = sys_info.get("Manufacturer", "").strip()
                info["system_model"] = sys_info.get("Model", "").strip()
        except Exception as e:
            print(f"System WMI error: {e}")

        # OS via WMI
        try:
            r = subprocess.run(
                ["powershell", "-Command",
                 "Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture | ConvertTo-Json"],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0 and r.stdout.strip():
                os_info = json.loads(r.stdout.strip())
                info["os_name"] = os_info.get("Caption", "").strip()
                info["os_version"] = os_info.get("Version", "").strip()
                info["os_arch"] = os_info.get("OSArchitecture", "").strip()
        except Exception as e:
            print(f"OS WMI error: {e}")

        # Disks
        try:
            r = subprocess.run(
                ["powershell", "-Command",
                 'Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json'],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0 and r.stdout.strip():
                disks = json.loads(r.stdout.strip())
                if isinstance(disks, dict):
                    disks = [disks]
                for d in disks:
                    total = round(int(d.get("Size", 0) or 0) / (1024**3), 2)
                    free = round(int(d.get("FreeSpace", 0) or 0) / (1024**3), 2)
                    info["disks"].append({
                        "drive": d.get("DeviceID", "?"),
                        "total_gb": total,
                        "free_gb": free,
                        "used_gb": round(total - free, 2)
                    })
        except Exception as e:
            print(f"Disk WMI error: {e}")

    else:
        # Linux: /proc/cpuinfo
        try:
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        info["cpu_name"] = line.split(":")[1].strip()
                        break
            info["cpu_cores"] = os.cpu_count() or 0
            info["cpu_threads"] = os.cpu_count() or 0
        except Exception:
            info["cpu_name"] = platform.processor() or "Unknown CPU"
            info["cpu_cores"] = os.cpu_count() or 0

        # Linux: /proc/meminfo
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if "MemTotal" in line:
                        kb = int(line.split()[1])
                        info["ram_total_gb"] = round(kb / (1024**2), 2)
                        break
        except Exception:
            pass

        # Linux: nvidia-smi
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0 and r.stdout.strip():
                parts = r.stdout.strip().split(",")
                info["gpu_name"] = parts[0].strip()
                info["gpu_vram_gb"] = round(float(parts[1].strip()) / 1024, 2)
        except Exception:
            pass

        # Linux: OS info
        info["os_name"] = platform.platform()
        info["os_arch"] = platform.machine()
    
    # Fallback: platform.processor() is better than "Unknown"
    if info["cpu_name"] == "Unknown CPU" or not info["cpu_name"]:
        proc = platform.processor()
        if proc:
            info["cpu_name"] = proc
    
    return info

if __name__ == "__main__":
    hw = detect_hardware()
    print(json.dumps(hw, indent=2))
