"""
Creator Telemetry & Active Software Instance Tracker
===================================================
Developed by SHASHWAT MISHRA (https://www.linkedin.com/in/sm980/)

Uses ntfy.sh — 100% free, no signup, no account needed.
Sends push notifications to Shashwat's phone/browser whenever:
  - A new SMARAN.AI installation boots for the first time
  - An existing installation sends a periodic heartbeat (every 12 hours)

HOW SHASHWAT SEES ALL ACTIVE USERS:
  1. Install "ntfy" app on Android (Play Store) or iPhone (App Store)
  2. Subscribe to topic: smaran-ai-creator-9x8k7m
  3. Every time ANY user in the world starts SMARAN.AI, you get a push notification!
  4. Or open browser: https://ntfy.sh/smaran-ai-creator-9x8k7m

Security: Topic name is a private random string. No one else knows it.
Privacy: Only installation_id, OS, version, and timestamp are sent. ZERO user data.
"""

import os
import sys
import json
import uuid
import platform
import logging
import threading
import time
import urllib.request
import urllib.error

logger = logging.getLogger("creator_telemetry")

DATA_DIR = os.getenv("DATA_DIR", "./data")
INST_FILE = os.path.join(DATA_DIR, "installation.json")

# ═══════════════════════════════════════════════════════════════════════
# ntfy.sh — FREE Push Notification Service (No Signup Required)
# Topic URL: https://ntfy.sh/smaran-ai-creator-9x8k7m
# Subscribe on phone: Install ntfy app → Add topic "smaran-ai-creator-9x8k7m"
# Subscribe on browser: https://ntfy.sh/smaran-ai-creator-9x8k7m
# ═══════════════════════════════════════════════════════════════════════
NTFY_TOPIC = "smaran-ai-creator-9x8k7m"
NTFY_URL = f"https://ntfy.sh/{NTFY_TOPIC}"


def get_or_create_installation_id() -> str:
    """Returns or creates a persistent unique Installation UUID for this software deployment."""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        if os.path.exists(INST_FILE):
            with open(INST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if "installation_id" in data:
                    return data["installation_id"]

        # Generate fresh UUID for new instance
        new_id = f"smaran-inst-{uuid.uuid4().hex[:12]}"
        with open(INST_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "installation_id": new_id,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "first_boot": True,
                "creator": "SHASHWAT MISHRA",
                "app_name": "SMARAN.AI"
            }, f, indent=2)
        logger.info(f"Generated fresh Smaran AI installation ID: {new_id}")
        return new_id
    except Exception as e:
        logger.warning(f"Error accessing installation metadata: {e}")
        return f"smaran-inst-fallback-{uuid.uuid4().hex[:8]}"


def _is_first_boot() -> bool:
    """Check if this is the very first boot of this installation."""
    try:
        if os.path.exists(INST_FILE):
            with open(INST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("first_boot", False)
        return True
    except Exception:
        return False


def _mark_first_boot_done():
    """Mark first boot as completed so subsequent boots send heartbeat instead of new_install."""
    try:
        if os.path.exists(INST_FILE):
            with open(INST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["first_boot"] = False
            data["last_heartbeat"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            with open(INST_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
    except Exception:
        pass


def send_creator_heartbeat(status: str = "active"):
    """
    Non-blocking background thread that sends a push notification to Shashwat's ntfy topic.
    
    Notification format:
      Title: 🟢 SMARAN.AI — New Installation!  (or ♻️ Heartbeat)
      Body:  ID: smaran-inst-abc123 | Windows 11 | v1.0.0 | 2026-08-08T15:30:00Z
    """
    def _ping():
        try:
            inst_id = get_or_create_installation_id()
            os_name = platform.system()
            os_ver = platform.release()
            machine = platform.machine()
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            # Determine notification style based on status
            if status == "boot" and _is_first_boot():
                title = "🚀 SMARAN.AI — New Installation Detected!"
                priority = "high"
                tags = "rocket,new"
                _mark_first_boot_done()
            elif status == "boot":
                title = "🟢 SMARAN.AI — Instance Rebooted"
                priority = "default"
                tags = "green_circle,boot"
            elif status == "heartbeat":
                title = "♻️ SMARAN.AI — Active Heartbeat"
                priority = "low"
                tags = "recycle,heartbeat"
            else:
                title = f"📡 SMARAN.AI — {status.upper()}"
                priority = "default"
                tags = "satellite,ping"

            body = (
                f"📌 ID: {inst_id}\n"
                f"💻 OS: {os_name} {os_ver} ({machine})\n"
                f"📦 Version: 1.0.0\n"
                f"🕐 Time: {ts}"
            )

            req = urllib.request.Request(
                NTFY_URL,
                data=body.encode("utf-8"),
                headers={
                    "Title": title,
                    "Priority": priority,
                    "Tags": tags,
                    "User-Agent": "SmaranAI-CreatorTelemetry/2.2"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                logger.info(f"Creator Telemetry → ntfy.sh notification sent (HTTP {resp.status})")
        except Exception as err:
            # Silently skip — user's internet may be offline, that's fine
            logger.debug(f"Creator Telemetry ping skipped (offline/error): {err}")

    thread = threading.Thread(target=_ping, daemon=True)
    thread.start()


def start_periodic_telemetry():
    """Starts a daemon loop that pings creator telemetry on boot and every 12 hours."""
    def _loop():
        # Small delay to let the app fully start
        time.sleep(5)
        send_creator_heartbeat("boot")
        while True:
            time.sleep(12 * 3600)  # Ping every 12 hours
            send_creator_heartbeat("heartbeat")

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    logger.info("Creator Telemetry daemon started (ntfy.sh push notifications enabled)")
