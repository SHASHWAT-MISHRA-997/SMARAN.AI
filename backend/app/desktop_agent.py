"""
SMARAN.AI J.A.R.V.I.S. Desktop Agent — Full OS Control Service
================================================================
Tony Stark style desktop automation: open apps, manage files, browser control,
system operations — all via natural language voice/chat commands.

All actions are free, open-source, and use Python stdlib + psutil.
Destructive actions always require user confirmation before execution.
"""
from __future__ import annotations

import asyncio
import base64
import ctypes
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

import psutil

import logging
logger = logging.getLogger("smaran.desktop_agent")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
WIN_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

SAFE_USER_DIRS = {
    "desktop": Path.home() / "Desktop",
    "documents": Path.home() / "Documents",
    "downloads": Path.home() / "Downloads",
    "pictures": Path.home() / "Pictures",
    "videos": Path.home() / "Videos",
    "music": Path.home() / "Music",
}

# Well-known Windows applications and their launch commands
APP_REGISTRY: Dict[str, List[str]] = {
    # Browsers
    "chrome": ["start", "chrome"],
    "google chrome": ["start", "chrome"],
    "brave": ["start", "brave"],
    "edge": ["start", "msedge"],
    "microsoft edge": ["start", "msedge"],
    "firefox": ["start", "firefox"],
    # Communication
    "whatsapp": ["start", "whatsapp:"],
    "telegram": ["start", "tg:"],
    "discord": ["start", "discord:"],
    "teams": ["start", "msteams:"],
    "microsoft teams": ["start", "msteams:"],
    "zoom": ["start", "zoommtg:"],
    "slack": ["start", "slack:"],
    # Productivity
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "paint": ["mspaint.exe"],
    "word": ["start", "winword"],
    "excel": ["start", "excel"],
    "powerpoint": ["start", "powerpnt"],
    "outlook": ["start", "outlook"],
    # Development
    "vs code": ["code"],
    "vscode": ["code"],
    "visual studio code": ["code"],
    "terminal": ["wt.exe"],
    "windows terminal": ["wt.exe"],
    "cmd": ["cmd.exe"],
    "powershell": ["powershell.exe"],
    # System
    "file explorer": ["explorer.exe"],
    "explorer": ["explorer.exe"],
    "task manager": ["taskmgr.exe"],
    "settings": ["start", "ms-settings:"],
    "control panel": ["control.exe"],
    "snipping tool": ["snippingtool.exe"],
    # Media
    "spotify": ["start", "spotify:"],
    "vlc": ["start", "vlc"],
    "photos": ["start", "ms-photos:"],
}

# Social media & popular URLs
URL_REGISTRY: Dict[str, str] = {
    "youtube": "https://www.youtube.com",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
    "twitter": "https://twitter.com",
    "x": "https://x.com",
    "linkedin": "https://www.linkedin.com",
    "reddit": "https://www.reddit.com",
    "github": "https://github.com",
    "whatsapp web": "https://web.whatsapp.com",
    "gmail": "https://mail.google.com",
    "google drive": "https://drive.google.com",
    "google docs": "https://docs.google.com",
    "google sheets": "https://sheets.google.com",
    "google maps": "https://maps.google.com",
    "amazon": "https://www.amazon.in",
    "flipkart": "https://www.flipkart.com",
    "netflix": "https://www.netflix.com",
    "hotstar": "https://www.hotstar.com",
    "spotify": "https://open.spotify.com",
    "pinterest": "https://www.pinterest.com",
    "tiktok": "https://www.tiktok.com",
    "snapchat": "https://www.snapchat.com",
    "threads": "https://www.threads.net",
    "chatgpt": "https://chat.openai.com",
    "gemini": "https://gemini.google.com",
    "claude": "https://claude.ai",
}

# ---------------------------------------------------------------------------
# Action Catalog — Each action has risk level & confirmation requirement
# ---------------------------------------------------------------------------
DESKTOP_ACTION_CATALOG: Dict[str, Dict[str, Any]] = {
    # ---- App & URL Launchers (Safe) ----
    "open_url": {
        "title": "Open URL in browser",
        "description": "Open any website URL in the default browser.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"url": "Full URL to open"},
        "category": "launcher",
    },
    "open_website": {
        "title": "Open a popular website",
        "description": "Open YouTube, Instagram, Gmail, Twitter, etc. by name.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"name": "Website name (e.g. youtube, instagram, gmail)"},
        "category": "launcher",
    },
    "search_youtube": {
        "title": "Search & play on YouTube",
        "description": "Open YouTube and search for a video or topic.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"query": "Search term for YouTube"},
        "category": "launcher",
    },
    "open_application": {
        "title": "Launch a desktop application",
        "description": "Open any installed application (Chrome, VS Code, Notepad, Calculator, etc.).",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"name": "Application name"},
        "category": "launcher",
    },
    "open_folder": {
        "title": "Open a folder in File Explorer",
        "description": "Open a specific folder in Windows File Explorer.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"path": "Folder path (e.g. Desktop, Downloads, or absolute path)"},
        "category": "launcher",
    },
    "compose_email": {
        "title": "Compose an email in Gmail",
        "description": "Open Gmail with a pre-filled compose window.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"to": "Recipient email", "subject": "Email subject (optional)", "body": "Email body (optional)"},
        "category": "communication",
    },

    # ---- File Operations ----
    "list_files": {
        "title": "List files in a directory",
        "description": "Show all files and folders in a directory.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"path": "Directory path"},
        "category": "files",
    },
    "search_files": {
        "title": "Search for files by name",
        "description": "Find files matching a name pattern in a directory.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"query": "File name or pattern", "path": "Search directory (optional)"},
        "category": "files",
    },
    "create_folder": {
        "title": "Create a new folder",
        "description": "Create a new folder at the specified path.",
        "risk": "low",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {"path": "Full path for new folder"},
        "category": "files",
    },
    "rename_file": {
        "title": "Rename a file or folder",
        "description": "Rename a file or folder.",
        "risk": "low",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {"old_path": "Current file/folder path", "new_name": "New name"},
        "category": "files",
    },
    "move_file": {
        "title": "Move a file or folder",
        "description": "Move a file or folder to a new location.",
        "risk": "medium",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {"source": "Source path", "destination": "Destination path"},
        "category": "files",
    },
    "copy_file": {
        "title": "Copy a file or folder",
        "description": "Copy a file or folder to a new location.",
        "risk": "low",
        "changes_system": True,
        "requires_confirmation": False,
        "parameters": {"source": "Source path", "destination": "Destination path"},
        "category": "files",
    },
    "delete_file": {
        "title": "Delete a file (move to Recycle Bin)",
        "description": "Move a file to the Recycle Bin. Can be recovered.",
        "risk": "high",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {"path": "File path to delete"},
        "category": "files",
    },
    "delete_folder": {
        "title": "Delete a folder (move to Recycle Bin)",
        "description": "Move a folder and its contents to the Recycle Bin.",
        "risk": "high",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {"path": "Folder path to delete"},
        "category": "files",
    },

    # ---- System Operations ----
    "empty_recycle_bin": {
        "title": "Empty the Recycle Bin",
        "description": "Permanently delete all items in the Recycle Bin.",
        "risk": "high",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {},
        "category": "system",
    },
    "take_screenshot": {
        "title": "Take a screenshot",
        "description": "Capture the current screen and return the image.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {},
        "category": "system",
    },
    "lock_computer": {
        "title": "Lock the computer",
        "description": "Lock the Windows workstation (requires password to unlock).",
        "risk": "medium",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {},
        "category": "system",
    },
    "list_running_apps": {
        "title": "List running applications",
        "description": "Show all currently running applications with CPU and memory usage.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {"filter": "Optional process name filter"},
        "category": "system",
    },
    "close_application": {
        "title": "Close an application",
        "description": "Terminate a running application.",
        "risk": "high",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {"name": "Application name to close"},
        "category": "system",
    },
    "get_system_info": {
        "title": "Get full system information",
        "description": "Show CPU, GPU, RAM, Disk, Battery, and OS information.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {},
        "category": "system",
    },
    "get_battery_status": {
        "title": "Get battery status",
        "description": "Show battery percentage and charging state.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {},
        "category": "system",
    },
    "set_volume": {
        "title": "Set system volume",
        "description": "Adjust the system audio volume (0-100).",
        "risk": "low",
        "changes_system": True,
        "requires_confirmation": False,
        "parameters": {"level": "Volume level 0-100"},
        "category": "system",
    },
    "get_clipboard": {
        "title": "Read clipboard contents",
        "description": "Read the current text from the system clipboard.",
        "risk": "read_only",
        "changes_system": False,
        "requires_confirmation": False,
        "parameters": {},
        "category": "system",
    },
    "set_clipboard": {
        "title": "Set clipboard text",
        "description": "Copy text to the system clipboard.",
        "risk": "low",
        "changes_system": True,
        "requires_confirmation": False,
        "parameters": {"text": "Text to copy to clipboard"},
        "category": "system",
    },
    "flush_dns": {
        "title": "Flush DNS cache",
        "description": "Clear the Windows DNS resolver cache.",
        "risk": "low",
        "changes_system": True,
        "requires_confirmation": True,
        "parameters": {},
        "category": "system",
    },

    # ---- Media, window and input control --------------------------------
    "media_play_pause": {
        "title": "Play or pause media",
        "description": "Send the play/pause key to whatever is playing.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "media",
    },
    "media_next": {
        "title": "Next track",
        "description": "Skip to the next track.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "media",
    },
    "media_previous": {
        "title": "Previous track",
        "description": "Go back to the previous track.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "media",
    },
    "toggle_mute": {
        "title": "Mute or unmute",
        "description": "Toggle the system mute state.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "media",
    },
    "volume_up": {
        "title": "Volume up",
        "description": "Raise the system volume a step.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "media",
    },
    "volume_down": {
        "title": "Volume down",
        "description": "Lower the system volume a step.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "media",
    },
    "minimize_all_windows": {
        "title": "Show the desktop",
        "description": "Minimise every window.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "window",
    },
    "switch_window": {
        "title": "Switch window",
        "description": "Move to the next open window.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "window",
    },
    "type_text": {
        "title": "Type text",
        "description": "Type the given text into whatever currently has focus.",
        "risk": "medium", "changes_system": False, "requires_confirmation": True,
        "parameters": {"text": "Text to type"}, "category": "input",
    },
    "get_time": {
        "title": "Current date and time",
        "description": "Report the machine's current date and time.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "system",
    },
    "list_drives": {
        "title": "List drives",
        "description": "Report each drive with its free and total space.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "system",
    },
    "get_network_info": {
        "title": "Network status",
        "description": "Report the active network connection.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "system",
    },
    "create_note": {
        "title": "Save a note",
        "description": "Write a note to a text file in the user's Documents folder.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {"text": "Note contents", "name": "Optional file name"},
        "category": "files",
    },
    "sleep_computer": {
        "title": "Sleep the computer",
        "description": "Put the machine to sleep.",
        "risk": "high", "changes_system": True, "requires_confirmation": True,
        "parameters": {}, "category": "power",
    },
    "restart_computer": {
        "title": "Restart the computer",
        "description": "Restart the machine.",
        "risk": "high", "changes_system": True, "requires_confirmation": True,
        "parameters": {}, "category": "power",
    },
    "shutdown_computer": {
        "title": "Shut down the computer",
        "description": "Shut the machine down.",
        "risk": "high", "changes_system": True, "requires_confirmation": True,
        "parameters": {}, "category": "power",
    },
    "cancel_shutdown": {
        "title": "Cancel a pending shutdown or restart",
        "description": "Abort a shutdown or restart that is counting down.",
        "risk": "low", "changes_system": True, "requires_confirmation": False,
        "parameters": {}, "category": "power",
    },

    # ---- Information (read-only, no API key) ----
    "get_weather": {
        "title": "Get the weather",
        "description": "Current conditions for a city, or for wherever this machine is.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {"city": "City name (optional)"}, "category": "info",
    },
    "get_public_ip": {
        "title": "Get the public IP address",
        "description": "Report the outward-facing IP address of this connection.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "info",
    },
    "ping_host": {
        "title": "Ping a host",
        "description": "Check whether a host answers and how long it takes.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {"host": "Hostname or IP to ping"}, "category": "info",
    },
    "list_wifi_networks": {
        "title": "List nearby Wi-Fi networks",
        "description": "Show the wireless networks currently in range.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "info",
    },
    "get_uptime": {
        "title": "Get system uptime",
        "description": "How long this machine has been running since the last boot.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "info",
    },
    "list_installed_apps": {
        "title": "List installed applications",
        "description": "Show the programs installed on this machine.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "info",
    },
    "list_startup_apps": {
        "title": "List startup programs",
        "description": "Show what launches automatically when Windows starts.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "info",
    },

    # ---- System panels ----
    "open_task_manager": {
        "title": "Open Task Manager",
        "description": "Bring up Windows Task Manager.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "launcher",
    },
    "open_settings": {
        "title": "Open Windows Settings",
        "description": "Open the Windows Settings app.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "launcher",
    },
    "open_control_panel": {
        "title": "Open Control Panel",
        "description": "Open the classic Windows Control Panel.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "launcher",
    },
    "open_device_manager": {
        "title": "Open Device Manager",
        "description": "Open Windows Device Manager.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "launcher",
    },
    "open_snipping_tool": {
        "title": "Open the Snipping Tool",
        "description": "Start the Windows screenshot tool.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {}, "category": "launcher",
    },

    # ---- Files ----
    "zip_folder": {
        "title": "Zip a folder",
        "description": "Compress a folder into a .zip archive beside it.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {"path": "Folder to compress"}, "category": "files",
    },
    "unzip_file": {
        "title": "Extract a zip archive",
        "description": "Unpack a .zip file into a folder of the same name.",
        "risk": "low", "changes_system": False, "requires_confirmation": False,
        "parameters": {"path": "Archive to extract"}, "category": "files",
    },
    "read_text_file": {
        "title": "Read a text file",
        "description": "Read back the contents of a text file.",
        "risk": "read_only", "changes_system": False, "requires_confirmation": False,
        "parameters": {"path": "File to read"}, "category": "files",
    },

    # ---- Appearance & preferences ----
    "set_wallpaper": {
        "title": "Set the desktop wallpaper",
        "description": "Use an image file as the desktop background.",
        "risk": "low", "changes_system": True, "requires_confirmation": False,
        "parameters": {"path": "Image file to use"}, "category": "system",
    },
    "toggle_dark_mode": {
        "title": "Switch between light and dark mode",
        "description": "Flip the Windows app theme.",
        "risk": "low", "changes_system": True, "requires_confirmation": False,
        "parameters": {}, "category": "system",
    },
    "set_launch_at_startup": {
        "title": "Start SMARAN.AI with Windows",
        "description": "Add or remove SMARAN.AI from the Windows startup folder.",
        "risk": "low", "changes_system": True, "requires_confirmation": False,
        "parameters": {"enabled": "true to enable, false to disable"}, "category": "system",
    },
}


# ---------------------------------------------------------------------------
# Helper: Run a Windows command safely
# ---------------------------------------------------------------------------
def _run_host_cmd(cmd: List[str], *, shell: bool = True, timeout: int = 15) -> Tuple[bool, str]:
    """Run a host command and return (success, output)."""
    try:
        kwargs: Dict[str, Any] = {
            "capture_output": True,
            "text": True,
            "timeout": timeout,
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = WIN_NO_WINDOW
        if shell:
            kwargs["shell"] = True
        result = subprocess.run(cmd, **kwargs)
        output = (result.stdout or "") + (result.stderr or "")
        return result.returncode == 0, output.strip()
    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except Exception as e:
        return False, str(e)


def _safe_path(path_str: str) -> Path:
    """Resolve a user-provided path, expanding ~ and known folder names."""
    path_str = path_str.strip().strip('"').strip("'")

    # Handle known folder names
    lower = path_str.lower().replace("\\", "/").strip("/")
    if lower in SAFE_USER_DIRS:
        return SAFE_USER_DIRS[lower]

    # Handle ~ expansion
    if path_str.startswith("~"):
        return Path.home() / path_str[2:]

    return Path(path_str).resolve()


def _is_safe_path(path: Path) -> bool:
    """Check if a path is within user-safe directories (not system dirs)."""
    home = Path.home()
    safe_roots = [
        home / "Desktop",
        home / "Documents",
        home / "Downloads",
        home / "Pictures",
        home / "Videos",
        home / "Music",
        home / "OneDrive",
        Path("D:/"),
        Path("E:/"),
        Path("F:/"),
    ]
    # Also allow anything under the user's home
    try:
        path.relative_to(home)
        return True
    except ValueError:
        pass

    for root in safe_roots:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            continue

    return False


# ---------------------------------------------------------------------------
# Action Implementations
# ---------------------------------------------------------------------------

# Recent machine actions, newest last. Kept in memory only: this is an audit
# trail for the person at the keyboard, not a persisted record.
_OPERATION_LOG: List[Dict[str, Any]] = []
_OPERATION_LOG_LIMIT = 200


def record_operation(action_id: str, params: Dict[str, Any], result: Dict[str, Any]) -> None:
    """Append one executed action to the operations log."""
    _OPERATION_LOG.append({
        "action": action_id,
        "title": DESKTOP_ACTION_CATALOG.get(action_id, {}).get("title", action_id),
        "category": DESKTOP_ACTION_CATALOG.get(action_id, {}).get("category", "other"),
        "risk": DESKTOP_ACTION_CATALOG.get(action_id, {}).get("risk", "unknown"),
        # Parameter values can contain file paths the user typed; keep them
        # short rather than dropping them, since they are what makes the log
        # readable after the fact.
        "params": {key: str(value)[:120] for key, value in (params or {}).items()},
        "success": bool(result.get("success")),
        "message": str(result.get("message") or result.get("error") or "")[:300],
        "at": datetime.now().isoformat(timespec="seconds"),
    })
    if len(_OPERATION_LOG) > _OPERATION_LOG_LIMIT:
        del _OPERATION_LOG[:-_OPERATION_LOG_LIMIT]


def operation_log(limit: int = 50) -> List[Dict[str, Any]]:
    """Return the most recent operations, newest first."""
    return list(reversed(_OPERATION_LOG[-max(1, min(limit, _OPERATION_LOG_LIMIT)):]))


def clear_operation_log() -> None:
    _OPERATION_LOG.clear()


class DesktopAgent:
    """Executes desktop actions on the host Windows machine."""

    @staticmethod
    def catalog() -> List[Dict[str, Any]]:
        """Return the full catalog of available desktop actions."""
        return [{"id": aid, **spec} for aid, spec in DESKTOP_ACTION_CATALOG.items()]

    @staticmethod
    async def execute(action_id: str, params: Dict[str, Any], confirmed: bool = False) -> Dict[str, Any]:
        """Execute a desktop action. Returns result dict."""
        if action_id not in DESKTOP_ACTION_CATALOG:
            return {"success": False, "error": f"Unknown action: {action_id}", "action": action_id}

        spec = DESKTOP_ACTION_CATALOG[action_id]

        # Check confirmation requirement
        if spec.get("requires_confirmation") and not confirmed:
            return {
                "success": False,
                "requires_confirmation": True,
                "action": action_id,
                "title": spec["title"],
                "description": f"⚠️ This action requires your confirmation: {spec['title']}",
                "params": params,
                "risk": spec["risk"],
            }

        # Dispatch to handler
        handler = getattr(DesktopAgent, f"_action_{action_id}", None)
        if not handler:
            return {"success": False, "error": f"Action handler not implemented: {action_id}"}

        try:
            result = await asyncio.to_thread(handler, params)
            result["action"] = action_id
            record_operation(action_id, params, result)
            return result
        except Exception as e:
            logger.error(f"Desktop action {action_id} failed: {e}")
            failure = {"success": False, "error": str(e), "action": action_id}
            record_operation(action_id, params, failure)
            return failure

    # ---- App & URL Launchers ----

    @staticmethod
    def _action_open_url(params: Dict[str, Any]) -> Dict[str, Any]:
        url = params.get("url", "").strip()
        if not url:
            return {"success": False, "error": "No URL provided."}
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        webbrowser.open(url)
        return {"success": True, "message": f"Opened {url} in browser.", "url": url}

    @staticmethod
    def _action_open_website(params: Dict[str, Any]) -> Dict[str, Any]:
        name = params.get("name", "").strip().lower()
        if not name:
            return {"success": False, "error": "No website name provided."}
        url = URL_REGISTRY.get(name)
        if not url:
            url = f"https://www.{name}.com"
        webbrowser.open(url)
        return {"success": True, "message": f"Opened {name} in browser.", "url": url}

    @staticmethod
    def _action_search_youtube(params: Dict[str, Any]) -> Dict[str, Any]:
        query = params.get("query", "").strip()
        if not query:
            return {"success": False, "error": "No search query provided."}
        url = f"https://www.youtube.com/results?search_query={query.replace(' ', '+')}"
        webbrowser.open(url)
        return {"success": True, "message": f"Searching YouTube for: {query}", "url": url}

    @staticmethod
    def _action_open_application(params: Dict[str, Any]) -> Dict[str, Any]:
        name = params.get("name", "").strip().lower()
        if not name:
            return {"success": False, "error": "No application name provided."}

        # Direct Windows known app execution for instant reliable launch
        if sys.platform == "win32":
            try:
                if name in ("notepad", "notepad.exe"):
                    subprocess.Popen(["notepad.exe"])
                    return {"success": True, "message": "Launched Notepad.", "app": "Notepad"}
                elif name in ("calculator", "calc", "calc.exe"):
                    subprocess.Popen(["calc.exe"])
                    return {"success": True, "message": "Launched Calculator.", "app": "Calculator"}
                elif name in ("paint", "mspaint", "mspaint.exe"):
                    subprocess.Popen(["mspaint.exe"])
                    return {"success": True, "message": "Launched Paint.", "app": "Paint"}
                elif name in ("task manager", "taskmgr", "taskmgr.exe"):
                    subprocess.Popen(["taskmgr.exe"])
                    return {"success": True, "message": "Launched Task Manager.", "app": "Task Manager"}
                elif name in ("file explorer", "explorer", "my computer"):
                    subprocess.Popen(["explorer.exe"])
                    return {"success": True, "message": "Launched File Explorer.", "app": "File Explorer"}
                elif name in ("settings", "windows settings"):
                    os.system("start ms-settings:")
                    return {"success": True, "message": "Opened Windows Settings.", "app": "Settings"}
                elif name in ("terminal", "windows terminal", "wt"):
                    subprocess.Popen(["wt.exe"])
                    return {"success": True, "message": "Launched Windows Terminal.", "app": "Terminal"}
                elif name in ("cmd", "command prompt"):
                    subprocess.Popen(["cmd.exe"])
                    return {"success": True, "message": "Launched Command Prompt.", "app": "Command Prompt"}
                elif name in ("powershell", "ps"):
                    subprocess.Popen(["powershell.exe"])
                    return {"success": True, "message": "Launched PowerShell.", "app": "PowerShell"}
                elif name in ("vscode", "vs code", "code", "visual studio code"):
                    subprocess.Popen("code", shell=True)
                    return {"success": True, "message": "Launched VS Code.", "app": "VS Code"}
                elif name in ("chrome", "google chrome"):
                    subprocess.Popen("start chrome", shell=True)
                    return {"success": True, "message": "Launched Google Chrome.", "app": "Chrome"}
                elif name in ("brave", "brave browser"):
                    subprocess.Popen("start brave", shell=True)
                    return {"success": True, "message": "Launched Brave Browser.", "app": "Brave"}
                elif name in ("edge", "microsoft edge"):
                    subprocess.Popen("start msedge", shell=True)
                    return {"success": True, "message": "Launched Microsoft Edge.", "app": "Edge"}
                elif name in ("spotify",):
                    subprocess.Popen("start spotify:", shell=True)
                    return {"success": True, "message": "Launched Spotify.", "app": "Spotify"}
                elif name in ("snipping tool", "snip"):
                    subprocess.Popen("start ms-screenclip:", shell=True)
                    return {"success": True, "message": "Opened Snipping Tool.", "app": "Snipping Tool"}
            except Exception as e:
                logger.warning(f"Direct app launch exception for {name}: {e}")

        # Check app registry
        cmd = APP_REGISTRY.get(name)
        if cmd:
            try:
                subprocess.Popen(cmd, shell=True)
                return {"success": True, "message": f"Launched {name}.", "app": name}
            except Exception as e:
                return {"success": False, "error": f"Failed to launch {name}: {e}"}

        # Try launching by name directly
        try:
            subprocess.Popen(["start", "", name], shell=True)
            return {"success": True, "message": f"Launched {name}.", "app": name}
        except Exception as e:
            return {"success": False, "error": f"Could not find or launch '{name}': {e}"}

    @staticmethod
    def _action_open_folder(params: Dict[str, Any]) -> Dict[str, Any]:
        path_str = params.get("path", "").strip()
        if not path_str:
            return {"success": False, "error": "No folder path provided."}

        folder = _safe_path(path_str)
        if not folder.exists():
            return {"success": False, "error": f"Folder not found: {folder}"}
        if not folder.is_dir():
            subprocess.Popen(["explorer.exe", "/select,", str(folder)], creationflags=WIN_NO_WINDOW)
            return {"success": True, "message": f"Opened folder containing {folder.name}."}

        subprocess.Popen(["explorer.exe", str(folder)], creationflags=WIN_NO_WINDOW)
        return {"success": True, "message": f"Opened {folder.name} in File Explorer."}

    @staticmethod
    def _action_compose_email(params: Dict[str, Any]) -> Dict[str, Any]:
        to = params.get("to", "").strip()
        subject = params.get("subject", "").strip()
        body = params.get("body", "").strip()

        gmail_url = "https://mail.google.com/mail/?view=cm"
        if to:
            gmail_url += f"&to={to}"
        if subject:
            gmail_url += f"&su={subject.replace(' ', '+')}"
        if body:
            gmail_url += f"&body={body.replace(' ', '+')}"

        webbrowser.open(gmail_url)
        return {"success": True, "message": f"Opened Gmail compose{' to ' + to if to else ''}.", "url": gmail_url}

    # ---- File Operations ----

    @staticmethod
    def _action_list_files(params: Dict[str, Any]) -> Dict[str, Any]:
        path_str = params.get("path", "").strip() or "Desktop"
        folder = _safe_path(path_str)

        if not folder.exists():
            return {"success": False, "error": f"Directory not found: {folder}"}
        if not folder.is_dir():
            return {"success": False, "error": f"Not a directory: {folder}"}

        items = []
        try:
            for entry in sorted(folder.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
                try:
                    stat = entry.stat()
                    items.append({
                        "name": entry.name,
                        "type": "folder" if entry.is_dir() else "file",
                        "size_bytes": stat.st_size if entry.is_file() else None,
                        "size_human": _human_size(stat.st_size) if entry.is_file() else None,
                        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    })
                except (PermissionError, OSError):
                    items.append({"name": entry.name, "type": "unknown", "error": "access denied"})
        except PermissionError:
            return {"success": False, "error": f"Permission denied: {folder}"}

        return {
            "success": True,
            "path": str(folder),
            "total_items": len(items),
            "items": items[:100],  # Limit to 100 items
            "message": f"Found {len(items)} items in {folder.name}.",
        }

    @staticmethod
    def _action_search_files(params: Dict[str, Any]) -> Dict[str, Any]:
        query = params.get("query", "").strip().lower()
        path_str = params.get("path", "").strip() or "Desktop"
        if not query:
            return {"success": False, "error": "No search query provided."}

        search_dir = _safe_path(path_str)
        if not search_dir.exists() or not search_dir.is_dir():
            return {"success": False, "error": f"Search directory not found: {search_dir}"}

        matches = []
        try:
            for entry in search_dir.rglob("*"):
                if query in entry.name.lower():
                    matches.append({
                        "name": entry.name,
                        "path": str(entry),
                        "type": "folder" if entry.is_dir() else "file",
                        "size_human": _human_size(entry.stat().st_size) if entry.is_file() else None,
                    })
                    if len(matches) >= 50:
                        break
        except PermissionError:
            pass

        return {
            "success": True,
            "query": query,
            "total_matches": len(matches),
            "matches": matches,
            "message": f"Found {len(matches)} files matching '{query}'.",
        }

    @staticmethod
    def _action_create_folder(params: Dict[str, Any]) -> Dict[str, Any]:
        path_str = params.get("path", "").strip()
        if not path_str:
            return {"success": False, "error": "No folder path provided."}

        folder = _safe_path(path_str)
        if folder.exists():
            return {"success": False, "error": f"Folder already exists: {folder}"}

        folder.mkdir(parents=True, exist_ok=True)
        return {"success": True, "message": f"Created folder: {folder.name}", "path": str(folder)}

    @staticmethod
    def _action_rename_file(params: Dict[str, Any]) -> Dict[str, Any]:
        old_path = _safe_path(params.get("old_path", ""))
        new_name = params.get("new_name", "").strip()

        if not old_path.exists():
            return {"success": False, "error": f"File/folder not found: {old_path}"}
        if not new_name:
            return {"success": False, "error": "No new name provided."}

        new_path = old_path.parent / new_name
        old_path.rename(new_path)
        return {"success": True, "message": f"Renamed '{old_path.name}' to '{new_name}'.", "new_path": str(new_path)}

    @staticmethod
    def _action_move_file(params: Dict[str, Any]) -> Dict[str, Any]:
        source = _safe_path(params.get("source", ""))
        dest = _safe_path(params.get("destination", ""))

        if not source.exists():
            return {"success": False, "error": f"Source not found: {source}"}

        shutil.move(str(source), str(dest))
        return {"success": True, "message": f"Moved '{source.name}' to '{dest}'."}

    @staticmethod
    def _action_copy_file(params: Dict[str, Any]) -> Dict[str, Any]:
        source = _safe_path(params.get("source", ""))
        dest = _safe_path(params.get("destination", ""))

        if not source.exists():
            return {"success": False, "error": f"Source not found: {source}"}

        if source.is_dir():
            shutil.copytree(str(source), str(dest))
        else:
            shutil.copy2(str(source), str(dest))
        return {"success": True, "message": f"Copied '{source.name}' to '{dest}'."}

    @staticmethod
    def _action_delete_file(params: Dict[str, Any]) -> Dict[str, Any]:
        path = _safe_path(params.get("path", ""))
        if not path.exists():
            return {"success": False, "error": f"File not found: {path}"}
        if not _is_safe_path(path):
            return {"success": False, "error": f"Cannot delete system files. Only user files can be deleted."}

        # Use Windows Shell to move to Recycle Bin (recoverable)
        if sys.platform == "win32":
            try:
                from ctypes import windll, c_int, c_wchar_p, byref, Structure, c_ushort
                # Use SHFileOperationW for Recycle Bin
                _run_host_cmd(["powershell", "-Command",
                    f"Add-Type -AssemblyName Microsoft.VisualBasic; "
                    f"[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{path}', 'UIOption.OnlyErrorDialogs', 'RecycleOption.SendToRecycleBin')"])
                return {"success": True, "message": f"Moved '{path.name}' to Recycle Bin."}
            except Exception:
                pass

        # Fallback: regular delete
        path.unlink()
        return {"success": True, "message": f"Deleted '{path.name}'."}

    @staticmethod
    def _action_delete_folder(params: Dict[str, Any]) -> Dict[str, Any]:
        path = _safe_path(params.get("path", ""))
        if not path.exists():
            return {"success": False, "error": f"Folder not found: {path}"}
        if not path.is_dir():
            return {"success": False, "error": f"Not a folder: {path}"}
        if not _is_safe_path(path):
            return {"success": False, "error": f"Cannot delete system folders."}

        if sys.platform == "win32":
            try:
                _run_host_cmd(["powershell", "-Command",
                    f"Add-Type -AssemblyName Microsoft.VisualBasic; "
                    f"[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('{path}', 'UIOption.OnlyErrorDialogs', 'RecycleOption.SendToRecycleBin')"])
                return {"success": True, "message": f"Moved folder '{path.name}' to Recycle Bin."}
            except Exception:
                pass

        shutil.rmtree(str(path), ignore_errors=True)
        return {"success": True, "message": f"Deleted folder '{path.name}'."}

    # ---- System Operations ----

    @staticmethod
    def _action_empty_recycle_bin(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform == "win32":
            try:
                ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 0x00000007)
                return {"success": True, "message": "Recycle Bin emptied successfully."}
            except Exception as e:
                return {"success": False, "error": f"Failed to empty Recycle Bin: {e}"}
        return {"success": False, "error": "Recycle Bin operation only supported on Windows."}

    @staticmethod
    def _action_take_screenshot(params: Dict[str, Any]) -> Dict[str, Any]:
        try:
            try:
                import mss
                with mss.mss() as sct:
                    monitor = sct.monitors[1]
                    img = sct.grab(monitor)
                    from PIL import Image
                    pil_img = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")
            except ImportError:
                # Fallback to Pillow ImageGrab
                from PIL import ImageGrab
                pil_img = ImageGrab.grab()

            buf = io.BytesIO()
            pil_img.save(buf, format="PNG", optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            return {
                "success": True,
                "message": "Screenshot captured.",
                "screenshot_base64": b64,
                "width": pil_img.width,
                "height": pil_img.height,
            }
        except Exception as e:
            return {"success": False, "error": f"Screenshot failed: {e}"}

    @staticmethod
    def _action_lock_computer(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform == "win32":
            ctypes.windll.user32.LockWorkStation()
            return {"success": True, "message": "Computer locked."}
        return {"success": False, "error": "Lock only supported on Windows."}

    @staticmethod
    def _action_list_running_apps(params: Dict[str, Any]) -> Dict[str, Any]:
        name_filter = params.get("filter", "").strip().lower()
        apps = []
        seen = set()

        for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info", "status"]):
            try:
                info = proc.info
                pname = info["name"] or ""
                if name_filter and name_filter not in pname.lower():
                    continue
                if pname.lower() in seen:
                    continue
                seen.add(pname.lower())

                mem_mb = round((info.get("memory_info") or type("", (), {"rss": 0})).rss / (1024 * 1024), 1)
                apps.append({
                    "name": pname,
                    "pid": info["pid"],
                    "cpu_percent": info.get("cpu_percent", 0),
                    "memory_mb": mem_mb,
                    "status": info.get("status", ""),
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        # Sort by memory usage (top consumers first)
        apps.sort(key=lambda a: a["memory_mb"], reverse=True)
        return {
            "success": True,
            "total_apps": len(apps),
            "apps": apps[:30],
            "message": f"Found {len(apps)} running applications.",
        }

    @staticmethod
    def _action_close_application(params: Dict[str, Any]) -> Dict[str, Any]:
        name = params.get("name", "").strip().lower()
        if not name:
            return {"success": False, "error": "No application name provided."}

        killed = 0
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                pname = (proc.info["name"] or "").lower()
                if name in pname:
                    proc.terminate()
                    killed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        if killed > 0:
            return {"success": True, "message": f"Closed {killed} instance(s) of '{name}'."}
        return {"success": False, "error": f"No running process found matching '{name}'."}

    @staticmethod
    def _action_get_system_info(params: Dict[str, Any]) -> Dict[str, Any]:
        info = {
            "os": f"{platform.system()} {platform.release()} {platform.version()}",
            "hostname": platform.node(),
            "cpu": platform.processor() or "Unknown CPU",
            "cpu_cores": psutil.cpu_count(logical=False),
            "cpu_threads": psutil.cpu_count(logical=True),
            "cpu_usage_percent": psutil.cpu_percent(interval=0.5),
            "ram_total_gb": round(psutil.virtual_memory().total / (1024 ** 3), 2),
            "ram_used_gb": round(psutil.virtual_memory().used / (1024 ** 3), 2),
            "ram_percent": psutil.virtual_memory().percent,
        }

        # Disk
        try:
            disk = psutil.disk_usage("/")
            info["disk_total_gb"] = round(disk.total / (1024 ** 3), 2)
            info["disk_used_gb"] = round(disk.used / (1024 ** 3), 2)
            info["disk_percent"] = disk.percent
        except Exception:
            pass

        # Battery
        try:
            battery = psutil.sensors_battery()
            if battery:
                info["battery_percent"] = battery.percent
                info["battery_plugged"] = battery.power_plugged
        except Exception:
            pass

        # GPU
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,temperature.gpu,utilization.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
                creationflags=WIN_NO_WINDOW if sys.platform == "win32" else 0,
            )
            if result.returncode == 0 and result.stdout.strip():
                parts = result.stdout.strip().split(",")
                if len(parts) >= 5:
                    info["gpu_name"] = parts[0].strip()
                    info["gpu_vram_total_mb"] = int(parts[1].strip())
                    info["gpu_vram_used_mb"] = int(parts[2].strip())
                    info["gpu_temperature"] = float(parts[3].strip())
                    info["gpu_usage_percent"] = float(parts[4].strip())
        except Exception:
            pass

        return {
            "success": True,
            "system_info": info,
            "message": f"System: {info['os']} | CPU: {info['cpu_usage_percent']}% | RAM: {info['ram_percent']}%",
        }

    @staticmethod
    def _action_get_battery_status(params: Dict[str, Any]) -> Dict[str, Any]:
        try:
            battery = psutil.sensors_battery()
            if battery is None:
                return {"success": True, "message": "No battery detected (desktop PC).", "battery": None}
            return {
                "success": True,
                "battery": {
                    "percent": battery.percent,
                    "plugged_in": battery.power_plugged,
                    "time_remaining_minutes": round(battery.secsleft / 60, 1) if battery.secsleft > 0 else None,
                },
                "message": f"Battery: {battery.percent}% {'(Charging)' if battery.power_plugged else '(On Battery)'}",
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    @staticmethod
    def _action_set_volume(params: Dict[str, Any]) -> Dict[str, Any]:
        level = int(params.get("level", 50))
        level = max(0, min(100, level))

        if sys.platform == "win32":
            try:
                # Use nircmd (free utility) or PowerShell
                _run_host_cmd([
                    "powershell", "-Command",
                    f"$wshell = New-Object -ComObject WScript.Shell; "
                    f"1..50 | ForEach-Object {{ $wshell.SendKeys([char]174) }}; "  # Volume down to 0
                    f"1..{level // 2} | ForEach-Object {{ $wshell.SendKeys([char]175) }}"  # Volume up to target
                ])
                return {"success": True, "message": f"Volume set to {level}%."}
            except Exception as e:
                return {"success": False, "error": f"Volume control failed: {e}"}
        return {"success": False, "error": "Volume control only supported on Windows."}

    @staticmethod
    def _action_get_clipboard(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform == "win32":
            try:
                result = subprocess.run(
                    ["powershell", "-Command", "Get-Clipboard"],
                    capture_output=True, text=True, timeout=5,
                    creationflags=WIN_NO_WINDOW,
                )
                text = result.stdout.strip()
                return {"success": True, "clipboard_text": text, "message": f"Clipboard: {text[:100]}..."}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "Clipboard access only supported on Windows."}

    @staticmethod
    def _action_set_clipboard(params: Dict[str, Any]) -> Dict[str, Any]:
        text = params.get("text", "").strip()
        if not text:
            return {"success": False, "error": "No text provided."}

        if sys.platform == "win32":
            try:
                subprocess.run(
                    ["powershell", "-Command", f"Set-Clipboard -Value '{text}'"],
                    capture_output=True, text=True, timeout=5,
                    creationflags=WIN_NO_WINDOW,
                )
                return {"success": True, "message": f"Copied to clipboard: {text[:50]}..."}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "Clipboard access only supported on Windows."}

    @staticmethod
    def _action_flush_dns(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform == "win32":
            success, output = _run_host_cmd(["ipconfig", "/flushdns"])
            return {"success": success, "message": output or "DNS cache flushed."}
        return {"success": False, "error": "DNS flush only supported on Windows."}

    # ---- Media, window and input control --------------------------------

    @staticmethod
    def _send_keys(sequence: str, description: str) -> Dict[str, Any]:
        """Send a key sequence to the active desktop via WScript.Shell."""
        if sys.platform != "win32":
            return {"success": False, "error": f"{description} is only supported on Windows."}
        success, output = _run_host_cmd([
            "powershell", "-Command",
            f"(New-Object -ComObject WScript.Shell).SendKeys('{sequence}')",
        ])
        if success:
            return {"success": True, "message": description}
        return {"success": False, "error": output or f"{description} failed."}

    @staticmethod
    def _tap_media_key(vk: int, description: str, repeat: int = 1) -> Dict[str, Any]:
        """Press a media or volume key.

        These were going through SendKeys as "{VOLUME_UP}", "{MEDIA_NEXT_TRACK}"
        and so on. SendKeys has no such codes - its vocabulary is {TAB}, {F1},
        %{TAB} and the like - so every one of the six volume and media actions
        failed with "Value does not fall within the expected range" from
        PowerShell. They had presumably never worked.

        keybd_event takes the actual virtual key code, which is what these keys
        are. It also avoids starting a PowerShell process per keypress.
        """
        if sys.platform != "win32":
            return {"success": False, "error": f"{description} is only supported on Windows."}
        try:
            import ctypes

            user32 = ctypes.windll.user32
            KEYEVENTF_KEYUP = 0x0002
            for _ in range(max(1, repeat)):
                user32.keybd_event(vk, 0, 0, 0)
                user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
            return {"success": True, "message": description}
        except Exception as exc:
            return {"success": False, "error": f"{description} failed: {exc}"}

    @staticmethod
    def _action_media_play_pause(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._tap_media_key(0xB3, "Toggled playback.")

    @staticmethod
    def _action_media_next(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._tap_media_key(0xB0, "Skipped to the next track.")

    @staticmethod
    def _action_media_previous(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._tap_media_key(0xB1, "Went back a track.")

    @staticmethod
    def _action_toggle_mute(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._tap_media_key(0xAD, "Toggled mute.")

    @staticmethod
    def _action_volume_up(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._tap_media_key(0xAF, "Turned the volume up.", repeat=3)

    @staticmethod
    def _action_volume_down(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._tap_media_key(0xAE, "Turned the volume down.", repeat=3)

    @staticmethod
    def _action_minimize_all_windows(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "Showing the desktop is only supported on Windows."}
        success, output = _run_host_cmd([
            "powershell", "-Command",
            "(New-Object -ComObject Shell.Application).MinimizeAll()",
        ])
        return {"success": success, "message": "Minimised all windows." if success else "", "error": None if success else output}

    @staticmethod
    def _action_switch_window(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._send_keys("%{TAB}", "Switched window.")

    @staticmethod
    def _action_type_text(params: Dict[str, Any]) -> Dict[str, Any]:
        text = str(params.get("text", "")).strip()
        if not text:
            return {"success": False, "error": "No text was provided to type."}
        # SendKeys treats these as control characters, so they are escaped.
        escaped = text
        for char in "+^%~(){}[]":
            escaped = escaped.replace(char, "{" + char + "}")
        escaped = escaped.replace("'", "''")
        result = DesktopAgent._send_keys(escaped, f"Typed: {text[:60]}")
        return result

    @staticmethod
    def _action_get_time(params: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now()
        return {
            "success": True,
            "message": now.strftime("It is %I:%M %p on %A, %d %B %Y."),
            "iso": now.isoformat(timespec="seconds"),
        }

    @staticmethod
    def _action_list_drives(params: Dict[str, Any]) -> Dict[str, Any]:
        try:
            import psutil
            entries = []
            for part in psutil.disk_partitions(all=False):
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                except (PermissionError, OSError):
                    continue
                entries.append(
                    f"{part.device.rstrip(chr(92))} "
                    f"{usage.free / 1024 ** 3:.0f} GB free of {usage.total / 1024 ** 3:.0f} GB"
                )
            if not entries:
                return {"success": False, "error": "No readable drives were found."}
            return {"success": True, "message": "; ".join(entries), "drives": entries}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": f"Drive list failed: {exc}"}

    @staticmethod
    def _action_get_network_info(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform == "win32":
            success, output = _run_host_cmd([
                "powershell", "-Command",
                "Get-NetConnectionProfile | Select-Object -First 1 -ExpandProperty Name",
            ])
            name = (output or "").strip()
            if success and name:
                return {"success": True, "message": f"Connected to {name}.", "network": name}
            return {"success": False, "error": "No active network connection was reported."}
        return {"success": False, "error": "Network status is only supported on Windows."}

    @staticmethod
    def _action_create_note(params: Dict[str, Any]) -> Dict[str, Any]:
        text = str(params.get("text", "")).strip()
        if not text:
            return {"success": False, "error": "The note is empty."}
        raw_name = str(params.get("name", "")).strip() or f"note-{datetime.now():%Y%m%d-%H%M%S}"
        safe_name = re.sub(r"[^A-Za-z0-9 _-]", "", raw_name)[:60] or "note"
        target = Path.home() / "Documents" / f"{safe_name}.txt"
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
            return {"success": True, "message": f"Saved the note to {target.name} in Documents.", "path": str(target)}
        except OSError as exc:
            return {"success": False, "error": f"The note could not be saved: {exc}"}

    @staticmethod
    def _action_sleep_computer(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "Sleep is only supported on Windows."}
        success, output = _run_host_cmd(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
        return {"success": success, "message": "Going to sleep." if success else "", "error": None if success else output}

    @staticmethod
    def _action_restart_computer(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "Restart is only supported on Windows."}
        success, output = _run_host_cmd(["shutdown", "/r", "/t", "15"])
        return {
            "success": success,
            "message": "Restarting in 15 seconds. Say 'cancel shutdown' to stop it." if success else "",
            "error": None if success else output,
        }

    @staticmethod
    def _action_shutdown_computer(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "Shutdown is only supported on Windows."}
        success, output = _run_host_cmd(["shutdown", "/s", "/t", "15"])
        return {
            "success": success,
            "message": "Shutting down in 15 seconds. Say 'cancel shutdown' to stop it." if success else "",
            "error": None if success else output,
        }
    @staticmethod
    def _action_cancel_shutdown(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        success, output = _run_host_cmd(["shutdown", "/a"])
        # /a fails harmlessly when nothing is scheduled; say so plainly.
        if not success:
            return {"success": True, "message": "There was no shutdown waiting to be cancelled."}
        return {"success": True, "message": "Cancelled the pending shutdown."}

    # ---- Information ----

    @staticmethod
    def _action_get_weather(params: Dict[str, Any]) -> Dict[str, Any]:
        """wttr.in is free and needs no key, which keeps this action zero-cost."""
        import urllib.parse
        import urllib.request

        city = str(params.get("city") or "").strip()
        path = urllib.parse.quote(city) if city else ""
        url = f"https://wttr.in/{path}?format=%l:+%C,+%t+(feels+%f),+humidity+%h,+wind+%w"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
            with urllib.request.urlopen(request, timeout=12) as response:
                summary = response.read().decode("utf-8", errors="replace").strip()
        except Exception as exc:
            return {"success": False, "error": f"The weather service could not be reached: {exc}"}
        if not summary or "Unknown location" in summary:
            return {"success": False, "error": f"No weather was found for '{city or 'this location'}'."}
        return {"success": True, "message": summary, "data": {"summary": summary}}

    @staticmethod
    def _action_get_public_ip(params: Dict[str, Any]) -> Dict[str, Any]:
        import urllib.request

        try:
            with urllib.request.urlopen("https://api.ipify.org", timeout=10) as response:
                address = response.read().decode("ascii", errors="replace").strip()
        except Exception as exc:
            return {"success": False, "error": f"The public IP could not be looked up: {exc}"}
        return {"success": True, "message": f"Your public IP address is {address}.", "data": {"ip": address}}

    @staticmethod
    def _action_ping_host(params: Dict[str, Any]) -> Dict[str, Any]:
        host = str(params.get("host") or "").strip()
        if not host:
            return {"success": False, "error": "Which host should be pinged?"}
        # Only a hostname or IP, never shell metacharacters.
        if not re.fullmatch(r"[A-Za-z0-9._:-]+", host):
            return {"success": False, "error": "That does not look like a hostname or IP address."}
        count_flag = "-n" if sys.platform == "win32" else "-c"
        success, output = _run_host_cmd(["ping", count_flag, "4", host], shell=False, timeout=25)
        if not success:
            return {"success": False, "error": f"{host} did not answer."}
        times = re.findall(r"time[=<]\s*(\d+)\s*ms", output, re.I)
        if times:
            average = sum(int(value) for value in times) / len(times)
            return {
                "success": True,
                "message": f"{host} replied {len(times)} times, averaging {average:.0f} ms.",
                "data": {"host": host, "replies": len(times), "avg_ms": round(average)},
            }
        return {"success": True, "message": f"{host} is reachable.", "data": {"host": host}}

    @staticmethod
    def _action_list_wifi_networks(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        success, output = _run_host_cmd(["netsh", "wlan", "show", "networks"], shell=False, timeout=20)
        if not success:
            return {"success": False, "error": "The wireless networks could not be listed."}
        names = [match.strip() for match in re.findall(r"^SSID\s+\d+\s*:\s*(.+)$", output, re.M) if match.strip()]
        if not names:
            return {"success": True, "message": "No wireless networks are in range.", "data": {"networks": []}}
        listed = ", ".join(names[:10])
        return {
            "success": True,
            "message": f"{len(names)} networks in range: {listed}.",
            "data": {"networks": names},
        }

    @staticmethod
    def _action_get_uptime(params: Dict[str, Any]) -> Dict[str, Any]:
        seconds = int(time.time() - psutil.boot_time())
        days, remainder = divmod(seconds, 86400)
        hours, remainder = divmod(remainder, 3600)
        minutes = remainder // 60
        parts = []
        if days:
            parts.append(f"{days} day{'s' if days != 1 else ''}")
        if hours:
            parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
        phrase = ", ".join(parts)
        booted = datetime.fromtimestamp(psutil.boot_time()).strftime("%d %b %Y at %H:%M")
        return {
            "success": True,
            "message": f"This machine has been up for {phrase}, since {booted}.",
            "data": {"uptime_seconds": seconds, "booted_at": booted},
        }

    @staticmethod
    def _action_list_installed_apps(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        # The registry uninstall keys are far faster than Get-WmiObject here.
        script = (
            "Get-ItemProperty "
            "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, "
            "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* "
            "| Where-Object { $_.DisplayName } "
            "| Select-Object -ExpandProperty DisplayName"
        )
        success, output = _run_host_cmd(["powershell", "-NoProfile", "-Command", script], shell=False, timeout=45)
        if not success:
            return {"success": False, "error": "The installed programs could not be listed."}
        names = sorted({line.strip() for line in output.splitlines() if line.strip()})
        return {
            "success": True,
            "message": f"{len(names)} programs are installed.",
            "data": {"apps": names},
        }

    @staticmethod
    def _action_list_startup_apps(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        script = "Get-CimInstance Win32_StartupCommand | Select-Object -ExpandProperty Name"
        success, output = _run_host_cmd(["powershell", "-NoProfile", "-Command", script], shell=False, timeout=30)
        if not success:
            return {"success": False, "error": "The startup programs could not be listed."}
        names = sorted({line.strip() for line in output.splitlines() if line.strip()})
        if not names:
            return {"success": True, "message": "Nothing is set to launch at startup.", "data": {"apps": []}}
        return {
            "success": True,
            "message": f"{len(names)} programs launch at startup: {', '.join(names[:10])}.",
            "data": {"apps": names},
        }

    # ---- System panels ----

    @staticmethod
    def _open_shell_target(command: List[str], label: str) -> Dict[str, Any]:
        success, output = _run_host_cmd(command)
        return {
            "success": success,
            "message": f"Opened {label}." if success else "",
            "error": None if success else output,
        }

    @staticmethod
    def _action_open_task_manager(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._open_shell_target(["taskmgr.exe"], "Task Manager")

    @staticmethod
    def _action_open_settings(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._open_shell_target(["start", "ms-settings:"], "Windows Settings")

    @staticmethod
    def _action_open_control_panel(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._open_shell_target(["control.exe"], "Control Panel")

    @staticmethod
    def _action_open_device_manager(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._open_shell_target(["devmgmt.msc"], "Device Manager")

    @staticmethod
    def _action_open_snipping_tool(params: Dict[str, Any]) -> Dict[str, Any]:
        return DesktopAgent._open_shell_target(["start", "ms-screenclip:"], "the Snipping Tool")

    # ---- Files ----

    @staticmethod
    def _action_zip_folder(params: Dict[str, Any]) -> Dict[str, Any]:
        target = _safe_path(str(params.get("path") or ""))
        if not target.is_dir():
            return {"success": False, "error": f"'{target}' is not a folder."}
        if not _is_safe_path(target):
            return {"success": False, "error": "That folder is outside the areas this agent may touch."}
        archive = shutil.make_archive(str(target), "zip", root_dir=str(target))
        size = Path(archive).stat().st_size
        return {
            "success": True,
            "message": f"Compressed {target.name} to {Path(archive).name} ({_human_size(size)}).",
            "data": {"archive": archive},
        }

    @staticmethod
    def _action_unzip_file(params: Dict[str, Any]) -> Dict[str, Any]:
        archive = _safe_path(str(params.get("path") or ""))
        if not archive.is_file() or archive.suffix.lower() != ".zip":
            return {"success": False, "error": f"'{archive}' is not a .zip file."}
        if not _is_safe_path(archive):
            return {"success": False, "error": "That file is outside the areas this agent may touch."}
        destination = archive.with_suffix("")
        destination.mkdir(exist_ok=True)
        shutil.unpack_archive(str(archive), str(destination))
        count = sum(1 for _ in destination.rglob("*") if _.is_file())
        return {
            "success": True,
            "message": f"Extracted {count} files into {destination.name}.",
            "data": {"destination": str(destination), "files": count},
        }

    @staticmethod
    def _action_read_text_file(params: Dict[str, Any]) -> Dict[str, Any]:
        target = _safe_path(str(params.get("path") or ""))
        if not target.is_file():
            return {"success": False, "error": f"'{target}' is not a file."}
        if not _is_safe_path(target):
            return {"success": False, "error": "That file is outside the areas this agent may read."}
        if target.stat().st_size > 2 * 1024 * 1024:
            return {"success": False, "error": "That file is too large to read out (over 2 MB)."}
        try:
            text = target.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return {"success": False, "error": f"That file could not be read: {exc}"}
        return {
            "success": True,
            "message": text[:4000],
            "data": {"path": str(target), "characters": len(text)},
        }

    # ---- Appearance & preferences ----

    @staticmethod
    def _action_set_wallpaper(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        image = _safe_path(str(params.get("path") or ""))
        if not image.is_file():
            return {"success": False, "error": f"'{image}' is not an image file."}
        if image.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp"}:
            return {"success": False, "error": "Only JPG, PNG and BMP images can be used as wallpaper."}
        # SPI_SETDESKWALLPAPER = 20; the flags write the change through and notify shells.
        changed = ctypes.windll.user32.SystemParametersInfoW(20, 0, str(image), 3)
        if not changed:
            return {"success": False, "error": "Windows refused the wallpaper change."}
        return {"success": True, "message": f"Wallpaper set to {image.name}."}

    @staticmethod
    def _action_toggle_dark_mode(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        import winreg

        key_path = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
                current, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
                new_value = 0 if current else 1
                winreg.SetValueEx(key, "AppsUseLightTheme", 0, winreg.REG_DWORD, new_value)
                winreg.SetValueEx(key, "SystemUsesLightTheme", 0, winreg.REG_DWORD, new_value)
        except OSError as exc:
            return {"success": False, "error": f"The theme could not be changed: {exc}"}
        return {
            "success": True,
            "message": "Switched to light mode." if new_value else "Switched to dark mode.",
            "data": {"light_mode": bool(new_value)},
        }

    @staticmethod
    def _action_set_launch_at_startup(params: Dict[str, Any]) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"success": False, "error": "This is only supported on Windows."}
        raw = params.get("enabled", True)
        enabled = raw if isinstance(raw, bool) else str(raw).strip().lower() not in {"false", "0", "no", "off"}

        startup = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
        shortcut = startup / "SMARAN.AI.lnk"

        if not enabled:
            if shortcut.exists():
                shortcut.unlink()
                return {"success": True, "message": "SMARAN.AI will no longer start with Windows."}
            return {"success": True, "message": "SMARAN.AI was already not starting with Windows."}

        # sys.executable is the packaged .exe in a frozen build and the Python
        # interpreter otherwise; only the former is worth pinning to startup.
        target = Path(sys.executable)
        if not getattr(sys, "frozen", False):
            return {
                "success": False,
                "error": "Launch at startup is available in the installed desktop build, not when running from source.",
            }
        script = (
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('" + str(shortcut) + "'); "
            "$s.TargetPath = '" + str(target) + "'; "
            "$s.WorkingDirectory = '" + str(target.parent) + "'; "
            "$s.Save()"
        )
        success, output = _run_host_cmd(["powershell", "-NoProfile", "-Command", script], shell=False, timeout=20)
        if not success:
            return {"success": False, "error": f"The startup shortcut could not be created: {output}"}
        return {"success": True, "message": "SMARAN.AI will now start with Windows."}


# ---------------------------------------------------------------------------
# Intent Detection — Maps natural language to desktop actions
# ---------------------------------------------------------------------------

INTENT_PATTERNS: List[Tuple[re.Pattern, str, Dict[str, str]]] = [
    # YouTube
    (re.compile(r"(?:open|play|search|chalao|kholo|dikhao)\s+(?:on\s+)?youtube\s+(.+)", re.I), "search_youtube", {"query": "$1"}),
    (re.compile(r"youtube\s+(?:pe|par|par|mein|mai)\s+(.+?)(?:\s+(?:chalao|play|search|kholo|dikhao))", re.I), "search_youtube", {"query": "$1"}),
    (re.compile(r"(?:open|kholo|start)\s+youtube", re.I), "open_website", {"name": "youtube"}),

    # Instagram
    (re.compile(r"(?:open|kholo)\s+instagram", re.I), "open_website", {"name": "instagram"}),

    # Gmail / Email
    (re.compile(r"(?:compose|send|write|likho|bhejo)\s+(?:an?\s+)?(?:email|mail|gmail)\s+(?:to\s+)?(\S+@\S+)(?:\s+(?:subject|about|regarding)\s+(.+?))?(?:\s+(?:body|message|content)\s+(.+))?$", re.I), "compose_email", {"to": "$1", "subject": "$2", "body": "$3"}),
    (re.compile(r"(?:open|kholo)\s+(?:gmail|email|mail)", re.I), "open_website", {"name": "gmail"}),

    # Social media
    (re.compile(r"(?:open|kholo)\s+(?:facebook|fb)", re.I), "open_website", {"name": "facebook"}),
    (re.compile(r"(?:open|kholo)\s+(?:twitter|x\.com)", re.I), "open_website", {"name": "twitter"}),
    (re.compile(r"(?:open|kholo)\s+linkedin", re.I), "open_website", {"name": "linkedin"}),
    (re.compile(r"(?:open|kholo)\s+reddit", re.I), "open_website", {"name": "reddit"}),
    (re.compile(r"(?:open|kholo)\s+github", re.I), "open_website", {"name": "github"}),
    (re.compile(r"(?:open|kholo)\s+whatsapp", re.I), "open_website", {"name": "whatsapp web"}),
    (re.compile(r"(?:open|kholo)\s+(?:netflix|hotstar|spotify|amazon|flipkart)", re.I), "open_website", {"name": "$0"}),

    # Applications
    (re.compile(r"(?:open|kholo|launch|start|chalao)\s+(?:vs\s*code|vscode|visual\s+studio\s+code)", re.I), "open_application", {"name": "vscode"}),
    (re.compile(r"(?:open|kholo|launch|start)\s+(?:chrome|brave|edge|firefox)", re.I), "open_application", {"name": "$0"}),
    (re.compile(r"(?:open|kholo|launch|start)\s+(?:notepad|calculator|calc|paint|terminal|cmd|powershell)", re.I), "open_application", {"name": "$0"}),
    (re.compile(r"(?:open|kholo|launch|start)\s+(?:task\s*manager)", re.I), "open_application", {"name": "task manager"}),
    (re.compile(r"(?:open|kholo|launch|start)\s+(?:file\s*explorer|explorer|my\s*computer)", re.I), "open_application", {"name": "file explorer"}),
    (re.compile(r"(?:open|kholo|launch|start)\s+settings", re.I), "open_application", {"name": "settings"}),

    # Folders
    (re.compile(r"(?:open|kholo|show|dikhao)\s+(?:my\s+)?(?:desktop|downloads?|documents?|pictures?|videos?|music)\s*(?:folder)?", re.I), "open_folder", {"path": "$0"}),
    (re.compile(r"(?:open|kholo)\s+folder\s+(.+)", re.I), "open_folder", {"path": "$1"}),

    # File operations
    (re.compile(r"(?:list|show|dikhao|batao)\s+(?:all\s+)?files?\s+(?:in|of|inside)\s+(.+)", re.I), "list_files", {"path": "$1"}),
    (re.compile(r"(?:search|find|dhundho|khojo)\s+(?:for\s+)?(?:file|files?)\s+(?:named?\s+)?(.+?)(?:\s+(?:in|inside|from)\s+(.+))?$", re.I), "search_files", {"query": "$1", "path": "$2"}),
    (re.compile(r"(?:create|make|banao)\s+(?:a\s+)?(?:new\s+)?folder\s+(?:named?\s+)?(.+)", re.I), "create_folder", {"path": "$1"}),
    (re.compile(r"(?:delete|remove|hatao|mitao)\s+(?:this\s+)?file\s+(.+)", re.I), "delete_file", {"path": "$1"}),
    (re.compile(r"(?:delete|remove|hatao|mitao)\s+(?:this\s+)?folder\s+(.+)", re.I), "delete_folder", {"path": "$1"}),
    (re.compile(r"(?:rename)\s+(.+?)\s+(?:to|as)\s+(.+)", re.I), "rename_file", {"old_path": "$1", "new_name": "$2"}),

    # System
    (re.compile(r"(?:empty|clear|khali\s+karo|saaf\s+karo)\s+(?:the\s+)?recycle\s*bin", re.I), "empty_recycle_bin", {}),
    (re.compile(r"(?:take|capture|lelo|lo)\s+(?:a\s+)?screenshot", re.I), "take_screenshot", {}),
    (re.compile(r"(?:lock|band\s+karo)\s+(?:my\s+)?(?:computer|pc|laptop|screen)", re.I), "lock_computer", {}),
    (re.compile(r"(?:show|list|batao|dikhao)\s+(?:all\s+)?(?:running|active)\s+(?:apps?|applications?|processes?|programs?)", re.I), "list_running_apps", {}),
    (re.compile(r"(?:close|kill|band\s+karo|hatao)\s+(.+)", re.I), "close_application", {"name": "$1"}),
    (re.compile(r"(?:system|device|computer)\s+(?:info|information|details|status)", re.I), "get_system_info", {}),
    (re.compile(r"(?:battery|charge)\s+(?:status|level|percent|kitna)", re.I), "get_battery_status", {}),
    (re.compile(r"(?:set|change)\s+volume\s+(?:to\s+)?(\d+)", re.I), "set_volume", {"level": "$1"}),
    (re.compile(r"(?:volume)\s+(\d+)", re.I), "set_volume", {"level": "$1"}),

    # URL
    (re.compile(r"(?:open|kholo|go\s+to)\s+(https?://\S+)", re.I), "open_url", {"url": "$1"}),
    (re.compile(r"(?:open|kholo|go\s+to)\s+(\S+\.(?:com|org|net|io|dev|in|co|ai)(?:/\S*)?)", re.I), "open_url", {"url": "$1"}),

    # Media playback
    (re.compile(r"\b(?:pause|resume|play)\s+(?:the\s+)?(?:music|song|video|media)\b|\b(?:gaana|gana|video)\s*(?:rok|chalao|band karo)\b|\bplay\s*pause\b", re.I), "media_play_pause", {}),
    (re.compile(r"\b(?:next|skip)\s+(?:the\s+)?(?:track|song|gaana|gana)\b|\bagla\s+(?:gaana|gana|track)\b", re.I), "media_next", {}),
    (re.compile(r"\b(?:previous|last|pichla)\s+(?:track|song|gaana|gana)\b|\bgo\s+back\s+a\s+track\b", re.I), "media_previous", {}),
    (re.compile(r"\b(?:mute|unmute)\b|\bawaz\s*(?:band|chalu)\s*karo\b", re.I), "toggle_mute", {}),
    (re.compile(r"\b(?:volume|awaz|awaaz)\s*(?:up|badhao|tez)\b|\bincrease\s+(?:the\s+)?volume\b|\bturn\s+it\s+up\b", re.I), "volume_up", {}),
    (re.compile(r"\b(?:volume|awaz|awaaz)\s*(?:down|kam)\s*(?:karo)?\b|\bdecrease\s+(?:the\s+)?volume\b|\bturn\s+it\s+down\b", re.I), "volume_down", {}),

    # Windows
    (re.compile(r"\b(?:show|dikhao)\s+(?:the\s+)?desktop\b|\bminimi[sz]e\s+(?:all|everything)\b|\bsab\s+minimize\s+karo\b", re.I), "minimize_all_windows", {}),
    (re.compile(r"\bswitch\s+(?:the\s+)?window\b|\bnext\s+window\b|\bwindow\s+badlo\b", re.I), "switch_window", {}),

    # Typing
    (re.compile(r"(?:type|likho|likh do)\s+(?:this\s+)?(?:text\s+)?[\"']?(.+?)[\"']?$", re.I), "type_text", {"text": "$1"}),

    # Information
    (re.compile(r"\bwhat(?:'s| is)\s+the\s+time\b|\bkya\s+(?:time|samay)\s+h(?:ai|ua)\b|\bcurrent\s+(?:time|date)\b|\btime\s+kya\s+hai\b", re.I), "get_time", {}),
    (re.compile(r"\b(?:list|show|dikhao)\s+(?:my\s+)?drives?\b|\bdisk\s+space\b|\bstorage\s+(?:kitna|info)\b", re.I), "list_drives", {}),
    (re.compile(r"\b(?:network|wifi|internet)\s+(?:status|info|name|connected)\b|\bkaunsa\s+wifi\b", re.I), "get_network_info", {}),

    # Notes
    (re.compile(r"(?:note|yaad rakho|save this|likh lo)[:,]?\s+(.+)", re.I), "create_note", {"text": "$1"}),

    # Power (all confirmed before they run)
    (re.compile(r"\b(?:sleep|suspend)\s+(?:the\s+)?(?:computer|pc|laptop|system)\b|\bcomputer\s+ko\s+sula\s+do\b", re.I), "sleep_computer", {}),
    (re.compile(r"\brestart\s+(?:the\s+)?(?:computer|pc|laptop|system)\b|\breboot\b|\bcomputer\s+restart\s+karo\b", re.I), "restart_computer", {}),
    (re.compile(r"\bshut\s*down\s+(?:the\s+)?(?:computer|pc|laptop|system)?\b|\bcomputer\s+band\s+karo\b", re.I), "shutdown_computer", {}),
    (re.compile(r"\bcancel\s+(?:the\s+)?(?:shut\s*down|restart|reboot)\b|\bshutdown\s+(?:cancel|rok\s+do|mat\s+karo)\b", re.I), "cancel_shutdown", {}),

    # Weather / connectivity (free services, no API key)
    (re.compile(r"\bweather\s+(?:in|at|for|of)\s+([A-Za-zऀ-ॿ .'-]+?)\s*(?:kaisa hai|hai|\?)?$", re.I), "get_weather", {"city": "$1"}),
    (re.compile(r"^([A-Za-zऀ-ॿ .'-]+?)\s+(?:ka|mein|me)\s+(?:mausam|weather)\s+(?:kaisa\s+hai|batao|hai)\b", re.I), "get_weather", {"city": "$1"}),
    (re.compile(r"\b(?:what(?:'s| is)\s+the\s+)?weather\b|\bmausam\s+(?:kaisa\s+hai|batao)\b", re.I), "get_weather", {}),
    (re.compile(r"\b(?:my\s+)?public\s+ip\b|\bwhat(?:'s| is)\s+my\s+ip\b|\bmera\s+ip\b", re.I), "get_public_ip", {}),
    (re.compile(r"\bping\s+([A-Za-z0-9._:-]+)", re.I), "ping_host", {"host": "$1"}),
    (re.compile(r"\b(?:list|show|scan|dikhao)\s+(?:nearby\s+)?wi-?fi\s+networks?\b|\bwifi\s+networks?\s+(?:dikhao|batao)\b", re.I), "list_wifi_networks", {}),
    (re.compile(r"\b(?:system\s+)?uptime\b|\bhow\s+long\s+(?:has\s+)?(?:the\s+)?(?:pc|computer|system)\s+been\s+(?:on|running)\b|\bkitni\s+der\s+se\s+chal\s+raha\b", re.I), "get_uptime", {}),
    (re.compile(r"\b(?:list|show|dikhao)\s+(?:my\s+)?installed\s+(?:apps?|programs?|software)\b|\binstalled\s+apps?\s+(?:dikhao|batao)\b", re.I), "list_installed_apps", {}),
    (re.compile(r"\b(?:list|show|dikhao)\s+startup\s+(?:apps?|programs?|items?)\b|\bstartup\s+programs?\s+(?:dikhao|batao)\b", re.I), "list_startup_apps", {}),

    # System panels
    (re.compile(r"\b(?:open|kholo|show)\s+task\s*manager\b", re.I), "open_task_manager", {}),
    (re.compile(r"\b(?:open|kholo)\s+(?:windows\s+)?settings\b|\bsettings\s+kholo\b", re.I), "open_settings", {}),
    (re.compile(r"\b(?:open|kholo)\s+control\s+panel\b", re.I), "open_control_panel", {}),
    (re.compile(r"\b(?:open|kholo)\s+device\s+manager\b", re.I), "open_device_manager", {}),
    (re.compile(r"\b(?:open|kholo|start)\s+(?:the\s+)?snipping\s+tool\b|\bsnip\s+(?:tool|karo)\b", re.I), "open_snipping_tool", {}),

    # Files
    # These require an explicit "folder"/".zip" marker: a bare "zip <word>"
    # also matches questions like "what is a zip file", which must stay chat.
    (re.compile(r"^(?:zip|compress)\s+(?:the\s+)?folder\s+(.+)$", re.I), "zip_folder", {"path": "$1"}),
    (re.compile(r"^(?:zip|compress)\s+(?:the\s+)?(.+?)\s+folder$", re.I), "zip_folder", {"path": "$1"}),
    (re.compile(r"^(?:unzip|extract)\s+(?:the\s+)?(\S+\.zip)$", re.I), "unzip_file", {"path": "$1"}),
    (re.compile(r"^read\s+(?:the\s+)?(?:text\s+)?file\s+(\S+\.\w{1,5})$", re.I), "read_text_file", {"path": "$1"}),

    # Appearance & preferences
    (re.compile(r"\b(?:set|change)\s+(?:the\s+)?wallpaper\s+(?:to\s+)?(.+)$", re.I), "set_wallpaper", {"path": "$1"}),
    (re.compile(r"\b(?:toggle|switch|change)\s+(?:to\s+)?(?:dark|light)\s+mode\b|\bdark\s+mode\s+(?:on|off|karo)\b", re.I), "toggle_dark_mode", {}),
    (re.compile(r"\b(?:start|launch|open)\s+(?:smaran\s*)?(?:ai\s*)?(?:with|at)\s+(?:windows\s+)?startup\b|\bstartup\s+(?:pe|par)\s+(?:chalu|start)\s+karo\b", re.I), "set_launch_at_startup", {"enabled": "true"}),
    (re.compile(r"\b(?:don'?t|do not|mat)\s+(?:start|launch|chalao)\s+(?:smaran\s*)?(?:ai\s*)?(?:with|at|pe|par)\s+(?:windows\s+)?startup\b", re.I), "set_launch_at_startup", {"enabled": "false"}),
]


def detect_desktop_intent(text: str) -> Optional[Dict[str, Any]]:
    """Detect if user text contains a desktop action intent.
    Returns {"action": "action_id", "params": {...}} or None.
    """
    text = text.strip()
    if not text or len(text) < 3:
        return None

    for pattern, action_id, param_template in INTENT_PATTERNS:
        match = pattern.search(text)
        if match:
            params = {}
            for key, template in param_template.items():
                if template.startswith("$"):
                    group_num = int(template[1:]) if template[1:].isdigit() else 0
                    if group_num == 0:
                        # Extract the keyword from the match
                        matched_text = match.group(0)
                        # Extract last word as the app/site name
                        words = matched_text.lower().split()
                        val = words[-1] if words else ""
                    else:
                        try:
                            val = match.group(group_num) or ""
                        except IndexError:
                            val = ""
                    params[key] = val.strip()
                else:
                    params[key] = template

            # Clean empty params
            params = {k: v for k, v in params.items() if v}

            return {"action": action_id, "params": params}

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _human_size(nbytes: int) -> str:
    """Convert bytes to human-readable string."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(nbytes) < 1024.0:
            return f"{nbytes:.1f} {unit}"
        nbytes /= 1024.0
    return f"{nbytes:.1f} PB"
