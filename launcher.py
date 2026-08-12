"""
SMARAN.AI Production Launcher
====================================
Zero-friction .exe launcher for SMARAN.AI platform.
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
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

# Force UTF-8 stdout/stderr encoding on Windows to prevent UnicodeEncodeError
if sys.stdout and sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr and sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# CONSTANTS
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
APP_NAME = "SMARAN.AI"
VERSION  = "1.0.0"
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
        "display_name": "Qwen 3 4B AWQ (Quantized Ã‚Â· 6GB GPU Engine)",
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

class StartupWindow:
    def __init__(self):
        self.root = None
        try:
            self.root = tk.Tk()
            self.root.title(APP_NAME)
            self.root.geometry("520x180")
            self.root.resizable(False, False)
            self.root.configure(bg="#121212")
            tk.Label(self.root, text="SMARAN.AI", font=("Segoe UI", 22, "bold"), fg="#ff7a00", bg="#121212").pack(pady=(28, 8))
            self.status = tk.StringVar(value="Preparing local AI workspace...")
            tk.Label(self.root, textvariable=self.status, wraplength=450, justify="center", font=("Segoe UI", 10), fg="white", bg="#121212").pack(padx=24, pady=8)
            self.root.protocol("WM_DELETE_WINDOW", lambda: None)
            self.root.update()
        except Exception:
            self.root = None

    def set_status(self, value):
        if self.root:
            self.status.set(value)
            self.root.update_idletasks()
            self.root.update()

    def close(self):
        if self.root:
            self.root.destroy()
            self.root = None


STARTUP_WINDOW = None


def set_startup_status(value):
    if STARTUP_WINDOW:
        STARTUP_WINDOW.set_status(value)

def print_banner():
    clear_screen()
    print("Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜      Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”   Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”  Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€” Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”   Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜      Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€” Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”  Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜      Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€” Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜      Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€¢Å¡Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€¢Å¡Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€”Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜      Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜ Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢Â Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜  Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜  Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜ Ã¢â€¢Å¡Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€“Ë†Ã¢â€¢â€˜            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜      Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢Â     Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢Â  Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢Â  Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢Â  Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜              SMARAN.AI Ã¢â‚¬â€ SYSTEM ENGINE LAUNCHER               Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜              v" + VERSION + "  |  100% Offline & Local              Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
    print()

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False

# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# STEP 1: HARDWARE DETECTION & MODEL SELECTION
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def detect_hardware():
    print("Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â STEP 1: Host Hardware Profile Scan Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
    hw = {
        "cpu_name": "Unknown Processor",
        "cpu_cores": os.cpu_count() or 4,
        "ram_total_gb": 0,
        "gpu_available": False,
        "gpu_name": "N/A",
        "gpu_vram_gb": 0.0,
    }

    # Ã¢â€â‚¬Ã¢â€â‚¬ CPU Name Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    # Ã¢â€â‚¬Ã¢â€â‚¬ RAM Size Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    try:
        import psutil
        hw["ram_total_gb"] = round(psutil.virtual_memory().total / (1024**3), 1)
    except ImportError:
        try:
            res = subprocess.run(["wmic", "computersystem", "get", "totalphysicalmemory"], capture_output=True, text=True, timeout=5)
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip().isdigit()]
            if lines: hw["ram_total_gb"] = round(int(lines[0]) / (1024**3), 1)
        except Exception: pass

    # Ã¢â€â‚¬Ã¢â€â‚¬ GPU Name & VRAM Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

    print(f"  [Ã¢Å“â€œ] CPU: {hw['cpu_name']} ({hw['cpu_cores']} cores)")
    print(f"  [Ã¢Å“â€œ] RAM: {hw['ram_total_gb']} GB")
    if hw["gpu_available"]:
        print(f"  [Ã¢Å“â€œ] GPU: {hw['gpu_name']} ({hw['gpu_vram_gb']} GB VRAM)")
    else:
        print("  [!] GPU: No Nvidia GPU detected. CPU Fallback active.")
    
    # Select hardware tier
    if hw["gpu_available"] and hw["gpu_vram_gb"] >= 15.0:
        hw["tier"] = "ultra"
        print("  [Ã¢Å“â€œ] Auto-Configured Tier: ULTRA (vLLM Qwen 7B Vision GPU)")
    elif hw["gpu_available"] and hw["gpu_vram_gb"] >= 6.0:
        hw["tier"] = "mid"
        print("  [Ã¢Å“â€œ] Auto-Configured Tier: MID (vLLM Qwen 7B Vision GPU)")
    else:
        hw["tier"] = "cpu"
        print("  [Ã¢Å“â€œ] Auto-Configured Tier: CPU Fallback (vLLM Qwen 3B CPU)")
        
    print()
    return hw

# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# STEP 2: DOWNLOAD CHOSEN MODEL WEIGHTS (Delegated to vLLM auto-downloader)
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def verify_model_weights(hw):
    print("Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â STEP 2: Checking AI Model Weights Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
    tier_info = TIERS[hw["tier"]]
    model_id = tier_info["model_id"]
    print(f"  [Ã¢Å“â€œ] Configured Model: {tier_info['display_name']}")
    print(f"  [Ã¢Å“â€œ] vLLM will automatically download/cache model weights on startup: {model_id}")
    print()
    return "", model_id

# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# STEP 3: GENERATE CONFIG AND DYNAMIC COMPOSE FILE
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def generate_runtime_configs(hw, model_id):
    print("Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â STEP 3: Auto-Configuring Containers Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
    gpu = hw["gpu_available"]
    tier_info = TIERS[hw["tier"]]
    
    os.makedirs(DATA_DIR, exist_ok=True)
    hw_config_path = os.path.join(DATA_DIR, "hardware_config.json")
    
    model_config = {
        "engine": "vllm",
        "model_id": model_id,
        "display_name": tier_info["display_name"],
        "ctx_window": tier_info["ctx_window"],
        "max_model_len": {"cpu": 1024, "mid": 2048, "ultra": 4096}[hw["tier"]],
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
    print("  [Ã¢Å“â€œ] Saved hardware_config.json")

    # Select a safe context window for the detected hardware tier. This value
    # is shared by vLLM, the backend, and the UI transparency metrics.
    max_model_len = {"cpu": 1024, "mid": 2048, "ultra": 4096}[hw["tier"]]

    if not gpu:
        raise RuntimeError(
            "This Windows release requires an NVIDIA GPU with Docker Desktop GPU support. "
            "Cloud API models remain available on unsupported hardware."
        )

    # Generate custom docker-compose.yml based on GPU availability
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
      - LOCAL_IMAGE_DEVICE=cuda
      - LOCAL_IMAGE_MODEL=segmind/tiny-sd
      - LOCAL_IMAGE_OFFLOAD=none
      - LOCAL_IMAGE_SIZE=384
      - LOCAL_IMAGE_STEPS=12
      - LOCAL_IMAGE_GUIDANCE=7.5
      - LOCAL_IMAGE_USE_SAFETENSORS=0
      - LOCAL_IMAGE_RELEASE_GPU=1
      - VIDEO_CAPTION_DEVICE=cuda
      - MEDIA_WHISPER_DEVICE=cuda
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
      - JWT_SECRET=gmr-robotics-local-security-secret-key-98765
      - ACTIVE_MODEL={model_id}
      - INFERENCE_ENGINE=vllm
      - MAX_MODEL_LEN={max_model_len}
      - VLLM_URL=http://inference-server:8000/v1
      - DATA_DIR=/app/data
      - LOCAL_IMAGE_SERVICE_URL=http://media-generator:8002
      - UPLOAD_WHISPER_DEVICE=cuda
      - UPLOAD_WHISPER_MODEL=tiny
      - HF_HOME=/app/data/models
      - BROWSER_RENDER_SERVICE_URL=http://browser-renderer:8003
    volumes:
      - smaran_data:/app/data
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
    # Windows NVIDIA release: vLLM and the web application run inside one
    # container. Only the user-facing port 3003 is published.
    compose_content = f'''# SMARAN.AI - Windows NVIDIA single-container profile
name: {COMPOSE_PROJECT_NAME}
services:
  app:
    image: {IMAGE_REPOSITORY}:app-{IMAGE_TAG}
    container_name: smaran-ai
    ports:
      - {FRONTEND_PORT}:3003
    environment:
      JWT_SECRET: gmr-robotics-local-security-secret-key-98765
      ACTIVE_MODEL: {model_id}
      INFERENCE_ENGINE: vllm
      MAX_MODEL_LEN: {max_model_len}
      VLLM_URL: http://127.0.0.1:8000/v1
      DATA_DIR: /app/data
      HF_HOME: /root/.cache/huggingface
      VLLM_GPU_MEMORY_UTILIZATION: 0.75
    volumes:
      - smaran_models:/root/.cache/huggingface
      - smaran_data:/app/data
    restart: unless-stopped
{deploy_section}

volumes:
  smaran_models:
    external: true
    name: {MODEL_VOLUME_NAME}
  smaran_data:
    external: true
    name: {DATA_VOLUME_NAME}
'''

    with open(os.path.join(BASE_DIR, "docker-compose.yml"), "w", encoding="utf-8") as f:
        f.write(compose_content)
    print("  [Ã¢Å“â€œ] Generated hardware-tuned docker-compose.yml")
    print()


# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# STEP 4: CHECK DOCKER DESKTOP STATUS
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def verify_docker():
    print("--- STEP 4: Verifying Docker Desktop Status ---")
    if not shutil.which("docker"):
        print("  [*] Docker Desktop is not installed. Starting the official installer...")
        winget = shutil.which("winget")
        if not winget:
            raise RuntimeError("Docker Desktop is required. Install it from https://www.docker.com/products/docker-desktop and run SMARAN.AI again.")
        result = subprocess.run([winget, "install", "--exact", "--id", "Docker.DockerDesktop", "--accept-package-agreements", "--accept-source-agreements"])
        if result.returncode != 0 or not shutil.which("docker"):
            raise RuntimeError("Docker Desktop installation did not complete. Finish the installer, then run SMARAN.AI again.")

    try:
        health = subprocess.run(["docker", "info"], capture_output=True, text=True, timeout=10)
        if health.returncode != 0:
            docker_paths = [
                Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe",
                Path(os.environ.get("LocalAppData", "")) / "Docker" / "Docker Desktop.exe",
            ]
            docker_desktop = next((path for path in docker_paths if path.exists()), None)
            if not docker_desktop:
                raise RuntimeError("Docker is installed but Docker Desktop could not be found. Open Docker Desktop once, then run SMARAN.AI again.")
            print("  [*] Starting Docker Desktop and waiting for its engine...")
            subprocess.Popen([str(docker_desktop)], cwd=str(docker_desktop.parent))
            deadline = time.time() + DOCKER_STARTUP_TIMEOUT_SECONDS
            while time.time() < deadline:
                time.sleep(3)
                health = subprocess.run(["docker", "info"], capture_output=True, text=True, timeout=10)
                if health.returncode == 0:
                    break
            else:
                raise RuntimeError("Docker Desktop did not become ready within 3 minutes. Complete its first-run setup, then run SMARAN.AI again.")
    except RuntimeError:
        raise
    except Exception as error:
        raise RuntimeError(f"Unable to establish a Docker connection: {error}") from error

    print("  [OK] Docker daemon is online and healthy.")
    print()
def run_containers():
    print("=== STEP 5: Launching Local Container Stack ===")
    print("  [*] Loading and starting local services. First boot might take a few minutes...")
    print()
    subprocess.run(["docker", "volume", "create", MODEL_VOLUME_NAME], capture_output=True)
    subprocess.run(["docker", "volume", "create", DATA_VOLUME_NAME], capture_output=True)

    app_image = f"{IMAGE_REPOSITORY}:app-{IMAGE_TAG}"
    required_images = [app_image]
    images_ready = all(subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode == 0 for image in required_images)
    if not images_ready:
        set_startup_status("Downloading the private SMARAN.AI engine...")
        pull_result = subprocess.run(["docker", "pull", app_image])
        if pull_result.returncode != 0 and os.path.isfile(OFFLINE_IMAGE_ARCHIVE):
            pull_result = subprocess.run(["docker", "load", "--input", OFFLINE_IMAGE_ARCHIVE])
        if pull_result.returncode != 0:
            raise RuntimeError(
                "The private SMARAN.AI image could not be downloaded. Sign in to Docker Desktop "
                "with an authorized Docker Hub account, then run SMARAN.AI again."
            )

    if os.path.isfile(OFFLINE_MODEL_ARCHIVE):
        marker_check = subprocess.run(
            ["docker", "run", "--rm", "-v", MODEL_VOLUME_NAME + ":/models", "alpine:3.20", "test", "-f", f"/models/{OFFLINE_MODEL_MARKER}"],
            capture_output=True,
        )
        if marker_check.returncode != 0:
            set_startup_status("Restoring bundled AI model files...")
            restore_result = subprocess.run([
                "docker", "run", "--rm",
                "-v", MODEL_VOLUME_NAME + ":/models",
                "-v", f"{BUNDLE_DIR}:/bundle:ro",
                "alpine:3.20", "sh", "-c",
                f"tar -xzf /bundle/{os.path.basename(OFFLINE_MODEL_ARCHIVE)} -C /models && touch /models/{OFFLINE_MODEL_MARKER}",
            ])
            if restore_result.returncode != 0:
                raise RuntimeError("The bundled AI model files could not be restored. Re-download the installer and try again.")

    with open(os.path.join(DATA_DIR, "hardware_config.json"), encoding="utf-8") as config_file:
        model_config = json.load(config_file)
    subprocess.run(["docker", "rm", "-f", "smaran-ai"], capture_output=True)
    set_startup_status("Starting the unified SMARAN.AI engine...")
    result = subprocess.run([
        "docker", "run", "-d", "--name", "smaran-ai", "--restart", "unless-stopped",
        "--gpus", "all", "-p", f"{FRONTEND_PORT}:3003",
        "-e", "JWT_SECRET=gmr-robotics-local-security-secret-key-98765",
        "-e", f"ACTIVE_MODEL={model_config['model_id']}",
        "-e", "INFERENCE_ENGINE=vllm",
        "-e", f"MAX_MODEL_LEN={model_config['max_model_len']}",
        "-e", "DATA_DIR=/app/data", "-e", "HF_HOME=/root/.cache/huggingface",
        "-e", "VLLM_GPU_MEMORY_UTILIZATION=0.75",
        "-v", f"{MODEL_VOLUME_NAME}:/root/.cache/huggingface",
        "-v", f"{DATA_DIR}:/app/data",
        app_image,
    ])
    if result.returncode != 0:
        raise RuntimeError("SMARAN.AI services could not be started. Open Docker Desktop and check that it is running.")

    print()
    print("  [OK] Container stack is running.")
    print()
# STEP 5b: START HOST STATS BRIDGE (real-time telemetry)
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
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
                # CPU Ã¢â‚¬â€ physical cores matches Task Manager
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
    print("Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â STEP 5b: Starting Host Stats Bridge Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
    try:
        t = threading.Thread(target=telemetry_worker, daemon=True)
        t.start()
        print("  [Ã¢Å“â€œ] Background host telemetry thread started.")
    except Exception as e:
        print(f"  [!] Could not start telemetry thread: {e}")
    print()


# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# STEP 6: LAN FIREWALL RULE CONFIG
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def configure_firewall():
    print("Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â STEP 6: LAN Firewall Configuration Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
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
            subprocess.run(["netsh", "advfirewall", "firewall", "delete", "rule", "name=SMARAN.AI Platform"], capture_output=True)
            subprocess.run([
                "netsh", "advfirewall", "firewall", "add", "rule",
                "name=SMARAN.AI Platform", "dir=in", "action=allow",
                "protocol=TCP", f"localport={FRONTEND_PORT}", "profile=private,domain"
            ], capture_output=True)
            print(f"  [Ã¢Å“â€œ] Inbound traffic firewall rule set for port {FRONTEND_PORT}")
        except Exception:
            print("  [!] Failed to set firewall rule.")
    else:
        print("  [!] Running without Administrator rights. Inbound network rule skipped.")
        print("      To let other devices on your LAN access this node, run launcher as Admin.")
        
    print(f"  [Ã¢Å“â€œ] Current Host LAN IP: {lan_ip}")
    print()
    return lan_ip

# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# STEP 7: HEALTH CHECK & AUTO BROWSER LAUNCH
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def wait_for_online(lan_ip):
    print("Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â STEP 7: Verifying System Health & Launching Browser Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")
    
    url = f"http://localhost:{FRONTEND_PORT}"
    max_checks = 180
    for check in range(max_checks):
        try:
            req = urllib.request.urlopen(url, timeout=3)
            if req.status == 200:
                print("  [OK] SMARAN.AI Platform is fully ONLINE!")
                print()
                
                import webbrowser
                webbrowser.open(url)
                return True
        except Exception:
            pass
        time.sleep(2)
        dots = "." * ((check % 3) + 1)
        print(f"  [*] Waiting for web interface to load{dots}      ", end="\r")

    print("\n  [!] Platform is still starting. Docker Desktop is running; open http://localhost:3003 after the model download finishes.")
    return False

# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# MAIN ROUTINE
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
def main():
    global STARTUP_WINDOW
    STARTUP_WINDOW = StartupWindow()
    set_startup_status("Checking your computer and Docker Desktop...")
    print_banner()
    hw = detect_hardware()
    model_path, model_id = verify_model_weights(hw)
    set_startup_status("Creating the optimized local configuration...")
    generate_runtime_configs(hw, model_id)
    set_startup_status("Starting Docker Desktop if needed...")
    verify_docker()
    run_containers()
    start_host_stats_bridge()
    lan_ip = configure_firewall()
    wait_for_online(lan_ip)
    if STARTUP_WINDOW:
        STARTUP_WINDOW.close()

    print("Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("SMARAN.AI IS RUNNING")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("Ã¢â€¢Â Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â£")
    print(f"Ã¢â€¢â€˜  Ã°Å¸Å’Â Local Console:   http://localhost:{FRONTEND_PORT}                   Ã¢â€¢â€˜")
    print(f"Ã¢â€¢â€˜  Ã°Å¸ÂÂ¢ LAN Access IP:   http://{lan_ip}:{FRONTEND_PORT}              Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜  Hardware profile used:                                       Ã¢â€¢â€˜")
    print(f"Ã¢â€¢â€˜    CPU:  {hw['cpu_name'][:48]:48s}    Ã¢â€¢â€˜")
    if hw["gpu_available"]:
        print(f"Ã¢â€¢â€˜    GPU:  {hw['gpu_name'][:48]:48s}    Ã¢â€¢â€˜")
        print(f"Ã¢â€¢â€˜    VRAM: {hw['gpu_vram_gb']} GB                                          Ã¢â€¢â€˜")
    else:
        print("Ã¢â€¢â€˜    GPU:  No GPU (CPU fallback mode active)                   Ã¢â€¢â€˜")
    print(f"Ã¢â€¢â€˜    RAM:  {hw['ram_total_gb']} GB                                            Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜  Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬         Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜  To share this node with other devices on your LAN:           Ã¢â€¢â€˜")
    print(f"Ã¢â€¢â€˜  Give them this link: http://{lan_ip}:{FRONTEND_PORT}                 Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜                                                                Ã¢â€¢â€˜")
    print("Ã¢â€¢â€˜  (Press Enter to close this window, platform stays active)     Ã¢â€¢â€˜")
    print("Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Exit requested by user.")
    except Exception as e:
        print(f"\n[Ã¢Å“â€”] Fatal error encountered: {e}")
        import traceback
        traceback.print_exc()
        if STARTUP_WINDOW:
            STARTUP_WINDOW.close()
        try:
            messagebox.showerror(APP_NAME, str(e))
        except Exception:
            pass
